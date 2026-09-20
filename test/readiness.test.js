'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const {readinessReport}=require('../apps/api/readiness.js');
const {createServer}=require('../apps/api/server.js');

function checksum(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}
function writeBackup(dir,name='rollands-test.sqlite',ageMs=0,corruptChecksum=false){
  const file=path.join(dir,name),bytes=Buffer.from('verified-backup-test');
  fs.writeFileSync(file,bytes);
  fs.writeFileSync(file+'.sha256',`${corruptChecksum?'0'.repeat(64):checksum(bytes)}  ${name}\n`);
  if(ageMs){const when=new Date(Date.now()-ageMs);fs.utimesSync(file,when,when);}
  return file;
}

test('readiness kräver läsbar och skrivbar databas',()=>{
  const db=Db.openDatabase(':memory:');
  try{const report=readinessReport({db,databasePath:':memory:',minFreeBytes:1});assert.equal(report.ok,true);assert.deepEqual(report.checks,{databaseRead:true,databaseWrite:true,diskSpace:true,backup:true});}
  finally{db.close()}
});

test('pilot-readiness stoppar saknad, skadad och för gammal backup',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-readiness-'));
  const dbPath=path.join(dir,'platform.sqlite'),backupDir=path.join(dir,'backups');
  fs.mkdirSync(backupDir);
  const db=Db.openDatabase(dbPath);
  try{
    let report=readinessReport({db,databasePath:dbPath,backupPath:backupDir,requireBackup:true,minFreeBytes:1});
    assert.equal(report.ok,false);assert.equal(report.checks.backup,false);
    writeBackup(backupDir);
    report=readinessReport({db,databasePath:dbPath,backupPath:backupDir,requireBackup:true,minFreeBytes:1});
    assert.equal(report.ok,true);assert.equal(report.checks.backup,true);
    fs.rmSync(path.join(backupDir,'rollands-test.sqlite.sha256'));
    report=readinessReport({db,databasePath:dbPath,backupPath:backupDir,requireBackup:true,minFreeBytes:1});
    assert.equal(report.ok,false);assert.equal(report.checks.backup,false);
    fs.rmSync(path.join(backupDir,'rollands-test.sqlite'));
    writeBackup(backupDir,'rollands-stale.sqlite',27*60*60*1000);
    report=readinessReport({db,databasePath:dbPath,backupPath:backupDir,requireBackup:true,minFreeBytes:1,backupMaxAgeMs:26*60*60*1000});
    assert.equal(report.ok,false);assert.equal(report.checks.backup,false);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('HTTP readiness svarar utan autentisering men lämnar inte ut lagringssökvägar',async()=>{
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try{
    const address=runtime.server.address();
    const response=await fetch(`http://127.0.0.1:${address.port}/api/v1/readiness`);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.ok,true);assert.equal(body.service,'rollands-api-v1');
    assert.equal(JSON.stringify(body).includes('/tmp/'),false);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});
