'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEFAULT_MIN_FREE_BYTES=256*1024*1024;
const DEFAULT_BACKUP_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_R2_STAGING_AUDIT_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_RESTORE_DRILL_MAX_AGE_MS=30*24*60*60*1000;
const DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS=7*24*60*60*1000;
const EVIDENCE_PLACEHOLDER=/REPLACE_WITH|example\.invalid|changeme|placeholder|TBD|TO_BE_DECIDED/i;

function sha256File(filename){return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}
function latestBackup(backupPath){
  if(!backupPath||!fs.existsSync(backupPath)||!fs.statSync(backupPath).isDirectory())return null;
  const rows=fs.readdirSync(backupPath,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&/^rollands-.*\.sqlite$/.test(entry.name))
    .map(entry=>{const file=path.join(backupPath,entry.name);return{file,name:entry.name,mtimeMs:fs.statSync(file).mtimeMs}})
    .sort((a,b)=>b.mtimeMs-a.mtimeMs);
  return rows[0]||null;
}
function verifyBackup(candidate){
  if(!candidate)return false;
  const checksumFile=`${candidate.file}.sha256`;
  if(!fs.existsSync(checksumFile))return false;
  const expected=fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0].toLowerCase();
  return /^[a-f0-9]{64}$/.test(expected)&&expected===sha256File(candidate.file);
}
function diskFreeBytes(databasePath){
  if(!databasePath||databasePath===':memory:')return Infinity;
  const stat=fs.statfsSync(path.dirname(path.resolve(databasePath)));
  return Number(stat.bavail)*Number(stat.bsize);
}
function databaseReadOk(db){try{return db.prepare('SELECT 1 AS ok').get().ok===1}catch{return false}}
function databaseWriteOk(db){
  try{db.exec('BEGIN IMMEDIATE; ROLLBACK;');return true}
  catch{try{db.exec('ROLLBACK;')}catch{}return false}
}
function r2StagingAuditEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_R2_STAGING_AUDIT_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    const manifestSha256=String(value.sourceManifestSha256||'').trim().toLowerCase();
    const objectCount=Number(value.sourceObjectCount),totalBytes=Number(value.sourceTotalBytes);
    const readyCount=Number(value.readyCount),verifiedCount=Number(value.verifiedExternalCount);
    const missingReadyCount=Number(value.missingReadyCount),issueCount=Number(value.issueCount);
    const bucket=String(value.target?.bucket||'').trim();
    if(value.schemaVersion!==1||value.ok!==true||value.sourceOk!==true||value.sourceProvider!=='sqlite'||value.targetProvider!=='r2')return{ok:false,ageMs:null};
    if(value.target?.provider!=='r2'||value.target?.jurisdiction!=='eu'||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bucket))return{ok:false,ageMs:null};
    if(!/^[a-f0-9]{64}$/.test(manifestSha256))return{ok:false,ageMs:null};
    if(!Number.isSafeInteger(objectCount)||objectCount<0||!Number.isSafeInteger(totalBytes)||totalBytes<0)return{ok:false,ageMs:null};
    if(readyCount!==objectCount||verifiedCount!==objectCount||missingReadyCount!==0||issueCount!==0)return{ok:false,ageMs:null};
    if(!Array.isArray(value.issues)||value.issues.length!==0)return{ok:false,ageMs:null};
    const byKind=value.countsByKind;
    if(!byKind||typeof byKind!=='object')return{ok:false,ageMs:null};
    const requiredKinds=['document','supplier-invoice','customer-invoice-pdf'];
    let countedObjects=0,countedReady=0,countedVerified=0,countedBytes=0;
    for(const kind of requiredKinds){
      const row=byKind[kind];
      if(!row)return{ok:false,ageMs:null};
      const objects=Number(row.objects),ready=Number(row.ready),verified=Number(row.verified),bytes=Number(row.bytes);
      if(!Number.isSafeInteger(objects)||objects<0||ready!==objects||verified!==objects||!Number.isSafeInteger(bytes)||bytes<0)return{ok:false,ageMs:null};
      countedObjects+=objects;countedReady+=ready;countedVerified+=verified;countedBytes+=bytes;
    }
    if(countedObjects!==objectCount||countedReady!==readyCount||countedVerified!==verifiedCount||countedBytes!==totalBytes)return{ok:false,ageMs:null};
    const auditedAt=Date.parse(String(value.auditedAt||''));
    if(!Number.isFinite(auditedAt)||auditedAt>now+5*60*1000)return{ok:false,ageMs:null};
    const ageMs=Math.max(0,now-auditedAt);
    return{ok:ageMs<=maxAgeMs,ageMs,manifestSha256,objectCount,totalBytes,bucket};
  }catch{return{ok:false,ageMs:null}}
}
function restoreDrillEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(value.schemaVersion!==2||value.sqliteIntegrity!==true||value.foreignKeys!==true||value.productionDatabaseTouched!==false||value.restoreCopyRemoved!==true)return{ok:false,ageMs:null};
    if(value.privateObjectsVerified!==true||value.privateObjectSchemaComplete!==true||value.privateObjectIssueCount!==0)return{ok:false,ageMs:null};
    const objectCount=Number(value.privateObjectCount),verifiedCount=Number(value.verifiedPrivateObjectCount),objectBytes=Number(value.privateObjectBytes);
    if(!Number.isSafeInteger(objectCount)||objectCount<0||verifiedCount!==objectCount||!Number.isSafeInteger(objectBytes)||objectBytes<0)return{ok:false,ageMs:null};
    const byKind=value.privateObjectsByKind;
    if(!byKind||typeof byKind!=='object')return{ok:false,ageMs:null};
    const requiredKinds=['document','supplier-invoice','customer-invoice-pdf'];
    let countedObjects=0,countedVerified=0,countedBytes=0;
    for(const kind of requiredKinds){
      const row=byKind[kind];
      if(!row||!Number.isSafeInteger(Number(row.objects))||Number(row.objects)<0||!Number.isSafeInteger(Number(row.verified))||Number(row.verified)<0||!Number.isSafeInteger(Number(row.bytes))||Number(row.bytes)<0)return{ok:false,ageMs:null};
      countedObjects+=Number(row.objects);countedVerified+=Number(row.verified);countedBytes+=Number(row.bytes);
    }
    if(countedObjects!==objectCount||countedVerified!==verifiedCount||countedBytes!==objectBytes)return{ok:false,ageMs:null};
    if(!/^[a-f0-9]{64}$/.test(String(value.sourceEncryptedSha256||'').toLowerCase()))return{ok:false,ageMs:null};
    const verifiedAt=Date.parse(String(value.verifiedAt||''));
    if(!Number.isFinite(verifiedAt)||verifiedAt>now+5*60*1000)return{ok:false,ageMs:null};
    const ageMs=Math.max(0,now-verifiedAt);
    return{ok:ageMs<=maxAgeMs,ageMs,sha256:String(value.sourceEncryptedSha256||'').toLowerCase(),sourceFile:String(value.sourceFile||'').trim(),sourceSizeBytes:Number(value.sourceSizeBytes||0)};
  }catch{return{ok:false,ageMs:null}}
}
function r2RestoreDrillEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(value.schemaVersion!==1||value.sourceProvider!=='r2'||value.provider!=='r2'||value.jurisdiction!=='eu')return{ok:false,ageMs:null};
    if(value.remoteDownloadVerified!==true||value.productionDatabaseTouched!==false||value.remoteDownloadRemoved!==true||value.restoreCopyRemoved!==true)return{ok:false,ageMs:null};
    if(value.sqliteIntegrity!==true||value.foreignKeys!==true||value.privateObjectsVerified!==true||value.privateObjectSchemaComplete!==true||value.privateObjectIssueCount!==0)return{ok:false,ageMs:null};

    const sha256=String(value.sourceEncryptedSha256||'').trim().toLowerCase();
    const sourceFile=String(value.sourceFile||'').trim();
    const sourceStorageKey=String(value.sourceStorageKey||'').trim();
    const bucket=String(value.bucket||'').trim();
    const sizeBytes=Number(value.sourceSizeBytes);
    if(!/^[a-f0-9]{64}$/.test(sha256)||!/^rollands-[0-9A-Za-z._-]+\.sqlite\.enc$/.test(sourceFile))return{ok:false,ageMs:null};
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1)return{ok:false,ageMs:null};
    if(sourceStorageKey!==`encrypted-sqlite-backups/${sha256}/${sourceFile}`)return{ok:false,ageMs:null};
    if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(bucket))return{ok:false,ageMs:null};

    const objectCount=Number(value.privateObjectCount),verifiedCount=Number(value.verifiedPrivateObjectCount),objectBytes=Number(value.privateObjectBytes);
    if(!Number.isSafeInteger(objectCount)||objectCount<0||verifiedCount!==objectCount||!Number.isSafeInteger(objectBytes)||objectBytes<0)return{ok:false,ageMs:null};
    const byKind=value.privateObjectsByKind;
    if(!byKind||typeof byKind!=='object')return{ok:false,ageMs:null};
    const requiredKinds=['document','supplier-invoice','customer-invoice-pdf'];
    let countedObjects=0,countedVerified=0,countedBytes=0;
    for(const kind of requiredKinds){
      const row=byKind[kind];
      if(!row||!Number.isSafeInteger(Number(row.objects))||Number(row.objects)<0||!Number.isSafeInteger(Number(row.verified))||Number(row.verified)<0||!Number.isSafeInteger(Number(row.bytes))||Number(row.bytes)<0)return{ok:false,ageMs:null};
      countedObjects+=Number(row.objects);countedVerified+=Number(row.verified);countedBytes+=Number(row.bytes);
    }
    if(countedObjects!==objectCount||countedVerified!==verifiedCount||countedBytes!==objectBytes)return{ok:false,ageMs:null};

    const verifiedAt=Date.parse(String(value.verifiedAt||''));
    if(!Number.isFinite(verifiedAt)||verifiedAt>now+5*60*1000)return{ok:false,ageMs:null};
    const ageMs=Math.max(0,now-verifiedAt);
    return{ok:ageMs<=maxAgeMs,ageMs,sha256,sourceFile,sizeBytes,bucket};
  }catch{return{ok:false,ageMs:null}}
}
function offsiteBackupEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    const sha=String(value.encryptedSha256||'').trim().toLowerCase();
    const encryptedFile=String(value.encryptedFile||'').trim();
    const encryptedKey=String(value.encryptedStorageKey||'').trim();
    const checksumKey=String(value.checksumStorageKey||'').trim();
    const sizeBytes=Number(value.encryptedSizeBytes);
    if(value.schemaVersion!==1||value.provider!=='r2'||value.jurisdiction!=='eu')return{ok:false,ageMs:null};
    if(value.remoteEncryptedVerified!==true||value.remoteChecksumVerified!==true)return{ok:false,ageMs:null};
    if(!/^[a-f0-9]{64}$/.test(sha)||!/^rollands-[0-9A-Za-z._-]+\.sqlite\.enc$/.test(encryptedFile))return{ok:false,ageMs:null};
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes<1)return{ok:false,ageMs:null};
    const prefix=`encrypted-sqlite-backups/${sha}/`;
    if(encryptedKey!==prefix+encryptedFile||checksumKey!==prefix+encryptedFile+'.sha256')return{ok:false,ageMs:null};
    const verifiedAt=Date.parse(String(value.verifiedAt||''));
    if(!Number.isFinite(verifiedAt)||verifiedAt>now+5*60*1000)return{ok:false,ageMs:null};
    const ageMs=Math.max(0,now-verifiedAt);
    return{ok:ageMs<=maxAgeMs,ageMs,sha256:sha,encryptedFile,bucket:String(value.bucket||'').trim(),sizeBytes};
  }catch{return{ok:false,ageMs:null}}
}
function stagingEvidenceConsistency({r2Audit,offsite,restore,r2Restore,expectedObjectBucket='',expectedBackupBucket=''}={}){
  const objectBucket=String(expectedObjectBucket||'').trim();
  const backupBucket=String(expectedBackupBucket||'').trim();
  if(!r2Audit?.ok||!offsite?.ok||!restore?.ok||!r2Restore?.ok||!objectBucket||!backupBucket)return false;
  if(r2Audit.bucket!==objectBucket||offsite.bucket!==backupBucket||r2Restore.bucket!==backupBucket)return false;
  const sameSha=offsite.sha256===restore.sha256&&offsite.sha256===r2Restore.sha256;
  const sameFile=offsite.encryptedFile===restore.sourceFile&&offsite.encryptedFile===r2Restore.sourceFile;
  const sameSize=offsite.sizeBytes===restore.sourceSizeBytes&&offsite.sizeBytes===r2Restore.sizeBytes;
  return sameSha&&sameFile&&sameSize;
}
function monitoringEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null,alertAgeMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(value.schemaVersion!==1||value.readinessProbeSucceeded!==true||value.alertDeliverySucceeded!==true)return{ok:false,ageMs:null,alertAgeMs:null};
    const provider=String(value.provider||'').trim(),endpoint=String(value.endpoint||'').trim(),alertRoute=String(value.alertRoute||'').trim();
    const alertTestReference=String(value.alertTestReference||'').trim(),alertObserver=String(value.alertObserver||'').trim();
    if(provider.length<2||alertRoute.length<3||alertTestReference.length<6||alertObserver.length<3)return{ok:false,ageMs:null,alertAgeMs:null};
    if([provider,alertRoute,alertTestReference,alertObserver].some(item=>EVIDENCE_PLACEHOLDER.test(item)))return{ok:false,ageMs:null,alertAgeMs:null};
    let parsed;try{parsed=new URL(endpoint)}catch{return{ok:false,ageMs:null,alertAgeMs:null}}
    if(parsed.protocol!=='https:'||parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1'||parsed.hostname==='::1')return{ok:false,ageMs:null,alertAgeMs:null};
    if(parsed.pathname!=='/api/v1/readiness/core')return{ok:false,ageMs:null,alertAgeMs:null};
    const checkedAt=Date.parse(String(value.checkedAt||'')),alertTestedAt=Date.parse(String(value.alertTestedAt||''));
    if(!Number.isFinite(checkedAt)||!Number.isFinite(alertTestedAt)||checkedAt>now+5*60*1000||alertTestedAt>now+5*60*1000)return{ok:false,ageMs:null,alertAgeMs:null};
    const ageMs=Math.max(0,now-checkedAt),alertAgeMs=Math.max(0,now-alertTestedAt);
    return{ok:ageMs<=maxAgeMs&&alertAgeMs<=maxAgeMs,ageMs,alertAgeMs};
  }catch{return{ok:false,ageMs:null,alertAgeMs:null}}
}

