'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Monitoring=require('../scripts/staging-monitoring-evidence.js');
const {monitoringEvidence}=require('../apps/api/readiness.js');

function envFor(dir,overrides={}){
  return{
    ROLLANDS_ENV:'staging',
    ROLLANDS_MONITORING_EVIDENCE_PATH:path.join(dir,'ops','monitoring.json'),
    ROLLANDS_MONITORING_ENDPOINT:'https://staging.example.se/api/v1/readiness/core',
    ROLLANDS_MONITORING_PROVIDER:'Extern monitor',
    ROLLANDS_MONITORING_ALERT_ROUTE:'LT Studio driftjour',
    ROLLANDS_MONITORING_ALERT_DELIVERED:'1',
    ROLLANDS_MONITORING_ALERT_TESTED_AT:'2026-09-21T16:30:00.000Z',
    ROLLANDS_MONITORING_ALERT_TEST_REFERENCE:'alert-test-20260921-001',
    ROLLANDS_MONITORING_ALERT_OBSERVER:'LT Studio driftansvarig',
    ...overrides
  };
}

test('monitoreringsendpoint måste vara extern HTTPS core-readiness',()=>{
  assert.equal(
    Monitoring.normalizeEndpoint('https://staging.example.se/api/v1/readiness/core'),
    'https://staging.example.se/api/v1/readiness/core'
  );
  assert.throws(()=>Monitoring.normalizeEndpoint('http://staging.example.se/api/v1/readiness/core'),error=>error.code==='STAGING_MONITORING_HTTPS_REQUIRED');
  assert.throws(()=>Monitoring.normalizeEndpoint('https://127.0.0.1/api/v1/readiness/core'),error=>error.code==='STAGING_MONITORING_EXTERNAL_REQUIRED');
  assert.throws(()=>Monitoring.normalizeEndpoint('https://staging.example.se/api/v1/readiness'),error=>error.code==='STAGING_MONITORING_ENDPOINT_INVALID');
  assert.throws(()=>Monitoring.normalizeEndpoint('https://staging.example.se/api/v1/readiness/core?x=1'),error=>error.code==='STAGING_MONITORING_ENDPOINT_INVALID');
});

test('larmbekräftelse kräver verklig leveransreferens och färsk testtid',()=>{
  const now=Date.parse('2026-09-21T17:00:00.000Z');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-monitor-confirm-'));
  try{
    const valid=Monitoring.alertConfirmationFromEnvironment(envFor(dir),{now});
    assert.equal(valid.alertTestReference,'alert-test-20260921-001');
    assert.throws(
      ()=>Monitoring.alertConfirmationFromEnvironment(envFor(dir,{ROLLANDS_MONITORING_ALERT_DELIVERED:'0'}),{now}),
      error=>error.code==='STAGING_MONITORING_ALERT_NOT_CONFIRMED'
    );
    assert.throws(
      ()=>Monitoring.alertConfirmationFromEnvironment(envFor(dir,{ROLLANDS_MONITORING_ALERT_TEST_REFERENCE:'REPLACE_WITH_ALERT_ID'}),{now}),
      error=>error.code==='STAGING_MONITORING_VALUE_REQUIRED'
    );
    assert.throws(
      ()=>Monitoring.alertConfirmationFromEnvironment(envFor(dir,{ROLLANDS_MONITORING_ALERT_TESTED_AT:'2026-09-19T15:00:00.000Z'}),{now}),
      error=>error.code==='STAGING_MONITORING_ALERT_TOO_OLD'
    );
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('core readiness-probe kräver 200, ok och rätt service',async()=>{
  const endpoint='https://staging.example.se/api/v1/readiness/core';
  const good=await Monitoring.probeCoreReadiness(endpoint,{fetchImpl:async()=>new Response(JSON.stringify({ok:true,service:'rollands-api-v1',checks:{databaseRead:true}}),{status:200,headers:{'content-type':'application/json'}})});
  assert.equal(good.ok,true);
  await assert.rejects(
    ()=>Monitoring.probeCoreReadiness(endpoint,{fetchImpl:async()=>new Response(JSON.stringify({ok:false}),{status:503,headers:{'content-type':'application/json'}})}),
    error=>error.code==='STAGING_MONITORING_PROBE_NOT_READY'
  );
  await assert.rejects(
    ()=>Monitoring.probeCoreReadiness(endpoint,{fetchImpl:async()=>new Response(JSON.stringify({ok:true,service:'wrong',checks:{}}),{status:200,headers:{'content-type':'application/json'}})}),
    error=>error.code==='STAGING_MONITORING_PROBE_INVALID'
  );
});

test('stagingkommandot skriver privat verifierbart monitoreringsbevis först efter probe och larmbekräftelse',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-monitor-write-'));
  const now=Date.parse('2026-09-21T17:00:00.000Z');
  try{
    const env=envFor(dir);
    const result=await Monitoring.createMonitoringEvidence({
      env,
      now,
      fetchImpl:async()=>new Response(JSON.stringify({
        ok:true,
        service:'rollands-api-v1',
        checks:{databaseRead:true,databaseWrite:true,monitoring:true}
      }),{status:200,headers:{'content-type':'application/json'}})
    });
    assert.equal(result.verified,true);
    assert.equal(fs.existsSync(result.evidencePath),true);
    assert.equal(fs.statSync(result.evidencePath).mode&0o077,0);
    const value=JSON.parse(fs.readFileSync(result.evidencePath,'utf8'));
    assert.equal(value.alertDeliverySucceeded,true);
    assert.equal(value.alertTestReference,'alert-test-20260921-001');
    assert.equal(value.alertObserver,'LT Studio driftansvarig');
    assert.equal(monitoringEvidence(result.evidencePath,{now}).ok,true);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
