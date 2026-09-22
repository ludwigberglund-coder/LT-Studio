'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');

async function run(fn){const f=await fixture();try{await fn(f)}finally{await f.close()}}

test('attestant kan läsa ekonomi utom lön men kan inte göra vanliga ändringar',()=>run(async f=>{
  Db.setMembershipRole(f.db,{companyId:f.a.id,userId:f.auditor.id,role:'approver'});
  const headers=await f.login(f.auditor.username);

  assert.equal((await fetch(f.base+'/api/v1/reports/trial-balance?from=2026-09-01&to=2026-09-30',{headers})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/payables/invoices',{headers})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/payroll/runs',{headers})).status,403);

  const mutation=await fetch(f.base+'/api/v1/customers',{
    method:'POST',headers,body:JSON.stringify({requestId:'approver-customer-block-001',name:'Får inte skapas'})
  });
  assert.equal(mutation.status,403);
  assert.equal((await mutation.json()).code,'ACCESS_DENIED');
}));

test('läsbehörighet får läsa men inte ändra och ser inte lön',()=>run(async f=>{
  Db.setMembershipRole(f.db,{companyId:f.a.id,userId:f.auditor.id,role:'readonly'});
  const headers=await f.login(f.auditor.username);

  assert.equal((await fetch(f.base+'/api/v1/customers',{headers})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/accounting/entries',{headers})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/payroll/runs',{headers})).status,403);

  const mutation=await fetch(f.base+'/api/v1/customers',{
    method:'POST',headers,body:JSON.stringify({requestId:'readonly-customer-block-001',name:'Får inte skapas'})
  });
  assert.equal(mutation.status,403);
}));

test('ekonom får ekonomifunktioner inklusive lön men inte användaradministration',()=>run(async f=>{
  Db.setMembershipRole(f.db,{companyId:f.a.id,userId:f.auditor.id,role:'accountant'});
  const headers=await f.login(f.auditor.username);

  assert.equal((await fetch(f.base+'/api/v1/payroll/runs',{headers})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/accounting/entries',{headers})).status,200);
  assert.equal((await fetch(f.base+'/api/v1/access/members',{headers})).status,403);
}));

test('admin kan byta annan användares roll och gamla sessionen återkallas direkt',()=>run(async f=>{
  const auditorHeaders=await f.login(f.auditor.username);
  assert.equal((await fetch(f.base+'/api/v1/session',{headers:auditorHeaders})).status,200);

  const adminHeaders=await f.login(f.admin.username);
  const before=await fetch(f.base+'/api/v1/access/members',{headers:adminHeaders});
  assert.equal(before.status,200);
  const beforeBody=await before.json();
  assert.ok(beforeBody.members.some(member=>member.userId===f.auditor.id&&member.role==='admin'));

  const changed=await fetch(f.base+'/api/v1/access/members/'+encodeURIComponent(f.auditor.id)+'/role',{
    method:'PUT',headers:adminHeaders,body:JSON.stringify({role:'readonly'})
  });
  assert.equal(changed.status,200);
  assert.equal((await changed.json()).membership.role,'readonly');

  const oldSession=await fetch(f.base+'/api/v1/session',{headers:auditorHeaders});
  assert.equal(oldSession.status,200);
  assert.equal((await oldSession.json()).authenticated,false);
  assert.equal(Db.membership(f.db,f.a.id,f.auditor.id).role,'readonly');
  assert.ok(Db.auditForCompany(f.db,f.a.id).some(event=>event.action==='MEMBERSHIP_ROLE_CHANGED'&&event.entityId===f.auditor.id));
}));

test('admin kan inte sänka sin egen roll via samma session',()=>run(async f=>{
  const headers=await f.login(f.admin.username);
  const response=await fetch(f.base+'/api/v1/access/members/'+encodeURIComponent(f.admin.id)+'/role',{
    method:'PUT',headers,body:JSON.stringify({role:'readonly'})
  });
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'SELF_ROLE_CHANGE_BLOCKED');
  assert.equal(Db.membership(f.db,f.a.id,f.admin.id).role,'admin');
}));
