'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payroll=require('../apps/api/payroll.js');

test('identisk löneimport återanvänder samma körning utan ny audit och ändrad payload stoppas',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const payload={
      period:'2026-10',
      payDate:'2026-10-25',
      sourceName:'Idempotent löneimport',
      grossSalaryOre:100000,
      withheldTaxOre:30000,
      employerContributionsOre:31420,
      netPayOre:70000,
      vacationLiabilityChangeOre:0,
      lines:[
        {account:'7010',text:'Bruttolön',debitOre:100000,creditOre:0},
        {account:'2710',text:'Skatt',debitOre:0,creditOre:30000},
        {account:'1930',text:'Nettolön',debitOre:0,creditOre:70000}
      ]
    };

    const first=await fetch(f.base+'/api/v1/payroll/runs',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const firstBody=await first.json();
    assert.equal(first.status,201);
    assert.equal(firstBody.duplicate,false);

    const retry=await fetch(f.base+'/api/v1/payroll/runs',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const retryBody=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.run.id,firstBody.run.id);

    const runs=Payroll.listRuns(f.db,f.a.id,{period:'2026-10'}).filter(run=>run.sourceName===payload.sourceName);
    assert.equal(runs.length,1);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='PAYROLL_JOURNAL_IMPORTED'&&event.entityId===firstBody.run.id).length,
      1
    );

    const changedDate=await fetch(f.base+'/api/v1/payroll/runs',{
      method:'POST',headers,body:JSON.stringify({...payload,payDate:'2026-10-26'})
    });
    assert.equal(changedDate.status,409);
    assert.equal((await changedDate.json()).code,'PAYROLL_IMPORT_IDEMPOTENCY_CONFLICT');

    const changedSummary=await fetch(f.base+'/api/v1/payroll/runs',{
      method:'POST',headers,body:JSON.stringify({...payload,grossSalaryOre:100001})
    });
    assert.equal(changedSummary.status,409);
    assert.equal((await changedSummary.json()).code,'PAYROLL_IMPORT_IDEMPOTENCY_CONFLICT');

    assert.equal(Payroll.listRuns(f.db,f.a.id,{period:'2026-10'}).filter(run=>run.sourceName===payload.sourceName).length,1);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='PAYROLL_JOURNAL_IMPORTED'&&event.entityId===firstBody.run.id).length,
      1
    );
  }finally{
    await f.close();
  }
});
