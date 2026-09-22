'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const SecurityMonitor=require('../apps/api/security-monitor.js');

test('aktiv säkerhetsmonitor flaggar readiness, MFA, inloggningsattack och nya säkerhetshändelser',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Säker Test AB',displayName:'Säker Test',orgNumber:'559900-8111'});
    const user=Db.createUser(db,{username:'security-monitor-user',displayName:'Säkerhetsanvändare',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:company.id,userId:user.id,role:'admin'});
    Db.createPlatformOperator(db,{
      username:'security-monitor-operator',
      displayName:'Security Monitor Operator',
      passwordHash:'test-only',
      mfaSecretEncrypted:'encrypted-test-mfa'
    });

    const loginNowMs=Date.now();
    const loginKey=crypto.createHash('sha256').update('security-monitor-test-login').digest('hex');
    for(let i=0;i<5;i++)Db.noteLoginFailure(db,{keyHash:loginKey,windowMinutes:15,nowMs:loginNowMs});
    Db.appendSecurityEvent(db,{
      kind:'OPERATOR_LOGIN_FAILURE_THRESHOLD',
      severity:'critical',
      fingerprintHash:'a'.repeat(64),
      details:{privateTechnicalDetail:'must-never-leak'}
    });

    const result=SecurityMonitor.scanSecurityState(db,{
      nowMs:Date.now()+1000,
      scanIntervalMs:30_000,
      readinessProvider:()=>({ok:false,checks:{databaseRead:true,databaseWrite:true,backup:false,monitoring:false,platformAdmin:true}})
    });

    assert.equal(result.active,true);
    assert.equal(result.status,'critical');
    assert.equal(result.scanIntervalSeconds,30);
    assert.ok(result.counts.critical>=3);
    assert.ok(result.counts.warning>=1);
    assert.equal(result.signals.activeUsers,1);
    assert.equal(result.signals.usersWithoutMfa,1);
    assert.equal(result.signals.activeLoginWindows,1);
    assert.equal(result.signals.recentCriticalEvents,1);

    const codes=new Set(result.findings.map(item=>item.code));
    assert.ok(codes.has('READINESS_BACKUP'));
    assert.ok(codes.has('READINESS_MONITORING'));
    assert.ok(codes.has('CUSTOMER_MFA_GAP'));
    assert.ok(codes.has('ACTIVE_LOGIN_ATTACK'));
    assert.ok(codes.has('RECENT_CRITICAL_SECURITY_EVENTS'));

    const serialized=JSON.stringify(result);
    assert.doesNotMatch(serialized,/must-never-leak|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  }finally{db.close()}
});

test('säkerhetsmonitor är grön när kontrollerna är godkända och inga risksignaler finns',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Grön Test AB',displayName:'Grön Test',orgNumber:'559900-8112'});
    const user=Db.createUser(db,{username:'security-monitor-green',displayName:'Grön Användare',passwordHash:'test-only',mfaSecretEncrypted:'encrypted-test-mfa'});
    Db.addMembership(db,{companyId:company.id,userId:user.id,role:'readonly'});
    const result=SecurityMonitor.scanSecurityState(db,{
      readinessProvider:()=>({ok:true,checks:{databaseRead:true,databaseWrite:true,diskSpace:true,backup:true,monitoring:true,platformAdmin:true}})
    });
    assert.equal(result.status,'healthy');
    assert.equal(result.counts.total,0);
    assert.deepEqual(result.findings,[]);
  }finally{db.close()}
});

test('bakgrundsmonitorn failar stängt och validerar skanningsintervallet',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    assert.throws(
      ()=>SecurityMonitor.createSecurityMonitor({db,scanIntervalMs:999,autoStart:false}),
      error=>error.code==='SECURITY_MONITOR_INVALID_INTERVAL'
    );
    const monitor=SecurityMonitor.createSecurityMonitor({
      db,
      scanIntervalMs:5000,
      autoStart:false,
      readinessProvider:()=>{throw new Error('technical secret')}
    });
    const snapshot=monitor.refresh();
    assert.equal(snapshot.status,'critical');
    assert.equal(snapshot.findings[0].code,'READINESS_PROVIDER_FAILED');
    assert.doesNotMatch(JSON.stringify(snapshot),/technical secret/);
    assert.equal(monitor.scanCount,1);
    monitor.stop();
  }finally{db.close()}
});
