'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  REQUIRED_SCENARIOS,
  REQUIRED_CHECKS,
  validateSupabaseUatEvidence,
  validateSupabaseUatEvidenceFile
}=require('../scripts/supabase-uat-release-evidence.js');

const COMMIT='a'.repeat(40);
const NOW=Date.parse('2026-10-07T14:30:00.000Z');

function evidenceFixture(overrides={}){
  const checks=Object.fromEntries(REQUIRED_CHECKS.map(id=>[
    id,
    {passed:true,reference:'CI-'+id+'-001'}
  ]));
  const scenarios=Object.fromEntries(REQUIRED_SCENARIOS.map(id=>[
    id,
    {passed:true,reference:'UAT-'+id+'-001'}
  ]));

  return{
    schemaVersion:1,
    environment:'supabase-uat',
    approved:true,
    syntheticDataOnly:true,
    sourceOfTruthVerified:true,
    releaseCommit:COMMIT,
    completedAt:'2026-10-07T14:00:00.000Z',
    tester:'UAT-ansvarig',
    accountingReviewer:'Redovisningsansvarig',
    technicalReviewer:'Tekniskt ansvarig',
    twoUsersVerified:true,
    secondTenantVerified:true,
    blockingIssues:[],
    checks,
    scenarios,
    ...overrides
  };
}

test('Supabase-UAT release-evidence accepterar komplett evidens för exakt release-commit',()=>{
  const result=validateSupabaseUatEvidence(evidenceFixture(),{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,true);
  assert.deepEqual(result.fail,[]);
});

test('Supabase-UAT release-evidence stoppar fel commit och blockerande issues',()=>{
  let result=validateSupabaseUatEvidence(
    evidenceFixture({releaseCommit:'b'.repeat(40)}),
    {now:NOW,expectedCommit:COMMIT}
  );
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('release-commit')));

  result=validateSupabaseUatEvidence(
    evidenceFixture({blockingIssues:['#999']}),
    {now:NOW,expectedCommit:COMMIT}
  );
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('blockingIssues')));
});

test('Supabase-UAT release-evidence kräver två användare, andra tenant och source-of-truth-verifiering',()=>{
  const result=validateSupabaseUatEvidence(evidenceFixture({
    twoUsersVerified:false,
    secondTenantVerified:false,
    sourceOfTruthVerified:false
  }),{now:NOW,expectedCommit:COMMIT});

  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('twoUsersVerified')));
  assert.ok(result.fail.some(item=>item.includes('secondTenantVerified')));
  assert.ok(result.fail.some(item=>item.includes('sourceOfTruthVerified')));
});

test('Supabase-UAT release-evidence kräver alla CI-kontroller och UAT-scenarier',()=>{
  const fixture=evidenceFixture();
  delete fixture.checks.codeql;
  delete fixture.scenarios['manual-customer-payment'];

  const result=validateSupabaseUatEvidence(fixture,{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('codeql')));
  assert.ok(result.fail.some(item=>item.includes('manual-customer-payment')));
});

test('Supabase-UAT release-evidence kräver färska och spårbara referenser',()=>{
  const fixture=evidenceFixture({
    completedAt:'2026-09-20T12:00:00.000Z'
  });
  fixture.scenarios['customer-invoice'].reference='REPLACE_WITH_REFERENCE';

  const result=validateSupabaseUatEvidence(fixture,{now:NOW,expectedCommit:COMMIT});
  assert.equal(result.ok,false);
  assert.ok(result.fail.some(item=>item.includes('äldre än 7 dagar')));
  assert.ok(result.fail.some(item=>item.includes('customer-invoice')));
});

test('Supabase-UAT release-evidence kan verifieras från privat JSON-fil',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lt-supabase-uat-evidence-'));
  try{
    const filename=path.join(dir,'evidence.json');
    fs.writeFileSync(filename,JSON.stringify(evidenceFixture()));
    const result=validateSupabaseUatEvidenceFile(filename,{now:NOW,expectedCommit:COMMIT});
    assert.equal(result.ok,true);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
