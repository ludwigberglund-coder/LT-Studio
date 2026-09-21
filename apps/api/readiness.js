'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEFAULT_MIN_FREE_BYTES=256*1024*1024;
const DEFAULT_BACKUP_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_RESTORE_DRILL_MAX_AGE_MS=30*24*60*60*1000;
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
function restoreDrillEvidence(filename,{now=Date.now(),maxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS}={}){
  try{
    if(!filename||!fs.existsSync(filename)||!fs.statSync(filename).isFile())return{ok:false,ageMs:null};
    const value=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(value.schemaVersion!==2||value.sqliteIntegrity!==true||value.foreignKeys!==true||value.productionDatabaseTouched!==false||value.restoreCopyRemoved!==true)return{ok:false,ageMs:null};
    if(value.privateObjectsVerified!==true||value.privateObjectIssueCount!==0)return{ok:false,ageMs:null};
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
    return{ok:ageMs<=maxAgeMs,ageMs};
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

function readinessReport({db,databasePath=':memory:',backupPath='',restoreEvidencePath='',monitoringEvidencePath='',now=Date.now(),minFreeBytes=DEFAULT_MIN_FREE_BYTES,backupMaxAgeMs=DEFAULT_BACKUP_MAX_AGE_MS,restoreDrillMaxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS,monitoringEvidenceMaxAgeMs=DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS,requireBackup=false,requireRestoreEvidence=false,requireMonitoringEvidence=false}){
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
  let restoreDrill=true,restoreDrillAgeMs=null;
  if(requireRestoreEvidence){
    const evidence=restoreDrillEvidence(restoreEvidencePath,{now,maxAgeMs:restoreDrillMaxAgeMs});
    restoreDrill=evidence.ok;restoreDrillAgeMs=evidence.ageMs;
  }
  let monitoring=true,monitoringAgeMs=null,alertAgeMs=null;
  if(requireMonitoringEvidence){
    const evidence=monitoringEvidence(monitoringEvidencePath,{now,maxAgeMs:monitoringEvidenceMaxAgeMs});
    monitoring=evidence.ok;monitoringAgeMs=evidence.ageMs;alertAgeMs=evidence.alertAgeMs;
  }
  return Object.freeze({ok:databaseRead&&databaseWrite&&diskSpace&&backup&&restoreDrill&&monitoring,checks:{databaseRead,databaseWrite,diskSpace,backup,restoreDrill,monitoring},freeBytes:Number.isFinite(freeBytes)?freeBytes:null,backupAgeMs,restoreDrillAgeMs,monitoringAgeMs,alertAgeMs});
}
module.exports=Object.freeze({DEFAULT_MIN_FREE_BYTES,DEFAULT_BACKUP_MAX_AGE_MS,DEFAULT_RESTORE_DRILL_MAX_AGE_MS,DEFAULT_MONITORING_EVIDENCE_MAX_AGE_MS,latestBackup,verifyBackup,diskFreeBytes,databaseReadOk,databaseWriteOk,restoreDrillEvidence,monitoringEvidence,readinessReport});
