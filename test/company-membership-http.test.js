'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const lists=['/receivables','/customers','/customer-invoices','/payables/invoices','/suppliers','/bank/payments','/documents','/accounting/entries','/payroll/runs','/inventory/items','/automation/proposals','/website/cms','/reports/trial-balance?from=2026-09-01&to=2026-09-30','/audit'];
async function run(fn){const f=await fixture();try{await fn(f)}finally{await f.close()}}
test('två personliga medlemmar har samma åtkomst i alla 14 API-familjer',()=>run(async f=>{
  for(const username of [f.admin.username,f.auditor.username]){
    const headers=await f.login(username);
    const session=await (await fetch(f.base+'/api/v1/session',{headers})).json();
    assert.equal(session.companyId,f.a.id);assert.equal('roles' in session.user,false);
    for(const route of lists){
      assert.equal((await fetch(f.base+'/api/v1'+route)).status,401,route);
      assert.equal((await fetch(f.base+'/api/v1'+route,{headers})).status,200,route);
    }
  }
}));
test('indraget medlemskap eller avstängt konto stoppar redan utfärdade sessioner i alla API-familjer',()=>run(async f=>{
  const headers=await f.login();
  f.db.prepare('DELETE FROM memberships WHERE company_id=? AND user_id=?').run(f.a.id,f.admin.id);
  for(const route of lists)assert.equal((await fetch(f.base+'/api/v1'+route,{headers})).status,401,route);
  Db.addMembership(f.db,{companyId:f.a.id,userId:f.admin.id});
  f.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(f.admin.id);
  for(const route of lists)assert.equal((await fetch(f.base+'/api/v1'+route,{headers})).status,401,route);
}));
test('företagsgränsen gäller läsning, PDF och mutation trots autentisering och giltig CSRF',()=>run(async f=>{
  const cases=[
    ['GET',`/payables/invoices/${f.otherPayable.id}`],
    ['GET',`/payables/invoices/${f.otherPayable.id}/document`],
    ['PUT',`/payables/invoices/${f.otherPayable.id}/coding`,{lines:[]}],
    ['POST',`/payables/invoices/${f.otherPayable.id}/coding-suggestion`,{}],
    ['POST',`/payables/invoices/${f.otherPayable.id}/approve`,{}],
    ['POST',`/payables/invoices/${f.otherPayable.id}/post`,{}],
    ['POST',`/payables/invoices/${f.otherPayable.id}/prepare-payment`,{}]
  ];
  for(const username of [f.admin.username,f.auditor.username]){
    const headers=await f.login(username);
    for(const [method,route,body] of cases){
      const response=await fetch(f.base+'/api/v1'+route,{method,headers,body:body?JSON.stringify(body):undefined});
      assert.equal(response.status,404,method+' '+route);
    }
  }
  const otherHeaders=await f.login(f.other.username);
  assert.equal((await fetch(f.base+'/api/v1/payables/invoices/'+f.otherPayable.id,{headers:otherHeaders})).status,200);
  const foreignCustomer=await fetch(f.base+'/api/v1/customer-invoices/'+f.issued.invoice.id+'/pdf',{headers:otherHeaders});
  assert.equal(foreignCustomer.status,404);
  assert.equal(Db.auditForCompany(f.db,f.b.id).filter(e=>e.action.startsWith('SUPPLIER_')).length,0);
}));
test('MFA krävs även för nya medlemmar utan tidigare roller',()=>run(async f=>{
  const user=Db.createUser(f.db,{username:'no.mfa',displayName:'No MFA test',passwordHash:Auth.hashPassword(f.PASSWORD)});
  Db.addMembership(f.db,{companyId:f.a.id,userId:user.id});
  const response=await fetch(f.base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:f.PASSWORD})});
  assert.equal(response.status,403);assert.equal((await response.json()).code,'MFA_ENROLLMENT_REQUIRED');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(user.id).n,0);
}));
