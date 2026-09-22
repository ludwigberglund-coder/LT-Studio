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
  Db.addMembership(db,{companyId:co1.id,userId:user.id});
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

test('logout kräver CSRF, raderar serversessionen och lämnar revisionsspår', async () => withApi(async ({base,password,db,co1}) => {
  const signed=await login(base,password);
  const missingCsrf=await fetch(`${base}/api/v1/auth/logout`,{method:'POST',headers:{Cookie:signed.cookie}});
  assert.equal(missingCsrf.status,403);

  const loggedOut=await fetch(`${base}/api/v1/auth/logout`,{method:'POST',headers:{Cookie:signed.cookie,'X-CSRF-Token':signed.body.csrfToken}});
  const body=await loggedOut.json();
  assert.equal(loggedOut.status,200);
  assert.equal(body.authenticated,false);
  assert.match(String(loggedOut.headers.get('set-cookie')||''),/Max-Age=0/);

  const after=await fetch(`${base}/api/v1/session`,{headers:{Cookie:signed.cookie}});
  assert.equal(after.status,200);
  assert.equal((await after.json()).authenticated,false);
  assert.ok(Db.auditForCompany(db,co1.id).some(event=>event.action==='SESSION_LOGOUT'));
}));

test('samma MFA-kod kan inte användas för två inloggningar', async () => withApi(async ({base,password}) => {
  const code=Auth.totpCode(TEST_MFA_SECRET);
  const payload={username:'sara.test',password,totp:code};
  const first=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(first.status,200);
  const replay=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const body=await replay.json();
  assert.equal(replay.status,409);
  assert.equal(body.code,'MFA_CODE_REPLAYED');
}));

test('inaktivitetsgränsen stänger sessionen även om absolut maxgräns återstår', async () => withApi(async ({base,password,db}) => {
  const signed=await login(base,password);
  assert.equal(signed.response.status,200);
  const rawToken=decodeURIComponent(signed.cookie.slice(signed.cookie.indexOf('=')+1));
  const tokenHash=Auth.hashToken(rawToken);

  db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z',absolute_expires_at='2099-01-01T00:00:00.000Z' WHERE token_hash=?").run(tokenHash);
  const session=await fetch(`${base}/api/v1/session`,{headers:{Cookie:signed.cookie}});
  const body=await session.json();
  assert.equal(session.status,200);
  assert.equal(body.authenticated,false);
}));

test('absolut sessionstid kan inte förlängas av fortsatt aktivitet', async () => withApi(async ({base,password,db}) => {
  const signed=await login(base,password);
  assert.equal(signed.response.status,200);
  const rawToken=decodeURIComponent(signed.cookie.slice(signed.cookie.indexOf('=')+1));
  const tokenHash=Auth.hashToken(rawToken);
  const before=db.prepare('SELECT expires_at AS expiresAt,absolute_expires_at AS absoluteExpiresAt FROM sessions WHERE token_hash=?').get(tokenHash);
  assert.ok(before.absoluteExpiresAt>before.expiresAt);

  db.prepare("UPDATE sessions SET expires_at='2099-01-01T00:00:00.000Z',absolute_expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?").run(tokenHash);
  const session=await fetch(`${base}/api/v1/session`,{headers:{Cookie:signed.cookie}});
  const body=await session.json();
  assert.equal(session.status,200);
  assert.equal(body.authenticated,false);
}));

test('personlig tvåtimmarsgräns styr både cookie och absolut serversession', async () => withApi(async ({base,password,db,user}) => {
  Db.setUserSessionDuration(db,{userId:user.id,sessionDurationMinutes:120});
  const signed=await login(base,password);
  assert.equal(signed.response.status,200);
  assert.match(String(signed.response.headers.get('set-cookie')||''),/Max-Age=7200/);
  const rawToken=decodeURIComponent(signed.cookie.slice(signed.cookie.indexOf('=')+1));
  const row=db.prepare('SELECT created_at AS createdAt,absolute_expires_at AS absoluteExpiresAt FROM sessions WHERE token_hash=?').get(Auth.hashToken(rawToken));
  const durationMinutes=(Date.parse(row.absoluteExpiresAt)-Date.parse(row.createdAt))/60000;
  assert.ok(durationMinutes>=119.9&&durationMinutes<=120.1);
}));

