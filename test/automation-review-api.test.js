'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Auth = require('../apps/api/auth.js');
const Db = require('../apps/api/database.js');
const Queues = require('../apps/api/queues.js');
const Automation = require('../packages/automation/proposals.js');
const {createApiApp} = require('../apps/api/app.js');
const {createAutomationReviewRouter} = require('../apps/api/automation-review-router.js');

const MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ENCRYPTION_KEY='automation-review-test-encryption-key-longer-than-thirty-two-characters';

async function withApi(callback) {
  const db=Db.openDatabase(':memory:');
  Queues.initializeQueues(db);
  const company=Db.createCompany(db,{legalName:'Automationsbolaget AB',displayName:'Automationsbolaget',orgNumber:'559400-0001'});
  const other=Db.createCompany(db,{legalName:'Annat Automationsbolag AB',displayName:'Annat Bolag',orgNumber:'559400-0002'});
  const password='Ett sakert automationslosenord 2026!';
  const user=Db.createUser(db,{username:'ekonom.test',displayName:'Ekonom Test',passwordHash:Auth.hashPassword(password),mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const proposal=Automation.createProposal({companyId:company.id,type:'booking-account-suggestion',sourceId:'supplier-100',confidence:.96,deterministic:false,reason:'Leverantör och tidigare bokningar pekar på samma kostnadskonto.',evidence:[{kind:'supplier-history',label:'Tidigare konto',value:'4010',sourceId:'supplier-100'}],suggestion:{amountOre:125000,vatOre:25000,debitAccount:'4010',vatAccount:'2641',creditAccount:'2440'},engine:{kind:'rules',name:'coding-suggestion',version:'1'},createdAt:'2026-09-16T04:00:00.000Z'});
  const saved=Queues.saveAutomationProposal(db,proposal,{idempotencyKey:'supplier-100:v1'}).proposal;
  const otherProposal=Automation.createProposal({companyId:other.id,type:'booking-account-suggestion',sourceId:'other-100',confidence:.97,deterministic:false,reason:'Annan kunds data.',evidence:[{kind:'history',label:'Konto',value:'5010',sourceId:'other-100'}],suggestion:{amountOre:10000,debitAccount:'5010',creditAccount:'2440'},engine:{name:'coding-suggestion',version:'1'},createdAt:'2026-09-16T04:01:00.000Z'});
  const otherSaved=Queues.saveAutomationProposal(db,otherProposal,{idempotencyKey:'other-100:v1'}).proposal;
  const api=createApiApp({db,secureCookies:false,authEncryptionKey:ENCRYPTION_KEY});
  const review=createAutomationReviewRouter({db});
  const server=http.createServer(async(req,res)=>{if(await review.handle(req,res))return;api.handle(req,res)});
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{await callback({db,base,password,company,other,saved,otherSaved});}
  finally{await new Promise(resolve=>server.close(resolve));db.close();}
}

async function login(base,password){
  const response=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'ekonom.test',password,totp:Auth.totpCode(MFA_SECRET)})});
  const body=await response.json();
  const cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
  return {response,body,cookie};
}

test('automationskön kräver personlig inloggning och visar begriplig kontering för eget företag',async()=>withApi(async({base,password,saved,otherSaved})=>{
  assert.equal((await fetch(`${base}/api/v1/automation/proposals`)).status,401);
  const signed=await login(base,password);
  assert.equal(signed.response.status,200);
  const response=await fetch(`${base}/api/v1/automation/proposals`,{headers:{Cookie:signed.cookie}});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.proposals.length,1);
  assert.equal(data.proposals[0].id,saved.id);
  assert.ok(!data.proposals.some(item=>item.id===otherSaved.id));
  assert.equal(data.executionPolicy,'human-approval-required');
  assert.ok(data.accounts.some(account=>account.number==='5460'&&/Förbrukningsmaterial/.test(account.name)));
  assert.equal(data.proposals[0].review.actionLabel,'Föreslå bokföring');
  assert.deepEqual(data.proposals[0].review.accountingLines.map(line=>line.account),['4010','2641','2440']);
  assert.equal(data.proposals[0].review.accountingLines[0].accountName,'Inköp varor och material');
}));

