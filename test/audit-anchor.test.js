'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const Anchor=require('../scripts/audit-anchor.js');
const R2Anchor=require('../scripts/audit-anchor-r2.js');

function seed(filename){
  const db=Db.openDatabase(filename);
  const company=Db.createCompany(db,{legalName:'Audit Anchor AB',displayName:'Audit Anchor',orgNumber:'559990-9901'});
  const user=Db.createUser(db,{username:'anchor-user',displayName:'Anchor User',passwordHash:'test-password-hash'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'CREATE',entityType:'fixture',entityId:'one',details:{value:1}});
  Db.appendSecurityEvent(db,{kind:'login-warning',severity:'warning',fingerprintHash:'a'.repeat(64),details:{attempts:2}});
  const operator=Db.createPlatformOperator(db,{
    username:'anchor-operator',
    displayName:'Anchor Operator',
    passwordHash:'operator-password-hash',
    mfaSecretEncrypted:'encrypted-secret'
  });
  Db.appendPlatformOperatorAudit(db,{operatorId:operator.id,action:'READINESS_VIEW',details:{ok:true}});
  return{db,company,user,operator};
}

function r2Env(overrides={}){
  return{
    ROLLANDS_ENV:'staging',
    R2_AUDIT_ENABLED:'1',
    R2_AUDIT_JURISDICTION:'eu',
    R2_AUDIT_ACCOUNT_ID:'a'.repeat(32),
    R2_AUDIT_BUCKET:'lt-studio-audit-anchor',
    R2_AUDIT_ACCESS_KEY_ID:'audit-access-key',
    R2_AUDIT_SECRET_ACCESS_KEY:'audit-secret-key-1234567890',
    R2_STAGING_BUCKET:'lt-studio-private-staging',
    R2_STAGING_ACCESS_KEY_ID:'staging-access-key',
    R2_BACKUP_BUCKET:'lt-studio-backup-staging',
    R2_BACKUP_ACCESS_KEY_ID:'backup-access-key',
    ...overrides
  };
}

function fakeR2(){
  const objects=new Map();
  return{
    objects,
    async fetchImpl(url,options={}){
      const key=decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
      if(options.method==='PUT'){
        if(objects.has(key))return new Response('',{status:412});
        objects.set(key,Buffer.from(options.body));
        return new Response('',{status:200});
      }
      if(options.method==='GET'){
        if(!objects.has(key))return new Response('',{status:404});
        const bytes=objects.get(key);
        return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});
      }
      return new Response('',{status:405});
    }
  };
}