test('varje gång ger sessionscookie utan permanent Max-Age och behåller serverns säkerhetstak', async () => withApi(async ({base,password,db,user}) => {
  Db.setUserSessionDuration(db,{userId:user.id,sessionDurationMinutes:null});
  const signed=await login(base,password);
  assert.equal(signed.response.status,200);
  assert.doesNotMatch(String(signed.response.headers.get('set-cookie')||''),/Max-Age=/);
  const rawToken=decodeURIComponent(signed.cookie.slice(signed.cookie.indexOf('=')+1));
  const row=db.prepare('SELECT created_at AS createdAt,absolute_expires_at AS absoluteExpiresAt FROM sessions WHERE token_hash=?').get(Auth.hashToken(rawToken));
  const durationMinutes=(Date.parse(row.absoluteExpiresAt)-Date.parse(row.createdAt))/60000;
  assert.ok(durationMinutes>=479.9&&durationMinutes<=480.1);
}));

test('ändrad personlig sessionstid återkallar befintliga sessioner och kräver ny login', async () => withApi(async ({base,password,db,user}) => {
  const signed=await login(base,password);
  const before=await fetch(base+'/api/v1/profile/security',{headers:{Cookie:signed.cookie}});
  assert.equal(before.status,200);
  assert.equal((await before.json()).sessionDurationMinutes,480);

  const changed=await fetch(base+'/api/v1/profile/security',{
    method:'PUT',
    headers:{Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},
    body:JSON.stringify({sessionDurationMinutes:240})
  });
  const body=await changed.json();
  assert.equal(changed.status,200);
  assert.equal(body.reauthenticate,true);
  assert.equal(Db.userById(db,user.id).sessionDurationMinutes,240);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(user.id).n,0);
  assert.match(String(changed.headers.get('set-cookie')||''),/Max-Age=0/);

  const after=await fetch(base+'/api/v1/session',{headers:{Cookie:signed.cookie}});
  assert.equal((await after.json()).authenticated,false);
}));

test('LT Studio global admin behåller adminroll även om ett vanligt kundmedlemskap har lägre roll', async () => withApi(async ({base,password,db,user,co1}) => {
  Db.setMembershipRole(db,{companyId:co1.id,userId:user.id,role:'readonly'});
  Db.setUserPlatformAdmin(db,{userId:user.id,enabled:true});

  const response=await fetch(base+'/api/v1/auth/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'sara.test',password,totp:Auth.totpCode(TEST_MFA_SECRET),companyId:co1.id})
  });
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.role,'admin');

  const cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
  const sessionResponse=await fetch(base+'/api/v1/session',{headers:{Cookie:cookie}});
  const session=await sessionResponse.json();
  assert.equal(session.authenticated,true);
  assert.equal(session.user.platformAdmin,true);
  assert.equal(session.role,'admin');
  assert.ok(session.permissions.includes('users.manage'));
  assert.ok(session.permissions.includes('payroll.view'));
}));

test('LT Studio global admin kan välja alla företag och får adminroll utan kundmedlemskap', async () => withApi(async ({base,password,db,user,co2}) => {
  Db.setUserPlatformAdmin(db,{userId:user.id,enabled:true});
  const withoutMfa=await fetch(base+'/api/v1/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'sara.test',password,totp:'000000'})
  });
  const withoutMfaBody=await withoutMfa.json();
  assert.equal(withoutMfa.status,401);
  assert.equal(withoutMfaBody.code,'INVALID_MFA');
  assert.equal('companies' in withoutMfaBody,false);
  const response=await fetch(base+'/api/v1/auth/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'sara.test',password,totp:Auth.totpCode(TEST_MFA_SECRET),companyId:co2.id})
  });
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.company.id,co2.id);
  assert.equal(body.role,'admin');
  assert.equal(body.user.platformAdmin,true);
  const cookie=String(response.headers.get('set-cookie')||'').split(';')[0];

  const sessionResponse=await fetch(base+'/api/v1/session',{headers:{Cookie:cookie}});
  const session=await sessionResponse.json();
  assert.equal(session.authenticated,true);
  assert.equal(session.companyId,co2.id);
  assert.equal(session.role,'admin');
  assert.equal(session.user.platformAdmin,true);
  assert.ok(session.permissions.includes('users.manage'));

  const customers=await fetch(base+'/api/v1/customers',{headers:{Cookie:cookie}});
  const listed=await customers.json();
  assert.equal(customers.status,200);
  assert.equal(listed.customers.length,1);
  assert.equal(listed.customers[0].companyId,co2.id);
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