function readinessReport({db,databasePath=':memory:',backupPath='',offsiteBackupEvidencePath='',r2StagingAuditEvidencePath='',restoreEvidencePath='',r2RestoreEvidencePath='',monitoringEvidencePath='',expectedR2StagingBucket='',expectedR2BackupBucket='',now=Date.now(),minFreeBytes=DEFAULT_MIN_FREE_BYTES,backupMaxAgeMs=DEFAULT_BACKUP_MAX_AGE_MS,offsiteBackupMaxAgeMs=DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS,r2StagingAuditMaxAgeMs=DEFAULT_R2_STAGING_AUDIT_MAX_AGE_MS,restoreDrillMaxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS,monitoringEvidenceMaxAgeMs=DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS,requireBackup=false,requireOffsiteBackupEvidence=false,requireR2StagingAuditEvidence=false,requireRestoreEvidence=false,requireR2RestoreEvidence=false,requireStagingEvidenceConsistency=false,requireMonitoringEvidence=false}){
  const databaseRead=databaseReadOk(db);
  const databaseWrite=databaseWriteOk(db);
  let freeBytes=0,diskSpace=true;
  try{freeBytes=diskFreeBytes(databasePath);diskSpace=freeBytes>=minFreeBytes}catch{diskSpace=false}
  let backup=true,backupAgeMs=null;
  if(requireBackup){
    const candidate=latestBackup(backupPath);
    if(candidate){backupAgeMs=Math.max(0,now-candidate.mtimeMs);backup=backupAgeMs<=backupMaxAgeMs&&verifyBackup(candidate)}
    else backup=false;
  }
  let offsiteBackup=true,offsiteBackupAgeMs=null,offsiteEvidenceResult={ok:false};
  if(requireOffsiteBackupEvidence||requireStagingEvidenceConsistency){
    offsiteEvidenceResult=offsiteBackupEvidence(offsiteBackupEvidencePath,{now,maxAgeMs:offsiteBackupMaxAgeMs});
    if(requireOffsiteBackupEvidence){offsiteBackup=offsiteEvidenceResult.ok;offsiteBackupAgeMs=offsiteEvidenceResult.ageMs;}
  }
  let r2StagingAudit=true,r2StagingAuditAgeMs=null,r2AuditEvidenceResult={ok:false};
  if(requireR2StagingAuditEvidence||requireStagingEvidenceConsistency){
    r2AuditEvidenceResult=r2StagingAuditEvidence(r2StagingAuditEvidencePath,{now,maxAgeMs:r2StagingAuditMaxAgeMs});
    if(requireR2StagingAuditEvidence){r2StagingAudit=r2AuditEvidenceResult.ok;r2StagingAuditAgeMs=r2AuditEvidenceResult.ageMs;}
  }
  let restoreDrill=true,restoreDrillAgeMs=null,restoreEvidenceResult={ok:false};
  if(requireRestoreEvidence||requireStagingEvidenceConsistency){
    restoreEvidenceResult=restoreDrillEvidence(restoreEvidencePath,{now,maxAgeMs:restoreDrillMaxAgeMs});
    if(requireRestoreEvidence){restoreDrill=restoreEvidenceResult.ok;restoreDrillAgeMs=restoreEvidenceResult.ageMs;}
  }
  let r2RestoreDrill=true,r2RestoreDrillAgeMs=null,r2RestoreEvidenceResult={ok:false};
  if(requireR2RestoreEvidence||requireStagingEvidenceConsistency){
    r2RestoreEvidenceResult=r2RestoreDrillEvidence(r2RestoreEvidencePath,{now,maxAgeMs:restoreDrillMaxAgeMs});
    if(requireR2RestoreEvidence){r2RestoreDrill=r2RestoreEvidenceResult.ok;r2RestoreDrillAgeMs=r2RestoreEvidenceResult.ageMs;}
  }
  const stagingEvidenceConsistent=!requireStagingEvidenceConsistency||stagingEvidenceConsistency({
    r2Audit:r2AuditEvidenceResult,
    offsite:offsiteEvidenceResult,
    restore:restoreEvidenceResult,
    r2Restore:r2RestoreEvidenceResult,
    expectedObjectBucket:expectedR2StagingBucket,
    expectedBackupBucket:expectedR2BackupBucket
  });
  let monitoring=true,monitoringAgeMs=null,alertAgeMs=null;
  if(requireMonitoringEvidence){
    const evidence=monitoringEvidence(monitoringEvidencePath,{now,maxAgeMs:monitoringEvidenceMaxAgeMs});
    monitoring=evidence.ok;monitoringAgeMs=evidence.ageMs;alertAgeMs=evidence.alertAgeMs;
  }
  return Object.freeze({ok:databaseRead&&databaseWrite&&diskSpace&&backup&&offsiteBackup&&r2StagingAudit&&restoreDrill&&r2RestoreDrill&&stagingEvidenceConsistent&&monitoring,checks:{databaseRead,databaseWrite,diskSpace,backup,offsiteBackup,r2StagingAudit,restoreDrill,r2RestoreDrill,stagingEvidenceConsistent,monitoring},freeBytes:Number.isFinite(freeBytes)?freeBytes:null,backupAgeMs,offsiteBackupAgeMs,r2StagingAuditAgeMs,restoreDrillAgeMs,r2RestoreDrillAgeMs,monitoringAgeMs,alertAgeMs});
}
module.exports=Object.freeze({EVIDENCE_PLACEHOLDER,DEFAULT_MIN_FREE_BYTES,DEFAULT_BACKUP_MAX_AGE_MS,DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS,DEFAULT_R2_STAGING_AUDIT_MAX_AGE_MS,DEFAULT_RESTORE_DRILL_MAX_AGE_MS,DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS,latestBackup,verifyBackup,diskFreeBytes,databaseReadOk,databaseWriteOk,r2StagingAuditEvidence,offsiteBackupEvidence,restoreDrillEvidence,r2RestoreDrillEvidence,stagingEvidenceConsistency,monitoringEvidence,readinessReport});
