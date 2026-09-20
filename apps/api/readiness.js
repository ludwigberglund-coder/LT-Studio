'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEFAULT_MIN_FREE_BYTES=256*1024*1024;
const DEFAULT_BACKUP_MAX_AGE_MS=26*60*60*1000;

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
function readinessReport({db,databasePath=':memory:',backupPath='',now=Date.now(),minFreeBytes=DEFAULT_MIN_FREE_BYTES,backupMaxAgeMs=DEFAULT_BACKUP_MAX_AGE_MS,requireBackup=false}){
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
  return Object.freeze({ok:databaseRead&&databaseWrite&&diskSpace&&backup,checks:{databaseRead,databaseWrite,diskSpace,backup},freeBytes:Number.isFinite(freeBytes)?freeBytes:null,backupAgeMs});
}
module.exports=Object.freeze({DEFAULT_MIN_FREE_BYTES,DEFAULT_BACKUP_MAX_AGE_MS,latestBackup,verifyBackup,diskFreeBytes,databaseReadOk,databaseWriteOk,readinessReport});
