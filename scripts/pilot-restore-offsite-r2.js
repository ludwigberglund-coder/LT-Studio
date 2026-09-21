'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BackupCrypto=require('./backup-crypto.js');
const BackupTarget=require('./r2-eu-backup-target.js');
const Readiness=require('../apps/api/readiness.js');
const {verifyDatabase}=require('./pilot-restore-verify.js');
const {outsideRepository}=require('./pilot-preflight.js');
const {writeEvidence}=require('./pilot-restore-drill.js');

function required(env,name){
  const value=String(env?.[name]||'').trim();
  if(!value)throw new Error(name+' måste anges.');
  return value;
}
function readOffsiteEvidence(filename,{now=Date.now()}={}){
  const checked=Readiness.offsiteBackupEvidence(filename,{now});
  if(!checked.ok)throw new Error('OFFSITE_RESTORE_SOURCE_EVIDENCE_INVALID: offsite-backupens evidens saknas, är för gammalt eller ogiltigt.');
  let value;
  try{value=JSON.parse(fs.readFileSync(filename,'utf8'))}
  catch{throw new Error('OFFSITE_RESTORE_SOURCE_EVIDENCE_INVALID: evidensfilen kan inte läsas.')}
  return Object.freeze(value);
}
async function runOffsiteRestore({env=process.env,fetchImpl=globalThis.fetch,now=new Date()}={}){
  const drillDir=path.resolve(required(env,'ROLLANDS_RESTORE_DRILL_PATH'));
  const evidencePath=path.resolve(required(env,'ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH'));
  const sourceEvidencePath=path.resolve(required(env,'ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH'));
  const backupKey=required(env,'ROLLANDS_BACKUP_ENCRYPTION_KEY');
  if(!outsideRepository(drillDir))throw new Error('ROLLANDS_RESTORE_DRILL_PATH måste ligga utanför Git-repositoryt.');
  if(!outsideRepository(evidencePath))throw new Error('ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH måste ligga utanför Git-repositoryt.');
  if(!outsideRepository(sourceEvidencePath))throw new Error('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH måste ligga utanför Git-repositoryt.');

  const production=env.ROLLANDS_DATABASE_PATH?path.resolve(env.ROLLANDS_DATABASE_PATH):'';
  if(production&&(production===evidencePath||production===sourceEvidencePath||production.startsWith(drillDir+path.sep))){
    throw new Error('Offsite restore drill får inte använda produktionsdatabasens sökväg.');
  }

  const source=readOffsiteEvidence(sourceEvidencePath,{now:now.getTime()});
  const config=BackupTarget.configFromEnvironment(env);
  if(source.provider!=='r2'||source.jurisdiction!==config.jurisdiction||source.bucket!==config.bucket){
    throw new Error('OFFSITE_RESTORE_SOURCE_MISMATCH: evidensen matchar inte konfigurerad R2-destination.');
  }

  fs.mkdirSync(drillDir,{recursive:true,mode:0o700});
  const workDir=path.join(drillDir,'offsite-restore-'+crypto.randomUUID());
  fs.mkdirSync(workDir,{mode:0o700});
  const encryptedPath=path.join(workDir,source.encryptedFile);
  const checksumPath=encryptedPath+'.sha256';
  const restoredPath=path.join(workDir,'verified.sqlite');
  let verified;
  try{
    const target=BackupTarget.createR2EuBackupTarget({config,fetchImpl});
    await target.downloadToFile({
      storageKey:source.encryptedStorageKey,
      filename:encryptedPath,
      expectedSha256:source.encryptedSha256,
      expectedSizeBytes:Number(source.encryptedSizeBytes)
    });
    await target.downloadToFile({
      storageKey:source.checksumStorageKey,
      filename:checksumPath
    });
    const artifact=BackupTarget.inspectEncryptedBackup(encryptedPath);
    if(artifact.sha256!==source.encryptedSha256||artifact.sizeBytes!==Number(source.encryptedSizeBytes)){
      throw new Error('OFFSITE_RESTORE_SOURCE_MISMATCH: nedladdad backup matchar inte upload-evidensen.');
    }

    BackupCrypto.decryptFile(encryptedPath,restoredPath,backupKey);
    fs.chmodSync(restoredPath,0o600);
    verified=verifyDatabase(restoredPath,{requirePrivateObjectSchema:true});
  }finally{
    fs.rmSync(workDir,{recursive:true,force:true});
  }

  const evidence=Object.freeze({
    schemaVersion:1,
    verifiedAt:now.toISOString(),
    provider:'r2',
    jurisdiction:'eu',
    sourceEncryptedSha256:String(source.encryptedSha256).toLowerCase(),
    sourceSizeBytes:Number(source.encryptedSizeBytes),
    encryptedStorageKey:source.encryptedStorageKey,
    checksumStorageKey:source.checksumStorageKey,
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
    restoreCopyRemoved:true,
    downloadedCopiesRemoved:true
  });
  writeEvidence(evidencePath,evidence);
  return evidence;
}
async function main(){
  const evidence=await runOffsiteRestore();
  process.stdout.write(JSON.stringify({verified:true,evidencePath:path.resolve(process.env.ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH),...evidence})+'\n');
}
if(require.main===module){
  main().catch(error=>{
    console.error((error?.code||'OFFSITE_RESTORE_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  });
}
module.exports=Object.freeze({readOffsiteEvidence,runOffsiteRestore,main});
