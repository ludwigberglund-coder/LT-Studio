'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payroll=require('../apps/api/payroll.js');

async function run(fn){const f=await fixture();try{await fn(f)}finally{await f.close()}}

test('lönekörning från annat företag kan inte bokföras via HTTP',()=>run(async f=>{
  const payroll=Payroll.importRun(f.db,{
    companyId:f.a.id,
    period:'2026-09',
    payDate:'2026-09-25',
    sourceName:'IDOR payroll fixture',
    grossSalaryOre:100000,
    withheldTaxOre:30000,
    employerContributionsOre:31420,
    netPayOre:70000,
    vacationLiabilityChangeOre:0,
    lines:[
      {account:'7010',text:'Lön',debitOre:100000,creditOre:0},
      {account:'2710',text:'Skatt',debitOre:0,creditOre:30000},
      {account:'1930',text:'Nettolön',debitOre:0,creditOre:70000}
    ],
    importedBy:f.admin.id
  });

  const otherHeaders=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/payroll/runs/'+payroll.id+'/post',{
    method:'POST',
    headers:otherHeaders,
    body:JSON.stringify({})
  });

  assert.equal(response.status,404);
  assert.equal(Payroll.runById(f.db,f.a.id,payroll.id).status,'validated');
  assert.equal(Db.auditForCompany(f.db,f.b.id).filter(e=>e.action.startsWith('PAYROLL_')).length,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM accounting_entries WHERE company_id=? AND source_type='payroll-run' AND source_id=?").get(f.a.id,payroll.id).n,0);
}));
