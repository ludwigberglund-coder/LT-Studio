'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BackupTarget=require('./r2-eu-backup-target.js');
const BackupCrypto=require('./backup-crypto.js');
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

function removeTempSqlite(filename){
  for(const suffix of ['', '-wal', '-shm', '-journal'])fs.rmSync(filename+suffix,{force:true});
}

function verifySyntheticStagingArtifact(artifact,backupKey){
  if(!artifact?.filename)throw new Error('STAGING_BACKUP_ARTIFACT_REQUIRED');
  const key=String(backupKey||'');
  if(!key)throw new Error('ROLLANDS_BACKUP_ENCRYPTION_KEY måste anges för staging-upload.');
  const temp=artifact.filename+'.synthetic-verify-'+crypto.randomUUID()+'.sqlite';
  try{
    BackupCrypto.decryptFile(artifact.filename,temp,key);
    fs.chmodSync(temp,0o600);
    verifyDatabase(temp,{requirePrivateObjectSchema:true,requireSyntheticStaging:true});
    return true;
  }finally{
    removeTempSqlite(temp);
  }
}

async function main(){
  const backupDir=path.resolve(required('ROLLANDS_BACKUP_PATH'));
  const evidencePath=path.resolve(required('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH'));
  if(!outsideRepository(backupDir)){
    throw new Error('ROLLANDS_BACKUP_PATH måste ligga utanför Git-repositoryt.');
  }
  if(!outsideRepository(evidencePath)){
    throw new Error('ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH måste ligga utanför Git-repositoryt.');
  }

  const artifact=BackupTarget.latestEncryptedBackup(backupDir);
  if(String(process.env.ROLLANDS_ENV||'').trim().toLowerCase()==='staging'){
    verifySyntheticStagingArtifact(artifact,required('ROLLANDS_BACKUP_ENCRYPTION_KEY'));
  }
  const config=BackupTarget.configFromEnvironment(process.env);
  const target=BackupTarget.createR2EuBackupTarget({config});
  const uploaded=await BackupTarget.uploadEncryptedBackup({artifact,target});
  if(!uploaded.verified)throw new Error('OFFSITE_BACKUP_NOT_VERIFIED');

  const evidence=Object.freeze({
    schemaVersion:1,
    verifiedAt:new Date().toISOString(),
    provider:'r2',
    jurisdiction:config.jurisdiction,
    bucket:config.bucket,
    encryptedFile:uploaded.basename,
    encryptedSha256:uploaded.sha256,
    encryptedSizeBytes:uploaded.sizeBytes,
    encryptedStorageKey:uploaded.storageKey,
    checksumStorageKey:uploaded.checksumStorageKey,
    remoteEncryptedVerified:true,
    remoteChecksumVerified:true
  });
  writeEvidence(evidencePath,evidence);

  process.stdout.write(JSON.stringify({
    verified:true,
    provider:evidence.provider,
    jurisdiction:evidence.jurisdiction,
    encryptedFile:evidence.encryptedFile,
    encryptedSha256:evidence.encryptedSha256,
    encryptedSizeBytes:evidence.encryptedSizeBytes,
    evidencePath
  })+'\n');
}

if(require.main===module){
  main().catch(error=>{
    console.error((error?.code||'OFFSITE_BACKUP_FAILED')+': '+(error?.message||String(error)));
    process.exitCode=1;
  });
}

module.exports=Object.freeze({writeEvidence,removeTempSqlite,verifySyntheticStagingArtifact,main});
