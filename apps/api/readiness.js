'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEFAULT_MIN_FREE_BYTES=256*1024*1024;
const DEFAULT_BACKUP_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_R2_STAGING_AUDIT_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_RESTORE_DRILL_MAX_AGE_MS=30*24*60*60*1000;
const DEFAULT_OFFSITE_RESTORE_MAX_AGE_MS=30*24*60*60*1000;
const DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS=7*24*60*60*1000;

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
    return{ok:ageMs<=maxAgeMs,ageMs,sha256:sha,encryptedFile,bucket:String(value.bucket||'').trim(),sizeBytes,encryptedStorageKey:encryptedKey,checksumStorageKey:checksumKey};
  }catch{return{ok:false,ageMs:null}}
}
function offsiteRestoreEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_OFFSITE_RESTORE_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    const sha=String(value.sourceEncryptedSha256||'').trim().toLowerCase();
    const encryptedKey=String(value.encryptedStorageKey||'').trim();
    const checksumKey=String(value.checksumStorageKey||'').trim();
    const sizeBytes=Number(value.sourceSizeBytes);
    if(value.schemaVersion!==1||value.provider!=='r2'||value.jurisdiction!=='eu'||value.remoteDownloadVerified!==true)return{ok:false,ageMs:null};
    if(value.sqliteIntegrity!==true||value.foreignKeys!==true||value.productionDatabaseTouched!==false||value.restoreCopyRemoved!==true||value.downloadedCopiesRemoved!==true)return{ok:false,ageMs:null};
    if(value.privateObjectsVerified!==true||value.privateObjectSchemaComplete!==true||value.privateObjectIssueCount!==0)return{ok:false,ageMs:null};
    if(!/^[a-f0-9]{64}$/.test(sha)||!Number.isSafeInteger(sizeBytes)||sizeBytes<1)return{ok:false,ageMs:null};
    const prefix=`encrypted-sqlite-backups/${sha}/`;
    if(!encryptedKey.startsWith(prefix)||checksumKey!==encryptedKey+'.sha256')return{ok:false,ageMs:null};
    const basename=encryptedKey.slice(prefix.length);
    if(!/^rollands-[0-9A-Za-z._-]+\.sqlite\.enc$/.test(basename))return{ok:false,ageMs:null};
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
    return{ok:ageMs<=maxAgeMs,ageMs,sha256:sha,sizeBytes,encryptedStorageKey:encryptedKey,checksumStorageKey:checksumKey};
  }catch{return{ok:false,ageMs:null}}
}
function monitoringEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null,alertAgeMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(value.schemaVersion!==1||value.readinessProbeSucceeded!==true||value.alertDeliverySucceeded!==true)return{ok:false,ageMs:null,alertAgeMs:null};
    const provider=String(value.provider||'').trim(),endpoint=String(value.endpoint||'').trim(),alertRoute=String(value.alertRoute||'').trim();
    if(provider.length<2||alertRoute.length<3)return{ok:false,ageMs:null,alertAgeMs:null};
    let parsed;try{parsed=new URL(endpoint)}catch{return{ok:false,ageMs:null,alertAgeMs:null}}
    if(parsed.protocol!=='https:'||parsed.hostname==='localhost'||parsed.hostname==='127.0.0.1'||parsed.hostname==='::1')return{ok:false,ageMs:null,alertAgeMs:null};
    if(!parsed.pathname.endsWith('/api/v1/readiness'))return{ok:false,ageMs:null,alertAgeMs:null};
    const checkedAt=Date.parse(String(value.checkedAt||'')),alertTestedAt=Date.parse(String(value.alertTestedAt||''));
    if(!Number.isFinite(checkedAt)||!Number.isFinite(alertTestedAt)||checkedAt>now+5*60*1000||alertTestedAt>now+5*60*1000)return{ok:false,ageMs:null,alertAgeMs:null};
    const ageMs=Math.max(0,now-checkedAt),alertAgeMs=Math.max(0,now-alertTestedAt);
    return{ok:ageMs<=maxAgeMs&&alertAgeMs<=maxAgeMs,ageMs,alertAgeMs};
  }catch{return{ok:false,ageMs:null,alertAgeMs:null}}
}

