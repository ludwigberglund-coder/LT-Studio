'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payroll=require('../apps/api/payroll.js');
const Accounting=require('../apps/api/accounting-store.js');

test('identisk lönebokföring återanvänder samma verifikation utan ny audit',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const payload={
      period:'2026-11',
      payDate:'2026-11-25',
      sourceName:'Retry-safe bokföring',
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

    const imported=await fetch(f.base+'/api/v1/payroll/runs',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const importedBody=await imported.json();
    assert.equal(imported.status,201);
    const runId=importedBody.run.id;

    const first=await fetch(f.base+`/api/v1/payroll/runs/${runId}/post`,{
      method:'POST',headers,body:JSON.stringify({})
    });
    const firstBody=await first.json();
    assert.equal(first.status,200);
    assert.equal(firstBody.duplicate,false);
    assert.equal(firstBody.run.status,'posted');

    const retry=await fetch(f.base+`/api/v1/payroll/runs/${runId}/post`,{
      method:'POST',headers,body:JSON.stringify({})
    });
    const retryBody=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.entry.id,firstBody.entry.id);
    assert.equal(retryBody.run.postedAt,firstBody.run.postedAt);

    assert.equal(
      Accounting.listEntries(f.db,f.a.id).filter(entry=>entry.sourceType==='payroll-run'&&entry.sourceId===runId).length,
      1
    );
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='PAYROLL_JOURNAL_POSTED'&&event.entityId===runId).length,
      1
    );

    const other=Db.createUser(f.db,{
      username:'other.payroll.poster',
      displayName:'Other Payroll Poster',
      passwordHash:'test-only-hash'
    });
    assert.throws(
      ()=>Payroll.postRunIdempotent(f.db,{companyId:f.a.id,runId,postedBy:other.id}),
      error=>error.code==='PAYROLL_ALREADY_POSTED'
    );

    assert.equal(
      Accounting.listEntries(f.db,f.a.id).filter(entry=>entry.sourceType==='payroll-run'&&entry.sourceId===runId).length,
      1
    );
  }finally{
    await f.close();
  }
});
