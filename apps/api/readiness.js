'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEFAULT_MIN_FREE_BYTES=256*1024*1024;
const DEFAULT_BACKUP_MAX_AGE_MS=26*60*60*1000;
const DEFAULT_RESTORE_DRILL_MAX_AGE_MS=30*24*60*60*1000;

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
    if(value.schemaVersion!==1||value.sqliteIntegrity!==true||value.foreignKeys!==true||value.productionDatabaseTouched!==false||value.restoreCopyRemoved!==true)return{ok:false,ageMs:null};
    if(!/^[a-f0-9]{64}$/.test(String(value.sourceEncryptedSha256||'').toLowerCase()))return{ok:false,ageMs:null};
    const verifiedAt=Date.parse(String(value.verifiedAt||''));
    if(!Number.isFinite(verifiedAt)||verifiedAt>now+5*60*1000)return{ok:false,ageMs:null};
    const ageMs=Math.max(0,now-verifiedAt);
    return{ok:ageMs<=maxAgeMs,ageMs};
  }catch{return{ok:false,ageMs:null}}
}
function readinessReport({db,databasePath=':memory:',backupPath='',restoreEvidencePath='',now=Date.now(),minFreeBytes=DEFAULT_MIN_FREE_BYTES,backupMaxAgeMs=DEFAULT_BACKUP_MAX_AGE_MS,restoreDrillMaxAgeMs=DEFAULT_RESTORE_DRILL_MAX_AGE_MS,requireBackup=false,requireRestoreEvidence=false}){
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
  return Object.freeze({ok:databaseRead&&databaseWrite&&diskSpace&&backup&&restoreDrill,checks:{databaseRead,databaseWrite,diskSpace,backup,restoreDrill},freeBytes:Number.isFinite(freeBytes)?freeBytes:null,backupAgeMs,restoreDrillAgeMs});
}
module.exports=Object.freeze({DEFAULT_MIN_FREE_BYTES,DEFAULT_BACKUP_MAX_AGE_MS,DEFAULT_RESTORE_DRILL_MAX_AGE_MS,latestBackup,verifyBackup,diskFreeBytes,databaseReadOk,databaseWriteOk,restoreDrillEvidence,readinessReport});