test('audit anchor covers all three audit streams and remains valid after later appends',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-audit-anchor-'));
  const filename=path.join(dir,'platform.sqlite');
  const {db,company,user,operator}=seed(filename);
  try{
    const anchor=Anchor.createAuditAnchorFromDatabase(filename,{now:Date.parse('2026-09-21T18:00:00Z')});
    assert.equal(anchor.streams.auditEvents.count,1);
    assert.equal(anchor.streams.securityEvents.count,1);
    assert.equal(anchor.streams.operatorAuditEvents.count,1);
    assert.match(anchor.rootSha256,/^[a-f0-9]{64}$/);
    assert.equal(Anchor.verifyAuditAnchor(filename,anchor).ok,true);

    Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'SECOND',entityType:'fixture',entityId:'two',details:{value:2}});
    Db.appendSecurityEvent(db,{kind:'second-warning',severity:'info',fingerprintHash:'b'.repeat(64),details:{}});
    Db.appendPlatformOperatorAudit(db,{operatorId:operator.id,action:'SECOND_VIEW',details:{}});
    assert.equal(Anchor.verifyAuditAnchor(filename,anchor).ok,true,'later append-only rows must not invalidate prior anchor');
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('audit anchor detects modified, deleted or backdated anchored history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-audit-anchor-tamper-'));
  const filename=path.join(dir,'platform.sqlite');
  const {db}=seed(filename);
  try{
    const anchor=Anchor.createAuditAnchorFromDatabase(filename);
    db.exec('DROP TRIGGER history_audit_events_update');
    db.exec("UPDATE audit_events SET action='TAMPERED'");
    let result=Anchor.verifyAuditAnchor(filename,anchor);
    assert.equal(result.ok,false);
    assert.ok(result.fail.some(item=>item.includes('auditEvents')));

    db.close();
    const fresh=seed(path.join(dir,'second.sqlite'));
    try{
      const secondAnchor=Anchor.createAuditAnchorFromDatabase(path.join(dir,'second.sqlite'));
      fresh.db.prepare("INSERT INTO security_events(id,kind,severity,fingerprint_hash,details_json,created_at) VALUES(?,?,?,?,?,?)")
        .run('security_backdated','backdated','info','c'.repeat(64),'{}','2000-01-01T00:00:00.000Z');
      result=Anchor.verifyAuditAnchor(path.join(dir,'second.sqlite'),secondAnchor);
      assert.equal(result.ok,false);
      assert.ok(result.fail.some(item=>item.includes('securityEvents')));
    }finally{fresh.db.close()}
  }finally{
    try{db.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('audit anchor file is deterministic for the same snapshot and written 0600',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-audit-anchor-file-'));
  const filename=path.join(dir,'platform.sqlite'),out=path.join(dir,'ops','anchor.json');
  const {db}=seed(filename);
  try{
    const now=Date.parse('2026-09-21T18:00:00Z');
    const first=Anchor.createAuditAnchorFromDatabase(filename,{now});
    const second=Anchor.createAuditAnchorFromDatabase(filename,{now});
    assert.deepEqual(second,first);
    const written=Anchor.writeAnchor(out,first);
    assert.equal(fs.statSync(out).mode&0o077,0);
    assert.equal(Anchor.readAnchor(out).rootSha256,first.rootSha256);
    assert.match(written.sha256,/^[a-f0-9]{64}$/);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('R2 audit config requires separate bucket and access key scope',()=>{
  assert.equal(R2Anchor.configFromEnvironment(r2Env()).bucket,'lt-studio-audit-anchor');
  assert.throws(
    ()=>R2Anchor.configFromEnvironment(r2Env({R2_AUDIT_BUCKET:'lt-studio-backup-staging'})),
    error=>error.code==='R2_AUDIT_BUCKET_NOT_INDEPENDENT'
  );
  assert.throws(
    ()=>R2Anchor.configFromEnvironment(r2Env({R2_AUDIT_ACCESS_KEY_ID:'backup-access-key'})),
    error=>error.code==='R2_AUDIT_ACCESS_KEY_NOT_INDEPENDENT'
  );
});

test('R2 audit target uploads content-addressed anchor and verifies remote readback',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-audit-anchor-r2-'));
  const filename=path.join(dir,'platform.sqlite');
  const {db}=seed(filename);
  try{
    const anchor=Anchor.createAuditAnchorFromDatabase(filename,{now:Date.parse('2026-09-21T18:00:00Z')});
    const remote=fakeR2();
    const target=await R2Anchor.createR2AuditTarget({env:r2Env(),fetchImpl:remote.fetchImpl});
    const result=await target.putAndVerify(anchor);
    assert.equal(result.verified,true);
    assert.equal(result.key,R2Anchor.storageKey(anchor.rootSha256));
    assert.equal(result.bucket,'lt-studio-audit-anchor');
    assert.ok(remote.objects.has(result.key));

    const second=await target.putAndVerify(anchor);
    assert.equal(second.alreadyExisted,true);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('R2 audit target fails closed when remote readback is corrupted',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-audit-anchor-r2-corrupt-'));
  const filename=path.join(dir,'platform.sqlite');
  const {db}=seed(filename);
  try{
    const anchor=Anchor.createAuditAnchorFromDatabase(filename);
    const remote=fakeR2();
    const target=await R2Anchor.createR2AuditTarget({env:r2Env(),fetchImpl:remote.fetchImpl});
    const first=await target.putAndVerify(anchor);
    remote.objects.set(first.key,Buffer.from('{"corrupted":true}\n'));
    await assert.rejects(()=>target.putAndVerify(anchor),error=>error.code==='R2_AUDIT_REMOTE_INTEGRITY_MISMATCH');
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});


test('audit anchor evidence validator binds local anchor, database and configured bucket',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-audit-anchor-evidence-'));
  const filename=path.join(dir,'platform.sqlite');
  const anchorPath=path.join(dir,'ops','anchor.json');
  const evidencePath=path.join(dir,'ops','anchor-evidence.json');
  const {db}=seed(filename);
  try{
    const now=Date.parse('2026-09-21T18:30:00Z');
    const anchor=Anchor.createAuditAnchorFromDatabase(filename,{now:now-10*60*1000});
    const written=Anchor.writeAnchor(anchorPath,anchor);
    fs.writeFileSync(evidencePath,JSON.stringify({
      schemaVersion:1,
      verifiedAt:new Date(now-5*60*1000).toISOString(),
      provider:'r2',
      jurisdiction:'eu',
      bucket:'lt-studio-audit-anchor',
      storageKey:R2Anchor.storageKey(anchor.rootSha256),
      rootSha256:anchor.rootSha256,
      anchorSha256:written.sha256,
      anchorSizeBytes:written.sizeBytes,
      remoteReadbackVerified:true
    }));
    let result=R2Anchor.auditAnchorEvidence(evidencePath,{
      now,
      expectedBucket:'lt-studio-audit-anchor',
      anchorPath,
      databasePath:filename
    });
    assert.equal(result.ok,true);
    assert.equal(result.rootSha256,anchor.rootSha256);

    result=R2Anchor.auditAnchorEvidence(evidencePath,{
      now,
      expectedBucket:'wrong-audit-bucket',
      anchorPath,
      databasePath:filename
    });
    assert.equal(result.ok,false);

    const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
    evidence.verifiedAt=new Date(Date.parse(anchor.anchoredAt)-1000).toISOString();
    fs.writeFileSync(evidencePath,JSON.stringify(evidence));
    result=R2Anchor.auditAnchorEvidence(evidencePath,{
      now,
      expectedBucket:'lt-studio-audit-anchor',
      anchorPath,
      databasePath:filename
    });
    assert.equal(result.ok,false);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
