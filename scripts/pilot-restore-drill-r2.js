'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BackupCrypto=require('./backup-crypto.js');
const BackupTarget=require('./r2-eu-backup-target.js');
const Readiness=require('../apps/api/readiness.js');
const {verifyDatabase}=require('./pilot-restore-verify.js');
const {outsideRepository}=require('./pilot-preflight.js');

function required(name){
  const value=String(process.env[name]||'').trim();
  if(!value)throw new Error(name+' måste anges.');
  return value;
}

function writeEvidence(filename,value){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const temp=filename+'.tmp-'+crypto.randomUUID();
  try{
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,filename);
    fs.chmodSync(filename,0o600);
  }catch(error){
    fs.rmSync(temp,{force:true});
    throw error;
  }
}

async function runR2RestoreDrill({target,source,drillDir,evidencePath,backupKey,now=new Date()}={}){
  if(!target||typeof target.getToFile!=='function')throw new Error('R2 restore-target med getToFile() krävs.');
  if(!source||source.ok!==true)throw new Error('Verifierat offsite-backupbevis krävs för R2 restore-drill.');
  const selectedDir=String(drillDir||'').trim();
  if(!selectedDir)throw new Error('Restore drill-katalog saknas.');
  const root=path.resolve(selectedDir);
  fs.mkdirSync(root,{recursive:true,mode:0o700});

  const sourceFile=BackupTarget.encryptedBackupBasename(source.encryptedFile);
  const sourceSha=String(source.sha256||'').trim().toLowerCase();
  const sourceSize=Number(source.sizeBytes);
  if(!/^[a-f0-9]{64}$/.test(sourceSha))throw new Error('R2 restore-källans SHA-256 är ogiltig.');
  if(!Number.isSafeInteger(sourceSize)||sourceSize<1)throw new Error('R2 restore-källans storlek är ogiltig.');
  const storageKey=BackupTarget.backupStorageKeys({sha256:sourceSha,basename:sourceFile}).encrypted;
  const downloaded=path.join(root,`r2-download-${crypto.randomUUID()}-${sourceFile}`);
  const restored=path.join(root,`r2-restore-${crypto.randomUUID()}.sqlite`);
  let verified;

  try{
    const remote=await target.getToFile({
      storageKey,
      filename:downloaded,
      sha256:sourceSha,
      sizeBytes:sourceSize
    });
    if(remote.verified!==true||remote.sha256!==sourceSha||remote.sizeBytes!==sourceSize){
      throw new Error('R2 restore-download kunde inte verifieras.');
    }
    BackupCrypto.decryptFile(downloaded,restored,backupKey);
    fs.chmodSync(restored,0o600);
    verified=verifyDatabase(restored,{requirePrivateObjectSchema:true});
  }finally{
    fs.rmSync(restored,{force:true});
    fs.rmSync(downloaded,{force:true});
  }

  const evidence=Object.freeze({
    schemaVersion:1,
    verifiedAt:now.toISOString(),
    sourceProvider:'r2',
    provider:'r2',
    jurisdiction:'eu',
    bucket:source.bucket,
    sourceFile,
    sourceEncryptedSha256:sourceSha,
    sourceSizeBytes:sourceSize,
    sourceStorageKey:storageKey,
    remoteDownloadVerified:true,
    sqliteIntegrity:Boolean(verified.sqliteIntegrity),
    foreignKeys:Boolean(verified.foreignKeys),
    tenantRelations:Number(verified.tenantRelations||0),
    journalEntries:Number(verified.journalEntries||0),
    archivedDocuments:Number(verified.archivedDocuments||0),
    privateObjectsVerified:verified.privateObjectsVerified===true,
    privateObjectSchemaComplete:verified.privateObjectSchemaComplete===true,
    privateObjectCount:Number(verified.privateObjectCount||0),
    verifiedPrivateObjectCount:Number(verified.verifiedPrivateObjectCount||0),
    privateObjectBytes:Number(verified.privateObjectBytes||0),
    privateObjectIssueCount:Number(verified.privateObjectIssueCount||0),
    privateObjectsByKind:verified.privateObjectsByKind,
    productionDatabaseTouched:false,
    remoteDownloadRemoved:true,
    restoreCopyRemoved:true
  });
  if(evidencePath)writeEvidence(path.resolve(evidencePath),evidence);
  return evidence;
}

async function main(){
  if(String(process.env.ROLLANDS_ENV||'').trim().toLowerCase()!=='staging'){
    throw new Error('R2 restore-drill får i denna fas endast köras med ROLLANDS_ENV=staging.');
  }
  const sourceEvidencePath=path.resolve(required('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH'));
  const evidencePath=path.resolve(required('ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH'));
  const drillDir=path.resolve(required('ROLLANDS_RESTORE_DRILL_PATH'));
  const backupKey=required('ROLLANDS_BACKUP_ENCRYPTION_KEY');

  for(const selected of [sourceEvidencePath,evidencePath,drillDir]){
    if(!outsideRepository(selected))throw new Error('R2 restore-drillens filer måste ligga utanför Git-repositoryt.');
  }
  const production=process.env.ROLLANDS_DATABASE_PATH?path.resolve(process.env.ROLLANDS_DATABASE_PATH):'';
  if(production&&(production===evidencePath||production.startsWith(drillDir+path.sep))){
    throw new Error('R2 restore-drill får inte använda produktionsdatabasens sökväg.');
  }

  const source=Readiness.offsiteBackupEvidence(sourceEvidencePath);
  if(!source.ok)throw new Error('OFFSITE_BACKUP_EVIDENCE_INVALID_OR_STALE');
  const config=BackupTarget.configFromEnvironment(process.env);
  if(source.bucket!==config.bucket)throw new Error('OFFSITE_BACKUP_EVIDENCE_BUCKET_MISMATCH');

  const target=BackupTarget.createR2EuBackupTarget({config});
  const evidence=await runR2RestoreDrill({target,source,drillDir,evidencePath,backupKey});
  process.stdout.write(JSON.stringify({
    verified:true,
    sourceProvider:evidence.sourceProvider,
    bucket:evidence.bucket,
    sourceFile:evidence.sourceFile,
    sourceEncryptedSha256:evidence.sourceEncryptedSha256,
    privateObjectCount:evidence.privateObjectCount,
    evidencePath
  })+'\n');
}

if(require.main===module){
  main().catch(error=>{
    console.error((error?.code||'R2_RESTORE_DRILL_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  });
}

module.exports=Object.freeze({required,writeEvidence,runR2RestoreDrill,main});