test('importerad faktura utan arkiverat utställningsbevis får påminnelse men inte automatisk dröjsmålsränta', async () => withApi(async ({base,password,inv1,db,co1}) => {
  const signed=await login(base,password);
  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const feeBlocked=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({sentDate:'2026-09-15',includeReminderFee:true,includeInterest:true})});
  assert.equal(feeBlocked.status,409);

  const interestBlocked=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({sentDate:'2026-09-15',includeReminderFee:false,includeInterest:true})});
  const blockedBody=await interestBlocked.json();
  assert.equal(interestBlocked.status,409);
  assert.equal(blockedBody.code,'INTEREST_START_BASIS_UNVERIFIED');
  assert.equal(Db.remindersForInvoice(db,co1.id,inv1.id).length,0);

  const created=await fetch(`${base}/api/v1/invoices/${inv1.id}/reminders`,{method:'POST',headers,body:JSON.stringify({sentDate:'2026-09-15',includeReminderFee:false,includeInterest:false,note:'Första påminnelsen utan ränta'})});
  const data=await created.json();
  assert.equal(created.status,201);
  assert.equal(data.deliveryStatus,'not-sent');
  assert.equal(data.reminder.reminderFeeOre,0);
  assert.equal(data.reminder.interestOre,0);
  assert.equal(data.reminder.interestStartBasis,'none');
  const savedReminder=Db.remindersForInvoice(db,co1.id,inv1.id)[0];
  assert.equal(savedReminder.deliveryStatus,'not-sent');
  assert.equal(savedReminder.deliveredAt,null);
  assert.equal(savedReminder.interestStartBasis,'none');
  assert.ok(Db.auditForCompany(db,co1.id).some(event=>event.action==='PAYMENT_REMINDER_CREATED'));
}));

test('fel lösenord avslöjar inte om användaren finns', async () => withApi(async ({base}) => {
  const response=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'sara.test',password:'fel fel fel fel fel fel'})});
  const body=await response.json();
  assert.equal(response.status,401);
  assert.equal(body.code,'INVALID_CREDENTIALS');
  assert.equal(body.error,'Användarnamn eller lösenord är fel.');
}));

test('upprepade felinloggningar skapar en pseudonymiserad plattformssäkerhetshändelse', async () => withApi(async ({base,db}) => {
  const password='felaktigt testlosenord 2026!';
  for(let attempt=1;attempt<=5;attempt+=1){
    const response=await fetch(`${base}/api/v1/auth/login`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'sara.test',password})
    });
    assert.equal(response.status,401);
  }

  const blocked=await fetch(`${base}/api/v1/auth/login`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'sara.test',password})
  });
  assert.equal(blocked.status,429);

  const events=Db.securityEvents(db);
  assert.equal(events.length,1);
  assert.equal(events[0].kind,'LOGIN_FAILURE_THRESHOLD');
  assert.equal(events[0].severity,'warning');
  assert.match(events[0].fingerprintHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(events[0].details,{scope:'ip-user',failureCount:5,windowMinutes:15,retryAfterSeconds:900});
  const serialized=JSON.stringify(events[0]);
  assert.doesNotMatch(serialized,/sara\.test|127\.0\.0\.1|felaktigt testlosenord/i);
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

  const headers={Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken};
  const missingRequestId=await fetch(`${base}/api/v1/customers`,{method:'POST',headers,body:JSON.stringify({name:'Ny Kund AB'})});
  assert.equal(missingRequestId.status,422);
  assert.equal((await missingRequestId.json()).code,'CUSTOMER_REQUEST_ID_REQUIRED');

  const request={requestId:'customer-create-request-0001',name:'Ny Kund AB',orgNumber:'559999-0001',email:'faktura@example.se',address:'Testgatan 1, Göteborg'};
  const created=await fetch(`${base}/api/v1/customers`,{method:'POST',headers,body:JSON.stringify(request)});
  const data=await created.json();
  assert.equal(created.status,201);
  assert.equal(data.duplicate,false);
  assert.equal(data.customer.customerNumber,'K-1001');
  assert.equal(data.customer.name,'Ny Kund AB');

  const retry=await fetch(`${base}/api/v1/customers`,{method:'POST',headers,body:JSON.stringify(request)});
  const retryData=await retry.json();
  assert.equal(retry.status,200);
  assert.equal(retryData.duplicate,true);
  assert.equal(retryData.customer.id,data.customer.id);
  assert.equal(retryData.customer.customerNumber,data.customer.customerNumber);

  const conflict=await fetch(`${base}/api/v1/customers`,{method:'POST',headers,body:JSON.stringify({...request,name:'Annan Kund AB'})});
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).code,'CUSTOMER_IDEMPOTENCY_CONFLICT');

  const after=Db.listCustomers(db,co1.id);
  assert.equal(after.length,2);
  assert.equal(after.filter(customer=>customer.id===data.customer.id).length,1);
  assert.equal(Db.auditForCompany(db,co1.id).filter(event=>event.action==='CUSTOMER_CREATED'&&event.entityId===data.customer.id).length,1);
}));
