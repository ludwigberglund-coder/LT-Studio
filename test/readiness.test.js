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
function r2RestoreEvidence(verifiedAt){
  const sha='c'.repeat(64);
  const checksumSha='d'.repeat(64);
  const sourceFile='rollands-2026-09-21T10-00-00.sqlite.enc';
  const sourceStorageKey=`encrypted-sqlite-backups/${sha}/${sourceFile}`;
  return {
    schemaVersion:1,
    verifiedAt,
    sourceProvider:'r2',
    provider:'r2',
    jurisdiction:'eu',
    bucket:'private-backups',
    sourceFile,
    sourceEncryptedSha256:sha,
    sourceSizeBytes:8192,
    sourceStorageKey,
    sourceChecksumStorageKey:sourceStorageKey+'.sha256',
    sourceChecksumSha256:checksumSha,
    sourceChecksumSizeBytes:92,
    remoteDownloadVerified:true,
    remoteChecksumDownloadVerified:true,
    sqliteIntegrity:true,
    foreignKeys:true,
    privateObjectsVerified:true,
    privateObjectSchemaComplete:true,
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
    remoteDownloadRemoved:true,
    restoreCopyRemoved:true
  };
}
function restoreEvidence(verifiedAt){
  return {
    schemaVersion:2,
    verifiedAt,
    sourceEncryptedSha256:'a'.repeat(64),
    sqliteIntegrity:true,
    foreignKeys:true,
    privateObjectsVerified:true,
    privateObjectSchemaComplete:true,
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
    assert.deepEqual(report.checks,{databaseRead:true,databaseWrite:true,diskSpace:true,backup:true,offsiteBackup:true,restoreDrill:true,r2RestoreDrill:true,monitoring:true});
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

test('readiness kräver färskt verifierat R2-offsitebevis i skyddad drift',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-readiness-offsite-'));
  const evidencePath=path.join(dir,'offsite-evidence.json');
  const db=Db.openDatabase(':memory:');
  const now=Date.UTC(2026,8,21,12,0,0);
  const sha='b'.repeat(64);
  const encryptedFile='rollands-2026-09-21T10-00-00.sqlite.enc';
  const valid={
    schemaVersion:1,
    verifiedAt:new Date(now-60*60*1000).toISOString(),
    provider:'r2',
    jurisdiction:'eu',
    bucket:'private-backups',
    encryptedFile,
    encryptedSha256:sha,
    encryptedSizeBytes:4096,
    encryptedStorageKey:`encrypted-sqlite-backups/${sha}/${encryptedFile}`,
    checksumStorageKey:`encrypted-sqlite-backups/${sha}/${encryptedFile}.sha256`,
    checksumSha256:'c'.repeat(64),
    checksumSizeBytes:92,
    remoteEncryptedVerified:true,
    remoteChecksumVerified:true
  };
  try{
    let report=readinessReport({db,databasePath:':memory:',requireOffsiteBackupEvidence:true,offsiteBackupEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);assert.equal(report.checks.offsiteBackup,false);

    fs.writeFileSync(evidencePath,JSON.stringify(valid));
    report=readinessReport({db,databasePath:':memory:',requireOffsiteBackupEvidence:true,offsiteBackupEvidencePath:evidencePath,now});
    assert.equal(report.ok,true);assert.equal(report.checks.offsiteBackup,true);assert.equal(report.offsiteBackupAgeMs,60*60*1000);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,remoteChecksumVerified:false}));
    report=readinessReport({db,databasePath:':memory:',requireOffsiteBackupEvidence:true,offsiteBackupEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);assert.equal(report.checks.offsiteBackup,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,verifiedAt:new Date(now-27*60*60*1000).toISOString()}));
    report=readinessReport({db,databasePath:':memory:',requireOffsiteBackupEvidence:true,offsiteBackupEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);assert.equal(report.checks.offsiteBackup,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,encryptedStorageKey:'encrypted-sqlite-backups/wrong/'+encryptedFile}));
    report=readinessReport({db,databasePath:':memory:',requireOffsiteBackupEvidence:true,offsiteBackupEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);assert.equal(report.checks.offsiteBackup,false);
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

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,privateObjectSchemaComplete:false}));
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


test('readiness kräver färsk verifierad restore från R2 i skyddad drift',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-readiness-r2-restore-'));
  const evidencePath=path.join(dir,'r2-restore-evidence.json');
  const db=Db.openDatabase(':memory:');
  const now=Date.UTC(2026,8,21,12,0,0);
  try{
    let report=readinessReport({db,databasePath:':memory:',requireR2RestoreEvidence:true,r2RestoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);
    assert.equal(report.checks.r2RestoreDrill,false);

    const valid=r2RestoreEvidence(new Date(now-2*24*60*60*1000).toISOString());
    fs.writeFileSync(evidencePath,JSON.stringify(valid));
    report=readinessReport({db,databasePath:':memory:',requireR2RestoreEvidence:true,r2RestoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,true);
    assert.equal(report.checks.r2RestoreDrill,true);
    assert.equal(report.r2RestoreDrillAgeMs,2*24*60*60*1000);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,remoteChecksumDownloadVerified:false}));
    report=readinessReport({db,databasePath:':memory:',requireR2RestoreEvidence:true,r2RestoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);

    fs.writeFileSync(evidencePath,JSON.stringify({...valid,verifiedAt:new Date(now-31*24*60*60*1000).toISOString()}));
    report=readinessReport({db,databasePath:':memory:',requireR2RestoreEvidence:true,r2RestoreEvidencePath:evidencePath,now});
    assert.equal(report.ok,false);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
