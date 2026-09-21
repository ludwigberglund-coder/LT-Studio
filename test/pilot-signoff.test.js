'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {validateUatEvidence}=require('../scripts/pilot-uat-evidence.js');
const {sha256File,validateStagingSignoffFile}=require('../scripts/staging-signoff-format.js');
const {validateOperations}=require('../scripts/pilot-operations.js');

const COMMIT='a'.repeat(40);
const NOW=Date.parse('2026-09-21T17:30:00.000Z');
const REQUIRED_SCENARIOS={
  'supplier-invoice':{passed:true,reference:'UAT-A-001'},
  'customer-invoice':{passed:true,reference:'UAT-B-001'},
  correction:{passed:true,reference:'UAT-C-001'},
  'period-lock':{passed:true,reference:'UAT-D-001'},
  idempotency:{passed:true,reference:'UAT-E-001'},
  'backup-restore':{passed:true,reference:'UAT-F-001'},
  'tenant-isolation':{passed:true,reference:'UAT-G-001'}
};

function uatFixture(overrides={}){
  return{
    schemaVersion:1,
    environment:'staging',
    approved:true,
    testDataOnly:true,
    stagingCommit:COMMIT,
    completedAt:'2026-09-21T17:00:00.000Z',
    tester:'UAT-ansvarig',
    accountingReviewer:'Redovisningsansvarig',
    technicalReviewer:'Tekniskt ansvarig',
    secondTenantVerified:true,
    blockingIssues:[],
    scenarios:JSON.parse(JSON.stringify(REQUIRED_SCENARIOS)),
    ...overrides
  };
}

function signoffFixture(dir){
  const sourcePaths={};
  for(const key of ['uat','r2Audit','offsiteBackup','restoreDrill','r2RestoreDrill','monitoring']){
    const filename=path.join(dir,key+'.json');
    fs.writeFileSync(filename,JSON.stringify({key,fixture:true}));
    sourcePaths[key]=filename;
  }
  const signoff={
    schemaVersion:1,
    environment:'staging',
    createdAt:'2026-09-21T17:15:00.000Z',
    releaseCommit:COMMIT,
    readyForPilotDecision:true,
    uatCompletedAt:'2026-09-21T17:00:00.000Z',
    checks:{
      preflight:true,
      r2Audit:true,
      offsiteBackup:true,
      restoreDrill:true,
      r2RestoreDrill:true,
      monitoring:true,
      sameBackupArtifact:true
    },
    evidence:{backupSha256:'b'.repeat(64)},
    sourceEvidenceSha256:Object.fromEntries(
      Object.entries(sourcePaths).map(([key,filename])=>[key,sha256File(filename)])
    )
  };
  const signoffPath=path.join(dir,'staging-signoff.json');
  fs.writeFileSync(signoffPath,JSON.stringify(signoff));
  return{sourcePaths,signoffPath,signoff};
}

test('UAT-evidens kräver alla scenarier, kund nummer två och samma release-commit',()=>{
  let result=validateUatEvidence(uatFixture(),{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,true);
  assert.deepEqual(result.fail,[]);

  result=validateUatEvidence(uatFixture({secondTenantVerified:false}),{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('secondTenantVerified')));

  const missing=uatFixture();
  delete missing.scenarios['tenant-isolation'];
  result=validateUatEvidence(missing,{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('tenant-isolation')));

  result=validateUatEvidence(uatFixture({stagingCommit:'b'.repeat(40)}),{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('release-commit')));

  result=validateUatEvidence(uatFixture({completedAt:'2026-09-10T12:00:00.000Z'}),{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('äldre än 7 dagar')));
});

test('staging-signoff verifierar alla privata källfiler mot SHA-256',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-signoff-format-'));
  try{
    const f=signoffFixture(dir);
    let result=validateStagingSignoffFile(f.signoffPath,{expectedCommit:COMMIT,sourcePaths:f.sourcePaths,now:NOW});
    assert.equal(result.ok,true);
    assert.match(result.sha256,/^[a-f0-9]{64}$/);

    fs.writeFileSync(f.sourcePaths.monitoring,JSON.stringify({changed:true}));
    result=validateStagingSignoffFile(f.signoffPath,{expectedCommit:COMMIT,sourcePaths:f.sourcePaths,now:NOW});
    assert.equal(result.ok,false);
    assert.ok(result.fail.some(item=>item.includes('monitoring')&&item.includes('ändrats')));

    result=validateStagingSignoffFile(f.signoffPath,{expectedCommit:'c'.repeat(40),now:NOW});
    assert.equal(result.ok,false);
    assert.ok(result.fail.some(item=>item.includes('release-commit')));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('pilotbeslut kräver explicit release-commit och staging-signoff-SHA',()=>{
  const base={
    schemaVersion:1,
    technicalOwner:'Tekniskt ansvar',
    accountingOwner:'Redovisningsansvar',
    dataProtectionOwner:'Dataskyddsansvar',
    backupOwner:'Backupansvar',
    monitoringOwner:'Övervakningsansvar',
    incidentContact:'incident@pilot.test',
    supportChannel:'support@pilot.test',
    pilotStopAuthority:'Pilotansvarig',
    rollbackDecisionProcess:'Dokumenterat beslut krävs före rollback.',
    offsiteBackupDestination:'Separat privat backup',
    logRetentionDays:30,
    backupRetentionDays:90,
    approvedForPilot:true,
    approvedAt:'2026-09-21',
    approvedReleaseCommit:COMMIT,
    stagingSignoffSha256:'d'.repeat(64)
  };
  assert.equal(validateOperations(base,{requireApproval:true}).ok,true);
  assert.equal(validateOperations({...base,approvedReleaseCommit:''},{requireApproval:true}).ok,false);
  assert.equal(validateOperations({...base,stagingSignoffSha256:''},{requireApproval:true}).ok,false);
});
