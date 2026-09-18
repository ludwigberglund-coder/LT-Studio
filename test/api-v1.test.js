'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
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
  const issuedDocument=JSON.stringify({invoiceNumber:inv1.invoiceNumber,dueDate:inv1.dueDate,totalOre:inv1.totalOre});
  db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)')
    .run(inv1.id,co1.id,issuedDocument,crypto.createHash('sha256').update(issuedDocument).digest('hex'),'2026-08-01T12:00:00.000Z');
  const server=http.createServer((req,res)=>api.handle(req,res));
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  const address=server.address();
  const base=`http://127.0.0.1:${address.port}`;
  try { await callback({db,base,co1,co2,user,password,c1,c2,inv1,inv2}); }
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

test('påminnelseavgift utan avtal stoppas men lagstadgad ränta kan registreras spårbart och idempotent', async () => withApi(async ({base,password,inv1,db,co1}) => {
  const signed=await login(base,password);
  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const blocked=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({requestId:'REMINDER-BLOCK-0001',reminderDate:'2026-09-15',includeReminderFee:true,includeInterest:true})});
  assert.equal(blocked.status,409);
  const body={requestId:'REMINDER-CREATE-0001',reminderDate:'2026-09-15',includeReminderFee:false,includeInterest:true,note:'Första påminnelsen'};
  const created=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify(body)});
  const data=await created.json();
  assert.equal(created.status,201);
  assert.equal(data.deliveryStatus,'not-delivered');
  assert.equal(data.reminder.reminderFeeOre,0);
  assert.ok(data.reminder.interestOre>0);
  assert.equal(data.reminder.reminderDate,'2026-09-15');
  assert.equal(Db.remindersForInvoice(db,co1.id,inv1.id).length,1);
  assert.ok(Db.auditForCompany(db,co1.id).some(event=>event.action==='PAYMENT_REMINDER_CREATED'));

  const retry=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).duplicate,true);
  assert.equal(Db.remindersForInvoice(db,co1.id,inv1.id).length,1);

  const conflict=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({...body,reminderDate:'2026-09-16',note:'Ändrat underlag'})});
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).code,'REMINDER_REQUEST_CONFLICT');
  assert.equal(Db.remindersForInvoice(db,co1.id,inv1.id).length,1);
}));

test('fel lösenord avslöjar inte om användaren finns', async () => withApi(async ({base}) => {
  const response=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sara.test',password:'fel fel fel fel fel fel'})});
  const body=await response.json();
  assert.equal(response.status,401);
  assert.equal(body.code,'INVALID_CREDENTIALS');
  assert.equal(body.error,'Användarnamn eller lösenord är fel.');
}));

test('skyddat kundregister listar, skapar och isolerar kunder per företag', async () => withApi(async ({base,password,db,co1,co2}) => {
  const signed=await login(base,password);
  const listed=await fetch(`${base}/api/v1/customers`,{headers:{Cookie:signed.cookie}});
  const before=await listed.json();
  assert.equal(listed.status,200);
  assert.equal(before.customers.length,1);
  assert.equal(before.customers[0].companyId,co1.id);
  assert.equal(before.customers.some(customer=>customer.companyId===co2.id),false);

  const missingCsrf=await fetch(`${base}/api/v1/customers`,{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Ny Kund AB'})});
  assert.equal(missingCsrf.status,403);

  const created=await fetch(`${base}/api/v1/customers`,{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},body:JSON.stringify({name:'Ny Kund AB',orgNumber:'559999-0001',email:'faktura@example.se',address:'Testgatan 1, Göteborg'})});
  const data=await created.json();
  assert.equal(created.status,201);
  assert.equal(data.customer.customerNumber,'K-1001');
  assert.equal(data.customer.name,'Ny Kund AB');
  assert.ok(Db.auditForCompany(db,co1.id).some(event=>event.action==='CUSTOMER_CREATED'&&event.entityId===data.customer.id));
}));


test('automatisk ränta kräver verifierat utfärdat fakturaunderlag', async () => withApi(async ({base,password,db,co1,c1}) => {
  const raw=Db.createInvoice(db,{companyId:co1.id,customerId:c1.id,invoiceNumber:'310199',ocr:'310199',invoiceDate:'2026-08-01',postingDate:'2026-08-01',dueDate:'2026-08-31',totalOre:100000,remainingOre:100000,vatOre:20000,status:'Bokförd'});
  const signed=await login(base,password);
  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const response=await fetch(`${base}/api/v1/invoices/${raw.id}/reminders/preview`,{method:'POST',headers,body:JSON.stringify({reminderDate:'2026-09-15',includeInterest:true})});
  const body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.code,'INTEREST_BASIS_NOT_VERIFIED');
}));
