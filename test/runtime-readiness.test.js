'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Readiness=require('../apps/api/readiness.js');
const {createServer}=require('../apps/api/server.js');

test('memory database passes integrity, foreign-key and write readiness probes',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Readiness.initializeReadiness(db);
    const report=Readiness.evaluateReadiness({db,databasePath:':memory:'});
    assert.equal(report.ok,true);
    assert.deepEqual(report.checks,{database:'ok',storage:'ok'});
    assert.deepEqual(report.issues,[]);
  }finally{db.close()}
});

test('foreign-key corruption makes database not ready without exposing row data',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Readiness.initializeReadiness(db);
    db.exec('PRAGMA foreign_keys=OFF; CREATE TABLE readiness_orphan(id TEXT PRIMARY KEY,company_id TEXT REFERENCES companies(id)); INSERT INTO readiness_orphan VALUES("probe","missing-company"); PRAGMA foreign_keys=ON;');
    const report=Readiness.evaluateReadiness({db,databasePath:':memory:'});
    assert.equal(report.ok,false);
    assert.equal(report.checks.database,'failed');
    assert.ok(report.issues.includes('READINESS_FOREIGN_KEY_VIOLATION'));
    assert.equal(JSON.stringify(report).includes('missing-company'),false);
  }finally{db.close()}
});

test('closed database fails readiness instead of throwing raw SQLite details',()=>{
  const db=Db.openDatabase(':memory:');
  Readiness.initializeReadiness(db);
  db.close();
  const report=Readiness.evaluateReadiness({db,databasePath:':memory:'});
  assert.equal(report.ok,false);
  assert.equal(report.checks.database,'failed');
  assert.ok(report.issues.includes('READINESS_DATABASE_UNAVAILABLE'));
});

test('persistent storage checks private permissions and configurable free-space threshold',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-ready-')),file=path.join(dir,'platform.sqlite');
  fs.writeFileSync(file,'probe',{mode:0o600});
  try{
    let report=Readiness.probeStorage(file,{requirePrivatePermissions:true,minFreeBytes:0});
    assert.equal(report.ok,true);
    fs.chmodSync(file,0o644);
    report=Readiness.probeStorage(file,{requirePrivatePermissions:true,minFreeBytes:0});
    assert.equal(report.ok,false);
    assert.ok(report.issues.includes('READINESS_DATABASE_PERMISSIONS_UNSAFE'));
    fs.chmodSync(file,0o600);
    report=Readiness.probeStorage(file,{requirePrivatePermissions:true,minFreeBytes:Number.MAX_SAFE_INTEGER});
    assert.equal(report.ok,false);
    assert.ok(report.issues.includes('READINESS_STORAGE_LOW'));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

async function withServer(options,callback){
  const runtime=createServer({databasePath:':memory:',secureCookies:false,...options});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+runtime.server.address().port;
  try{await callback(base)}finally{await new Promise(resolve=>runtime.close(resolve))}
}

test('health is liveness while ready is an unauthenticated sanitized readiness signal',()=>withServer({},async base=>{
  const health=await fetch(base+'/api/v1/health'),healthBody=await health.json();
  assert.equal(health.status,200);assert.equal(healthBody.status,'alive');
  const ready=await fetch(base+'/api/v1/ready'),readyBody=await ready.json();
  assert.equal(ready.status,200);assert.equal(readyBody.status,'ready');
  assert.deepEqual(readyBody.checks,{database:'ok',storage:'ok'});
  assert.equal(ready.headers.get('cache-control'),'no-store');
}));

test('failed readiness returns 503 while liveness remains 200',()=>withServer({
  readinessProbe:()=>({ok:false,status:'not-ready',checks:{database:'failed',storage:'ok'},issues:['READINESS_DATABASE_UNAVAILABLE']})
},async base=>{
  const ready=await fetch(base+'/api/v1/ready'),body=await ready.json();
  assert.equal(ready.status,503);
  assert.equal(body.ok,false);
  assert.equal(body.status,'not-ready');
  assert.deepEqual(body.issues,['READINESS_DATABASE_UNAVAILABLE']);
  assert.equal((await fetch(base+'/api/v1/health')).status,200);
}));
