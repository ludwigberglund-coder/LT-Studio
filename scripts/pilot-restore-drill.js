'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BackupCrypto=require('./backup-crypto.js');
const {verifyDatabase}=require('./pilot-restore-verify.js');
const {outsideRepository}=require('./pilot-preflight.js');

function required(name){const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} måste anges.`);return value}
function latestEncryptedBackup(backupDir){
  if(!fs.existsSync(backupDir)||!fs.statSync(backupDir).isDirectory())throw new Error('ROLLANDS_BACKUP_PATH måste vara en befintlig katalog.');
  const rows=fs.readdirSync(backupDir,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&/^rollands-.+\.sqlite\.enc$/.test(entry.name))
    .map(entry=>{const file=path.join(backupDir,entry.name);return{file,name:entry.name,mtimeMs:fs.statSync(file).mtimeMs}})
    .sort((a,b)=>b.mtimeMs-a.mtimeMs||a.name.localeCompare(b.name));
  if(!rows.length)throw new Error('RESTORE_DRILL_BACKUP_MISSING: ingen krypterad backup hittades.');
  return rows[0];
}
function verifyTransportChecksum(source){
  const checksumFile=`${source}.sha256`;
  if(!fs.existsSync(checksumFile))throw new Error('RESTORE_DRILL_CHECKSUM_REQUIRED: checksumfil saknas.');
  const expected=fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0].toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected)||BackupCrypto.sha256File(source)!==expected)throw new Error('RESTORE_DRILL_CHECKSUM_FAILED: krypterad backup matchar inte sin checksumma.');
  return expected;
}
function writeEvidence(filename,value){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const temp=`${filename}.tmp-${crypto.randomUUID()}`;
  try{
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,filename);
    fs.chmodSync(filename,0o600);
  }catch(error){fs.rmSync(temp,{force:true});throw error}
}
function removeSqliteArtifacts(filename){
  for(const suffix of ['', '-wal', '-shm', '-journal'])fs.rmSync(filename+suffix,{force:true});
  return ['', '-wal', '-shm', '-journal'].every(suffix=>!fs.existsSync(filename+suffix));
}
function runDrill({backupDir,drillDir,evidencePath,backupKey,now=new Date(),monotonicNow=()=>Number(process.hrtime.bigint()/1000000n)}){
  const source=latestEncryptedBackup(backupDir);
  const drillStartedAtMs=monotonicNow();
  const nowMs=now.getTime();
  if(!Number.isFinite(nowMs))throw new Error('Restore drill-tiden är ogiltig.');
  if(source.mtimeMs>nowMs+5*60*1000)throw new Error('RESTORE_DRILL_BACKUP_TIME_INVALID: backupfilens tid ligger i framtiden.');
  const backupAgeAtDrillMs=Math.max(0,nowMs-source.mtimeMs);
  const encryptedSha256=verifyTransportChecksum(source.file);
  fs.mkdirSync(drillDir,{recursive:true,mode:0o700});
  const target=path.join(drillDir,`restore-drill-${crypto.randomUUID()}.sqlite`);
  let verified;
  try{
    BackupCrypto.decryptFile(source.file,target,backupKey);
    fs.chmodSync(target,0o600);
    verified=verifyDatabase(target,{requirePrivateObjectSchema:true});
  }finally{
    if(!removeSqliteArtifacts(target))throw new Error('Restore drill kunde inte rensa SQLite-testfiler.');
  }
  const restoreDurationMs=Math.max(0,monotonicNow()-drillStartedAtMs);
  const evidence=Object.freeze({
    schemaVersion:2,
    verifiedAt:now.toISOString(),
    sourceModifiedAt:new Date(source.mtimeMs).toISOString(),
    backupAgeAtDrillMs,
    restoreDurationMs,
    sourceFile:source.name,
    sourceEncryptedSha256:encryptedSha256,
    sourceSizeBytes:fs.statSync(source.file).size,
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
    restoreCopyRemoved:true
  });
  writeEvidence(evidencePath,evidence);
  return evidence;
}
function main(){
  const backupDir=path.resolve(required('ROLLANDS_BACKUP_PATH'));
  const drillDir=path.resolve(required('ROLLANDS_RESTORE_DRILL_PATH'));
  const evidencePath=path.resolve(required('ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH'));
  const backupKey=required('ROLLANDS_BACKUP_ENCRYPTION_KEY');
  if(!outsideRepository(drillDir))throw new Error('ROLLANDS_RESTORE_DRILL_PATH måste ligga utanför Git-repositoryt.');
  if(!outsideRepository(evidencePath))throw new Error('ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH måste ligga utanför Git-repositoryt.');
  const production=process.env.ROLLANDS_DATABASE_PATH?path.resolve(process.env.ROLLANDS_DATABASE_PATH):'';
  if(production&&(production===evidencePath||production.startsWith(drillDir+path.sep)))throw new Error('Restore drill får inte använda produktionsdatabasens sökväg.');
  const evidence=runDrill({backupDir,drillDir,evidencePath,backupKey});
  console.log(JSON.stringify({verified:true,evidencePath,...evidence}));
}
if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports=Object.freeze({latestEncryptedBackup,verifyTransportChecksum,writeEvidence,removeSqliteArtifacts,runDrill,main});
