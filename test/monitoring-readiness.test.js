'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Db=require('../apps/api/database.js');
const {monitoringEvidence,readinessReport}=require('../apps/api/readiness.js');

function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));}

test('monitoreringsbevis kräver extern https-readiness och lyckad larmleverans',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-monitor-evidence-'));
  const file=path.join(dir,'monitor.json');
  const now=Date.UTC(2026,8,20,19,0,0);
  const base={
    schemaVersion:1,
    provider:'Extern monitor',
    endpoint:'https://pilot.example.se/api/v1/readiness/core',
    alertRoute:'driftjour',
    checkedAt:new Date(now-60*60*1000).toISOString(),
    alertTestedAt:new Date(now-2*60*60*1000).toISOString(),
    readinessProbeSucceeded:true,
    alertDeliverySucceeded:true,
    alertTestReference:'alert-test-monitoring-001',
    alertObserver:'LT Studio driftansvarig'
  };
  try{
    write(file,base);
    let result=monitoringEvidence(file,{now,maxAgeMs:7*24*60*60*1000});
    assert.equal(result.ok,true);

    write(file,{...base,endpoint:'http://127.0.0.1:4180/api/v1/readiness/core'});
    assert.equal(monitoringEvidence(file,{now}).ok,false);

    write(file,{...base,endpoint:'https://pilot.example.se/api/v1/readiness'});
    assert.equal(monitoringEvidence(file,{now}).ok,false,'full readiness may not be used as monitoring bootstrap evidence');

    write(file,{...base,alertDeliverySucceeded:false});
    assert.equal(monitoringEvidence(file,{now}).ok,false);

    write(file,{...base,alertTestReference:''});
    assert.equal(monitoringEvidence(file,{now}).ok,false);

    write(file,{...base,alertObserver:'REPLACE_WITH_OBSERVER'});
    assert.equal(monitoringEvidence(file,{now}).ok,false);

    write(file,{...base,alertTestedAt:new Date(now-8*24*60*60*1000).toISOString()});
    assert.equal(monitoringEvidence(file,{now,maxAgeMs:7*24*60*60*1000}).ok,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('readiness blir röd utan färskt externt monitoreringsbevis',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-monitor-report-'));
  const file=path.join(dir,'monitor.json');
  const db=Db.openDatabase(':memory:');
  const now=Date.UTC(2026,8,20,19,0,0);
  try{
    let report=readinessReport({db,databasePath:':memory:',requireMonitoringEvidence:true,monitoringEvidencePath:file,now});
    assert.equal(report.ok,false);
    assert.equal(report.checks.monitoring,false);

    write(file,{
      schemaVersion:1,
      provider:'Extern monitor',
      endpoint:'https://pilot.example.se/api/v1/readiness/core',
      alertRoute:'driftjour',
      checkedAt:new Date(now-30*60*1000).toISOString(),
      alertTestedAt:new Date(now-60*60*1000).toISOString(),
      readinessProbeSucceeded:true,
      alertDeliverySucceeded:true,
      alertTestReference:'alert-test-readiness-001',
      alertObserver:'LT Studio driftansvarig'
    });
    report=readinessReport({db,databasePath:':memory:',requireMonitoringEvidence:true,monitoringEvidencePath:file,now});
    assert.equal(report.ok,true);
    assert.equal(report.checks.monitoring,true);
    assert.equal(report.monitoringAgeMs,30*60*1000);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
