'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  MAX_LOGGING_EVIDENCE_AGE_MS,
  createLoggingEvidence,
  validateLoggingEvidence
}=require('../scripts/staging-logging-evidence.js');

const NOW=Date.parse('2026-09-21T19:00:00.000Z');
const REQUEST_ID='123e4567-e89b-42d3-a456-426614174000';

function write(filename,value){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  fs.writeFileSync(filename,JSON.stringify(value));
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-staging-logging-'));
  const operationsPath=path.join(dir,'operations.json');
  const evidencePath=path.join(dir,'logging-evidence.json');
  write(operationsPath,{
    schemaVersion:1,
    technicalOwner:'Tekniskt ansvar',
    accountingOwner:'Redovisningsansvar',
    dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',
    monitoringOwner:'Övervakningsansvar',
    incidentContact:'incident@staging.test',
    supportChannel:'support@staging.test',
    pilotStopAuthority:'Pilotansvarig',
    rollbackDecisionProcess:'Dokumenterat beslut krävs före rollback.',
    offsiteBackupDestination:'Separat privat backup',
    logRetentionDays:30,
    backupRetentionDays:90,
    approvedForPilot:false,
    approvedAt:null
  });
  const env={
    ROLLANDS_ENV:'staging',
    ROLLANDS_STRUCTURED_LOGS:'1',
    ROLLANDS_PILOT_OPERATIONS_PATH:operationsPath,
    ROLLANDS_LOGGING_EVIDENCE_PATH:evidencePath,
    ROLLANDS_LOGGING_PROVIDER:'Central Logg AB',
    ROLLANDS_LOGGING_DESTINATION:'lt-studio-staging',
    ROLLANDS_LOGGING_TEST_REQUEST_ID:REQUEST_ID,
    ROLLANDS_LOGGING_TESTED_AT:new Date(NOW-10*60*1000).toISOString(),
    ROLLANDS_LOGGING_LOOKUP_REFERENCE:'lookup-staging-001',
    ROLLANDS_LOGGING_ALERTING_REFERENCE:'alerts-staging-001',
    ROLLANDS_LOGGING_OBSERVER:'LT Studio driftansvarig',
    ROLLANDS_LOGGING_RETENTION_DAYS:'30',
    ROLLANDS_LOGGING_REQUEST_ID_FOUND:'1',
    ROLLANDS_LOGGING_TRANSPORT_ENCRYPTED:'1',
    ROLLANDS_LOGGING_ACCESS_RESTRICTED:'1',
    ROLLANDS_LOGGING_ALERT_SECURITY_EVENT:'1',
    ROLLANDS_LOGGING_ALERT_5XX:'1',
    ROLLANDS_LOGGING_ALERT_STREAM_MISSING:'1'
  };
  return{dir,env,evidencePath};
}

test('staging log evidence records a recent confirmed central request-id lookup',()=>{
  const f=fixture();
  try{
    const created=createLoggingEvidence({env:f.env,now:NOW});
    assert.equal(created.verified,true);
    assert.equal(created.evidence.testRequestId,REQUEST_ID);
    assert.equal(created.evidence.requestIdLookupSucceeded,true);
    assert.equal(created.evidence.transportEncrypted,true);
    assert.equal(created.evidence.accessRestricted,true);
    assert.deepEqual(created.evidence.alerts,{securityEvent:true,http5xx:true,streamMissing:true});
    assert.equal(created.evidence.retentionDays,30);
    assert.equal(fs.statSync(f.evidencePath).mode&0o777,0o600);
    const verified=validateLoggingEvidence(f.evidencePath,{now:NOW,expectedRetentionDays:30});
    assert.equal(verified.ok,true);
    assert.equal(verified.ageMs,10*60*1000);
    assert.equal(verified.testRequestId,REQUEST_ID);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging log evidence rejects retention that differs from private operations decision',()=>{
  const f=fixture();
  try{
    f.env.ROLLANDS_LOGGING_RETENTION_DAYS='14';
    assert.throws(
      ()=>createLoggingEvidence({env:f.env,now:NOW}),
      error=>error?.code==='STAGING_LOGGING_RETENTION_MISMATCH'
    );
    assert.equal(fs.existsSync(f.evidencePath),false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging log evidence requires an actual request-id lookup confirmation and all alert classes',()=>{
  const f=fixture();
  try{
    f.env.ROLLANDS_LOGGING_REQUEST_ID_FOUND='0';
    assert.throws(
      ()=>createLoggingEvidence({env:f.env,now:NOW}),
      error=>error?.code==='STAGING_LOGGING_CONFIRMATION_REQUIRED'
    );
    f.env.ROLLANDS_LOGGING_REQUEST_ID_FOUND='1';
    f.env.ROLLANDS_LOGGING_ALERT_STREAM_MISSING='0';
    assert.throws(
      ()=>createLoggingEvidence({env:f.env,now:NOW}),
      error=>error?.code==='STAGING_LOGGING_CONFIRMATION_REQUIRED'
    );
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('staging log evidence rejects invalid request ids, placeholders and stale confirmation',()=>{
  const f=fixture();
  try{
    f.env.ROLLANDS_LOGGING_TEST_REQUEST_ID='not-a-request-id';
    assert.throws(
      ()=>createLoggingEvidence({env:f.env,now:NOW}),
      error=>error?.code==='STAGING_LOGGING_REQUEST_ID_INVALID'
    );
    f.env.ROLLANDS_LOGGING_TEST_REQUEST_ID=REQUEST_ID;
    f.env.ROLLANDS_LOGGING_PROVIDER='REPLACE_WITH_PROVIDER';
    assert.throws(
      ()=>createLoggingEvidence({env:f.env,now:NOW}),
      error=>error?.code==='STAGING_LOGGING_VALUE_REQUIRED'
    );
    f.env.ROLLANDS_LOGGING_PROVIDER='Central Logg AB';
    f.env.ROLLANDS_LOGGING_TESTED_AT=new Date(NOW-MAX_LOGGING_EVIDENCE_AGE_MS-1).toISOString();
    assert.throws(
      ()=>createLoggingEvidence({env:f.env,now:NOW}),
      error=>error?.code==='STAGING_LOGGING_TEST_TOO_OLD'
    );
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('logging evidence validator fails closed for stale evidence and retention mismatch',()=>{
  const f=fixture();
  try{
    createLoggingEvidence({env:f.env,now:NOW});
    assert.equal(validateLoggingEvidence(f.evidencePath,{now:NOW+MAX_LOGGING_EVIDENCE_AGE_MS+1,expectedRetentionDays:30}).ok,false);
    assert.equal(validateLoggingEvidence(f.evidencePath,{now:NOW,expectedRetentionDays:14}).ok,false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