function readinessReport({db,databasePath=':memory:',backupPath='',offsiteBackupEvidencePath='',restoreEvidencePath='',offsiteRestoreEvidencePath='',monitoringEvidencePath='',now=Date.now(),minFreeBytes=DEFAULT_MIN_FREE_BYTES,backupMaxAgeMs=DEFAULT_BACKUP_MAX_AGE_MS,offsiteBackupMaxAgeMs=DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS,restoreDrillMaxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS,offsiteRestoreMaxAgeMs=DEFAULT_OFFSITE_RESTORE_MAX_AGE_MS,monitoringEvidenceMaxAgeMs=DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS,requireBackup=false,requireOffsiteBackupEvidence=false,requireRestoreEvidence=false,requireOffsiteRestoreEvidence=false,requireMonitoringEvidence=false}){
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
  let offsiteBackup=true,offsiteBackupAgeMs=null;
  if(requireOffsiteBackupEvidence){
    const evidence=offsiteBackupEvidence(offsiteBackupEvidencePath,{now,maxAgeMs:offsiteBackupMaxAgeMs});
    offsiteBackup=evidence.ok;offsiteBackupAgeMs=evidence.ageMs;
  }
  let restoreDrill=true,restoreDrillAgeMs=null;
  if(requireRestoreEvidence){
    const evidence=restoreDrillEvidence(restoreEvidencePath,{now,maxAgeMs:restoreDrillMaxAgeMs});
    restoreDrill=evidence.ok;restoreDrillAgeMs=evidence.ageMs;
  }
  let offsiteRestore=true,offsiteRestoreAgeMs=null;
  if(requireOffsiteRestoreEvidence){
    const evidence=offsiteRestoreEvidence(offsiteRestoreEvidencePath,{now,maxAgeMs:offsiteRestoreMaxAgeMs});
    offsiteRestore=evidence.ok;offsiteRestoreAgeMs=evidence.ageMs;
  }
  let monitoring=true,monitoringAgeMs=null,alertAgeMs=null;
  if(requireMonitoringEvidence){
    const evidence=monitoringEvidence(monitoringEvidencePath,{now,maxAgeMs:monitoringEvidenceMaxAgeMs});
    monitoring=evidence.ok;monitoringAgeMs=evidence.ageMs;alertAgeMs=evidence.alertAgeMs;
  }
  return Object.freeze({ok:databaseRead&&databaseWrite&&diskSpace&&backup&&offsiteBackup&&restoreDrill&&offsiteRestore&&monitoring,checks:{databaseRead,databaseWrite,diskSpace,backup,offsiteBackup,restoreDrill,offsiteRestore,monitoring},freeBytes:Number.isFinite(freeBytes)?freeBytes:null,backupAgeMs,offsiteBackupAgeMs,restoreDrillAgeMs,offsiteRestoreAgeMs,monitoringAgeMs,alertAgeMs});
}
module.exports=Object.freeze({DEFAULT_MIN_FREE_BYTES,DEFAULT_BACKUP_MAX_AGE_MS,DEFAULT_OFFSITE_BACKUP_MAX_AGE_MS,DEFAULT_R2_STAGING_AUDIT_MAX_AGE_MS,DEFAULT_RESTORE_DRILL_MAX_AGE_MS,DEFAULT_OFFSITE_RESTORE_MAX_AGE_MS,DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS,latestBackup,verifyBackup,diskFreeBytes,databaseReadOk,databaseWriteOk,r2StagingAuditEvidence,offsiteBackupEvidence,restoreDrillEvidence,offsiteRestoreEvidence,monitoringEvidence,readinessReport});