test('användaren kan ändra konton men inte skapa en obalanserad kontering',async()=>withApi(async({db,base,password,company,saved})=>{
  const signed=await login(base,password);
  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const invalid=await fetch(`${base}/api/v1/automation/proposals/${saved.id}/suggestion`,{method:'PUT',headers,body:JSON.stringify({accountingLines:[{account:'5460',debitOre:100000,creditOre:0},{account:'2641',debitOre:25000,creditOre:0},{account:'2440',debitOre:0,creditOre:120000}]})});
  assert.equal(invalid.status,422);
  assert.equal((await invalid.json()).code,'UNBALANCED_SUGGESTION');
  const response=await fetch(`${base}/api/v1/automation/proposals/${saved.id}/suggestion`,{method:'PUT',headers,body:JSON.stringify({accountingLines:[{account:'5460',debitOre:100000,creditOre:0,text:'Förbrukningsmaterial'},{account:'2641',debitOre:25000,creditOre:0,text:'Ingående moms'},{account:'2440',debitOre:0,creditOre:125000,text:'Leverantörsskuld'}]})});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.executionStatus,'not-executed');
  assert.equal(data.proposal.status,'manual-review');
  assert.equal(data.proposal.review.accountingLines[0].account,'5460');
  assert.equal(data.proposal.review.accountingLines[0].accountName,'Förbrukningsmaterial');
  assert.match(data.proposal.decisionReason,/ändrats manuellt/i);
  assert.ok(Db.auditForCompany(db,company.id).some(event=>event.action==='AUTOMATION_PROPOSAL_EDITED'));
}));

test('godkännande kräver CSRF och bokför aldrig förslaget automatiskt',async()=>withApi(async({db,base,password,company,saved})=>{
  const signed=await login(base,password);
  const withoutCsrf=await fetch(`${base}/api/v1/automation/proposals/${saved.id}/approve`,{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal(withoutCsrf.status,403);
  const response=await fetch(`${base}/api/v1/automation/proposals/${saved.id}/approve`,{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},body:'{}'});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.proposal.status,'approved');
  assert.equal(data.executionStatus,'not-executed');
  assert.match(data.message,/inte bokförts eller betalats automatiskt/i);
  assert.ok(Db.auditForCompany(db,company.id).some(event=>event.action==='AUTOMATION_PROPOSAL_APPROVED'));
}));

test('avvisning kräver motivering och sparas i revisionsloggen',async()=>withApi(async({db,base,password,company,saved})=>{
  const signed=await login(base,password);
  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const missing=await fetch(`${base}/api/v1/automation/proposals/${saved.id}/reject`,{method:'POST',headers,body:JSON.stringify({reason:''})});
  assert.equal(missing.status,422);
  const response=await fetch(`${base}/api/v1/automation/proposals/${saved.id}/reject`,{method:'POST',headers,body:JSON.stringify({reason:'Kostnaden avser ett annat inköp.'})});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.proposal.status,'rejected');
  assert.equal(data.proposal.rejectionReason,'Kostnaden avser ett annat inköp.');
  assert.ok(Db.auditForCompany(db,company.id).some(event=>event.action==='AUTOMATION_PROPOSAL_REJECTED'));
}));

test('känt id från annat företag ger 404 i stället för informationsläckage',async()=>withApi(async({base,password,otherSaved})=>{
  const signed=await login(base,password);
  const response=await fetch(`${base}/api/v1/automation/proposals/${otherSaved.id}/suggestion`,{method:'PUT',headers:{Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},body:JSON.stringify({accountingLines:[{account:'5010',debitOre:10000,creditOre:0},{account:'2440',debitOre:0,creditOre:10000}]})});
  assert.equal(response.status,404);
  assert.equal((await response.json()).code,'PROPOSAL_NOT_FOUND');
}));
