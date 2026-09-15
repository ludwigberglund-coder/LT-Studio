'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Auth = require('../apps/api/auth.js');
const Db = require('../apps/api/database.js');
const {createApiApp} = require('../apps/api/app.js');

const TEST_MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const TEST_ENCRYPTION_KEY='test-only-api-encryption-key-longer-than-thirty-two-characters';

async function withApi(callback) {
  const db=Db.openDatabase(':memory:');
  const co1=Db.createCompany(db,{legalName:'Testbutiken AB',displayName:'Testbutiken',orgNumber:'559100-0001'});
  const co2=Db.createCompany(db,{legalName:'Annat Bolag AB',displayName:'Annat Bolag',orgNumber:'559100-0002'});
  const password='Ett sakert API testlosenord 2026!';
  const user=Db.createUser(db,{username:'sara.test',displayName:'Sara Test',passwordHash:Auth.hashPassword(password),mfaSecretEncrypted:Auth.encryptSecret(TEST_MFA_SECRET,TEST_ENCRYPTION_KEY)});
  Db.addMembership(db,{companyId:co1.id,userId:user.id,roles:['sales']});
  const c1=Db.createCustomer(db,{companyId:co1.id,customerNumber:'K-100',name:'Kund Ett AB',customerType:'business',reminderFeeAgreed:false});
  const c2=Db.createCustomer(db,{companyId:co2.id,customerNumber:'K-200',name:'Kund Två AB',customerType:'business',reminderFeeAgreed:true});
  const inv1=Db.createInvoice(db,{companyId:co1.id,customerId:c1.id,invoiceNumber:'310100',ocr:'310100',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd',paymentAccount:'BG 123-4567'});
  const inv2=Db.createInvoice(db,{companyId:co2.id,customerId:c2.id,invoiceNumber:'410200',ocr:'410200',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:200000,remainingOre:200000,vatOre:40000,status:'Bokförd'});
  const api=createApiApp({db,secureCookies:false,authEncryptionKey:TEST_ENCRYPTION_KEY});
  const server=http.createServer((req,res)=>api.handle(req,res));
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const address=server.address();
  const base=`http://127.0.0.1:${address.port}`;
  try { await callback({db,base,co1,co2,user,password,inv1,inv2}); }
  finally { await new Promise(resolve=>server.close(resolve)); db.close(); }
}

async function login(base,password) {
  const response=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sara.test',password,totp:Auth.totpCode(TEST_MFA_SECRET)})});
  const body=await response.json();
  const cookie=String(response.headers.get('set-cookie') || '').split(';')[0];
  return {response,body,cookie};
}

test('login skapar serverlagrad session och kundreskontran kräver session och MFA', async () => withApi(async ({base,password,inv1}) => {
  const anonymous=await fetch(`${base}/api/v1/receivables`);
  assert.equal(anonymous.status,401);
  const withoutMfa=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sara.test',password})});
  assert.equal(withoutMfa.status,401);
  assert.equal((await withoutMfa.json()).code,'INVALID_MFA');
  const signed=await login(base,password);
  assert.equal(signed.response.status,200);
  assert.ok(signed.cookie.startsWith('rollands_session='));
  assert.ok(signed.body.csrfToken);
  const response=await fetch(`${base}/api/v1/receivables`,{headers:{Cookie:signed.cookie}});
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.invoices.length,1);
  assert.equal(data.invoices[0].id,inv1.id);
  assert.ok(data.columns.some(column=>column.label==='Girokonto'));
  assert.ok(data.columns.some(column=>column.label==='Senaste påm'));
}));

test('mutation utan CSRF stoppas och kommentar blir synlig efter godkänd mutation', async () => withApi(async ({base,password,inv1}) => {
  const signed=await login(base,password);
  const missing=await fetch(`${base}/api/v1/invoices/${inv1.id}/comments`,{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json'},body:JSON.stringify({text:'Ring kunden'})});
  assert.equal(missing.status,403);
  const created=await fetch(`${base}/api/v1/invoices/${inv1.id}/comments`,{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},body:JSON.stringify({text:'Kunden återkommer på fredag.'})});
  assert.equal(created.status,201);
  const listed=await fetch(`${base}/api/v1/invoices/${inv1.id}/comments`,{headers:{Cookie:signed.cookie}});
  const comments=(await listed.json()).comments;
  assert.equal(comments.length,1);
  assert.equal(comments[0].text,'Kunden återkommer på fredag.');
  assert.equal(comments[0].authorName,'Sara Test');
}));

test('företagsisolering gör ett annat företags faktura osynlig även med känt id', async () => withApi(async ({base,password,inv2}) => {
  const signed=await login(base,password);
  const response=await fetch(`${base}/api/v1/invoices/${inv2.id}/comments`,{headers:{Cookie:signed.cookie}});
  assert.equal(response.status,404);
}));

test('påminnelseavgift utan avtal stoppas men lagstadgad ränta kan registreras spårbart', async () => withApi(async ({base,password,inv1,db,co1}) => {
  const signed=await login(base,password);
  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const blocked=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({sentDate:'2026-09-15',includeReminderFee:true,includeInterest:true})});
  assert.equal(blocked.status,409);
  const created=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({sentDate:'2026-09-15',includeReminderFee:false,includeInterest:true,note:'Första påminnelsen'})});
  const data=await created.json();
  assert.equal(created.status,201);
  assert.equal(data.deliveryStatus,'awaiting-mail-integration');
  assert.equal(data.reminder.reminderFeeOre,0);
  assert.ok(data.reminder.interestOre>0);
  assert.equal(Db.remindersForInvoice(db,co1.id,inv1.id).length,1);
  assert.ok(Db.auditForCompany(db,co1.id).some(event=>event.action==='PAYMENT_REMINDER_CREATED'));
}));

test('fel lösenord avslöjar inte om användaren finns', async () => withApi(async ({base}) => {
  const response=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sara.test',password:'fel fel fel fel fel fel'})});
  const body=await response.json();
  assert.equal(response.status,401);
  assert.equal(body.code,'INVALID_CREDENTIALS');
  assert.equal(body.error,'Användarnamn eller lösenord är fel.');
}));
