'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');
const Admin=require('../apps/api/accounting-admin.js');
const {createAccountingAdminRouter}=require('../apps/api/accounting-admin-router.js');
function seed(){
  const db=Db.openDatabase(':memory:');Admin.initializeAccountingAdmin(db);
  const company=Db.createCompany(db,{legalName:'Correction test',orgNumber:'TEST-CORRECTION'});
  const user=Db.createUser(db,{username:'correction',displayName:'Correction test',passwordHash:'test-not-a-login'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  return {db,company,user};
}
function post(s,sourceType='manual',lines=null){return Accounting.postEntry(s.db,{companyId:s.company.id,createdBy:s.user.id,postingDate:'2026-09-18',description:'Original with VAT',sourceType,sourceId:sourceType,lines:lines||[{account:'5460',debitOre:10000},{account:'2641',debitOre:2500},{account:'1930',creditOre:12500}]}).entry;}
function correct(s,entry,extra={}){return Admin.correctEntry(s.db,{companyId:s.company.id,entryId:entry.id,postingDate:'2026-09-19',reason:'Correction test reason',createdBy:s.user.id,...extra});}
function count(s,table){return s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;}
test('source-linked and unknown journals require source-aware correction',()=>{
 const s=seed();try{
  for(const type of ['customer-invoice','supplier-invoice','supplier-payment','bank-payment','payroll-run','future-integration']){
   const entry=post(s,type),before=count(s,'accounting_entries');
   assert.equal(Admin.correctionPolicy(s.db,s.company.id,entry.id).allowed,false);
   assert.throws(()=>correct(s,entry),e=>e.code==='SOURCE_CORRECTION_REQUIRED'&&e.statusCode===409);
   assert.equal(count(s,'accounting_entries'),before);
  }
  assert.equal(count(s,'accounting_corrections'),0);assert.equal(count(s,'audit_events'),0);
 }finally{s.db.close();}
});
test('manual sources cannot bypass customer/supplier control account protection',()=>{
 const s=seed();try{
  const entry=post(s,'manual',[{account:'1510',debitOre:12500},{account:'3010',creditOre:12500}]);
  assert.throws(()=>correct(s,entry),e=>e.code==='SOURCE_CORRECTION_REQUIRED');
  const plain=post(s,'manual-journal');
  assert.throws(()=>correct(s,plain,{replacementLines:[{account:'5460',debitOre:12500},{account:'2440',creditOre:12500}]}),e=>e.code==='SOURCE_CORRECTION_REQUIRED');
  assert.equal(count(s,'accounting_entries'),2);
 }finally{s.db.close();}
});
test('permitted correction reverses VAT and preserves original and one audit event',()=>{
 const s=seed();try{
  const original=post(s),result=correct(s,original,{reason:'A'.repeat(500)});
  assert.deepEqual(result.reversal.lines.map(l=>[l.account,l.debitOre,l.creditOre]),[['5460',0,10000],['2641',0,2500],['1930',12500,0]]);
  assert.equal(result.correction.reason.length,500);
  assert.deepEqual(Accounting.entryById(s.db,s.company.id,original.id),original);
  assert.equal(count(s,'audit_events'),1);
  assert.throws(()=>correct(s,original),e=>e.code==='ENTRY_ALREADY_CORRECTED');
  assert.throws(()=>s.db.exec('DELETE FROM accounting_corrections'),/IMMUTABLE/);
  assert.equal(count(s,'accounting_entries'),2);
 }finally{s.db.close();}
});
test('correction of a permitted correction follows its original source chain',()=>{
 const s=seed();try{
  const first=correct(s,post(s));
  assert.equal(Admin.correctionPolicy(s.db,s.company.id,first.reversal.id).allowed,true);
  const next=correct(s,first.reversal);
  assert.equal(next.reversal.lines[0].debitOre,10000);
  assert.equal(count(s,'accounting_corrections'),2);
  const orphan=post(s,'accounting-correction-reversal');
  assert.throws(()=>correct(s,orphan),e=>e.code==='SOURCE_CORRECTION_REQUIRED');
 }finally{s.db.close();}
});
test('failed correction metadata or audit rolls back all new entries seals and sequence',()=>{
 for(const table of ['accounting_corrections','audit_events']){
  const s=seed();try{
   const original=post(s);
   s.db.exec(`CREATE TEMP TRIGGER fail_last BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
   assert.throws(()=>correct(s,original),/injected failure/);
   assert.equal(count(s,'accounting_entries'),1);assert.equal(count(s,'accounting_entry_seals'),1);
   assert.equal(count(s,'accounting_corrections'),0);assert.equal(count(s,'audit_events'),0);
   assert.equal(s.db.prepare('SELECT last_number AS n FROM accounting_sequences').get().n,1);
   s.db.exec('DROP TRIGGER fail_last');
   assert.equal(correct(s,original).reversal.number,'A2');
  }finally{s.db.close();}
 }
});
test('invalid replacement and outer rollback do not leave a partial correction',()=>{
 const s=seed();try{
  const original=post(s);
  for(const replacementLines of [{},[],[{account:'5460',debitOre:10},{account:'1930',creditOre:9}]])assert.throws(()=>correct(s,original,{replacementLines}));
  assert.throws(()=>Db.transaction(s.db,()=>{correct(s,original);throw new Error('outer failed');}),/outer failed/);
  assert.equal(count(s,'accounting_entries'),1);assert.equal(count(s,'accounting_corrections'),0);assert.equal(count(s,'audit_events'),0);
 }finally{s.db.close();}
});
test('HTTP repeated corrections create one reversal and one audit event; foreign ids stay hidden',async()=>{
 const s=seed(),original=post(s),linked=post(s,'supplier-invoice');
 const router=createAccountingAdminRouter({db:s.db});
 const server=http.createServer(async(req,res)=>{if(!await router.handle(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/v1/accounting/entries`;
 const token='isolated-test-session',csrf='isolated-test-csrf';
 Db.createSession(s.db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),companyId:s.company.id,userId:s.user.id,expiresAt:new Date(Date.now()+60000).toISOString()});
 const headers={Cookie:`rollands_session=${token}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
 const body=JSON.stringify({postingDate:'2026-09-19',reason:'HTTP repeat test'});
 try{
  assert.equal((await fetch(`${base}/${original.id}/correct`,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
  const denied=await fetch(`${base}/${linked.id}/correct`,{method:'POST',headers,body});
  assert.equal(denied.status,409);assert.equal((await denied.json()).code,'SOURCE_CORRECTION_REQUIRED');
  const results=await Promise.all([1,2].map(()=>fetch(`${base}/${original.id}/correct`,{method:'POST',headers,body})));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal(count(s,'accounting_entries'),3);assert.equal(count(s,'audit_events'),1);
  const company2=Db.createCompany(s.db,{legalName:'Other company',orgNumber:'TEST-OTHER'});
  const foreign=Accounting.postEntry(s.db,{companyId:company2.id,createdBy:s.user.id,postingDate:'2026-09-18',description:'Other company',sourceType:'manual',sourceId:'other',lines:[{account:'5460',debitOre:100},{account:'1930',creditOre:100}]}).entry;
  assert.equal((await fetch(`${base}/${foreign.id}/correct`,{method:'POST',headers,body})).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));s.db.close();}
});
