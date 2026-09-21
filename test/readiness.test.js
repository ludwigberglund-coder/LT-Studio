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
function restoreEvidence(verifiedAt){
  return {
    schemaVersion:2,
    verifiedAt,
    sourceEncryptedSha256:'a'.repeat(64),
    sqliteIntegrity:true,
    foreignKeys:true,
    privateObjectsVerified:true,
    privateObjectCount:3,
    verifiedPrivateObjectCount:3,
    privateObjectBytes:600,
    privateObjectIssueCount:0,
    privateObjectsByKind:{
      document:{objects:1,verified:1,bytes:100},
      'supplier-invoice':{objects:1,verified:1,bytes:200},
      'customer-invoice-pdf':{objects:1,verified:1,bytes:300}
    },
    productionDatabaseTouched:false,
    restoreCopyRemoved:true
  };
}

test('readiness kräver läsbar och skrivbar databas',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const report=readinessReport({db,databasePath:':memory:',minFreeBytes:1});
    assert.equal(report.ok,true);
    assert.deepEqual(report.checks,{databaseRead:true,databaseWrite:true,diskSpace:true,backup:true,restoreDrill:true,monitoring:true});
  }finally{db.close()}
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

test('restore drill evidence kräver färsk schema-2-verifiering av alla privata objekt',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-readiness-drill-'));
  const evidencePath=path.join(dir,'restore-evidence.json');
  const now=Date.UTC(2026,8,20,12,0,0);
  try{
    const valid=restoreEvidence(new Date(now-2*24*60*60*1000).toISOString());
    fs.writeFileSync(evidencePath,JSON.stringify(valid));
    let evidence=require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now,maxAgeMs:30*24*60*60*1000});
    assert.equal(evidence.ok,true);
    assert.equal(evidence.ageMs,2*24*60*60*1000);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,schemaVersion:1}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,privateObjectsVerified:false}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,privateObjectIssueCount:1}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,verifiedPrivateObjectCount:2}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,privateObjectsByKind:{
      ...valid.privateObjectsByKind,
      'supplier-invoice':{objects:1,verified:1,bytes:199}
    }}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,verifiedAt:new Date(now-31*24*60*60*1000).toISOString()}));
    evidence=require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now,maxAgeMs:30*24*60*60*1000});
    assert.equal(evidence.ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,verifiedAt:new Date(now+10*60*1000).toISOString()}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,productionDatabaseTouched:true}));
    assert.equal(require('../apps/api/readiness.js').restoreDrillEvidence(evidencePath,{now}).ok,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('readiness blir röd när restore-bevis saknas, är gammalt eller saknar privat objektintegritet',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-readiness-drill-report-'));
  const db=Db.openDatabase(':memory:'),evidencePath=path.join(dir,'restore-evidence.json');
  const now=Date.UTC(2026,8,20,12,0,0);
  try{
    let report=readinessReport({db,databasePath:':memory:',requireRestoreEvidence:true,restoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);assert.equal(report.checks.restoreDrill,false);

    const valid=restoreEvidence(new Date(now-24*60*60*1000).toISOString());
    fs.writeFileSync(evidencePath,JSON.stringify(valid));
    report=readinessReport({db,databasePath:':memory:',requireRestoreEvidence:true,restoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,true);assert.equal(report.checks.restoreDrill,true);assert.equal(report.restoreDrillAgeMs,24*60*60*1000);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,privateObjectIssueCount:1}));
    report=readinessReport({db,databasePath:':memory:',requireRestoreEvidence:true,restoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);assert.equal(report.checks.restoreDrill,false);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
