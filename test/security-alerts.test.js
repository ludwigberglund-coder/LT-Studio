'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const SecurityAlerts=require('../apps/api/security-alerts.js');

function fixture(fetchImpl){
  let nowMs=Date.parse('2026-09-22T16:45:00.000Z');
  const db=Db.openDatabase(':memory:');
  const env={
    ROLLANDS_SECURITY_ALERT_WEBHOOK_URL:'https://alerts.example.test/security',
    ROLLANDS_SECURITY_ALERT_WEBHOOK_TOKEN:'test-webhook-token',
    ROLLANDS_SECURITY_ALERT_COOLDOWN_SECONDS:'900',
    ROLLANDS_SECURITY_ALERT_RETRY_BASE_SECONDS:'10',
    ROLLANDS_SECURITY_ALERT_TIMEOUT_MS:'2000'
  };
  const service=SecurityAlerts.createSecurityAlertService({db,env,fetchImpl,now:()=>nowMs});
  return{db,service,advance:ms=>{nowMs+=ms}};
}

test('externa säkerhetslarm dataminimeras och dedupliceras mellan skanningar',async()=>{
  const calls=[];
  const f=fixture(async(url,options)=>{calls.push({url,options});return{ok:true,status:204}});
  try{
    const finding={code:'READINESS_BACKUP',severity:'critical',category:'Backup',title:'Backupkontrollen är inte godkänd',message:'must-never-leak-detail'};
    const first=await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(first.succeeded,1);
    assert.equal(calls.length,1);
    const body=JSON.parse(calls[0].options.body);
    assert.deepEqual(Object.keys(body).sort(),['category','code','observedAt','schemaVersion','severity','source','test','title','type'].sort());
    assert.equal(body.test,false);
    assert.doesNotMatch(JSON.stringify(body),/must-never-leak-detail|test-webhook-token|alerts\.example\.test/);

    const second=await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(second.attempted,0);
    assert.equal(calls.length,1);

    await f.service.dispatchSnapshot({findings:[]});
    f.advance(5*60*1000);
    await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(calls.length,1);

    await f.service.dispatchSnapshot({findings:[]});
    f.advance(11*60*1000);
    await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(calls.length,2);

    const stored=JSON.stringify(f.db.prepare('SELECT * FROM security_alert_states').all());
    const audit=JSON.stringify(Db.platformOperatorAudit(f.db));
    assert.doesNotMatch(stored,/test-webhook-token|alerts\.example\.test|must-never-leak-detail/);
    assert.doesNotMatch(audit,/test-webhook-token|alerts\.example\.test|must-never-leak-detail/);
  }finally{f.service.stop();f.db.close()}
});

test('misslyckad webhook får kontrollerad retry och auditspår',async()=>{
  let attempt=0;
  const f=fixture(async()=>{attempt+=1;return attempt===1?{ok:false,status:503}:{ok:true,status:202}});
  try{
    const finding={code:'ACTIVE_LOGIN_ATTACK',severity:'critical',category:'Inloggning',title:'Pågående upprepade inloggningsförsök'};
    const first=await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(first.failed,1);
    assert.equal(attempt,1);

    f.advance(5000);
    const early=await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(early.attempted,0);
    assert.equal(attempt,1);

    f.advance(6000);
    const retry=await f.service.dispatchSnapshot({findings:[finding]});
    assert.equal(retry.succeeded,1);
    assert.equal(attempt,2);

    const audit=Db.platformOperatorAudit(f.db);
    assert.ok(audit.some(row=>row.action==='SECURITY_ALERT_DELIVERY_FAILED'&&row.details.errorCode==='WEBHOOK_HTTP_5XX'));
    assert.ok(audit.some(row=>row.action==='SECURITY_ALERT_DELIVERY_SUCCEEDED'));
  }finally{f.service.stop();f.db.close()}
});

test('testlarm gör larmkanalen verifierad utan att exponera webhook eller token',async()=>{
  const calls=[];
  const f=fixture(async(url,options)=>{calls.push({url,options});return{ok:true,status:200}});
  try{
    assert.equal(f.service.readiness().ok,false);
    const result=await f.service.test();
    assert.equal(result.ok,true);
    const ready=f.service.readiness();
    assert.equal(ready.ok,true);
    assert.equal(ready.configured,true);
    assert.equal(ready.lastTestSucceeded,true);
    const status=JSON.stringify(f.service.status());
    assert.doesNotMatch(status,/alerts\.example\.test|test-webhook-token/);
    const body=JSON.parse(calls[0].options.body);
    assert.equal(body.test,true);
    assert.equal(body.code,'SECURITY_ALERT_TEST');
  }finally{f.service.stop();f.db.close()}
});
