'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('../apps/api/server.js');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');

const MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ENCRYPTION_KEY='operator-api-test-encryption-key-longer-than-32-chars';

async function withOperatorApi(fn){
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false,authEncryptionKey:ENCRYPTION_KEY});
  const operator=Db.createPlatformOperator(runtime.db,{
    username:'lt.operator',
    displayName:'LT Operator',
    passwordHash:Auth.hashPassword('Operatorens starka testlosenord 2026!'),
    mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)
  });
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{await fn({runtime,base,operator})}finally{await new Promise(resolve=>runtime.close(resolve))}
}
async function login(base){
  const response=await fetch(base+'/api/operator/v1/auth/login',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'lt.operator',password:'Operatorens starka testlosenord 2026!',totp:Auth.totpCode(MFA_SECRET,Date.now())})
  });
  const body=await response.json();
  const setCookie=String(response.headers.get('set-cookie')||'');
  const cookie=setCookie.split(';')[0];
  return{response,body,cookie};
}

test('operator-API kräver separat operatörssession och läcker inte kundernas affärsdata',()=>withOperatorApi(async({runtime,base})=>{
  const health=await fetch(base+'/api/operator/v1/health');
  assert.equal(health.status,200);

  const anonymous=await fetch(base+'/api/operator/v1/overview');
  assert.equal(anonymous.status,401);

  const customerCookieOnly=await fetch(base+'/api/operator/v1/overview',{headers:{Cookie:'rollands_session=fake-customer-token'}});
  assert.equal(customerCookieOnly.status,401);

  const company=Db.createCompany(runtime.db,{legalName:'Hemligt Kundbolag AB',displayName:'Kundbolag Ett',orgNumber:'559900-9101'});
  const customer=Db.createCustomer(runtime.db,{companyId:company.id,customerNumber:'SECRET-CUSTOMER-1',name:'Hemlig Slutkund'});
  Db.createInvoice(runtime.db,{companyId:company.id,customerId:customer.id,invoiceNumber:'SECRET-INVOICE-1',invoiceDate:'2026-09-21',postingDate:'2026-09-21',dueDate:'2026-10-21',totalOre:987654,remainingOre:987654,vatOre:197531,status:'Bokförd'});
  Db.appendSecurityEvent(runtime.db,{kind:'LOGIN_FAILURE_THRESHOLD',severity:'warning',fingerprintHash:'a'.repeat(64),details:{username:'must-not-leak',ip:'192.0.2.44'}});

  const signed=await login(base);
  assert.equal(signed.response.status,200);
  assert.equal(signed.body.authenticated,true);
  assert.match(signed.cookie,/^lt_operator_session=/);
  assert.doesNotMatch(signed.cookie,/rollands_session/);

  const overviewResponse=await fetch(base+'/api/operator/v1/overview',{headers:{Cookie:signed.cookie}});
  assert.equal(overviewResponse.status,200);
  const overview=await overviewResponse.json();
  assert.equal(overview.companyCount,1);
  assert.equal(overview.companies[0].displayName,'Kundbolag Ett');
  assert.equal(overview.companies[0].invoiceRecordCount,1);
  const serialized=JSON.stringify(overview);
  assert.doesNotMatch(serialized,/Hemlig Slutkund|SECRET-CUSTOMER|SECRET-INVOICE|987654|197531|192\.0\.2\.44|must-not-leak/);

  const securityResponse=await fetch(base+'/api/operator/v1/security-events',{headers:{Cookie:signed.cookie}});
  assert.equal(securityResponse.status,200);
  const security=await securityResponse.json();
  assert.equal(security.events.length,1);
  assert.deepEqual(Object.keys(security.events[0]).sort(),['createdAt','kind','severity']);
  assert.equal(security.events[0].kind,'LOGIN_FAILURE_THRESHOLD');
  assert.doesNotMatch(JSON.stringify(security),/aaaaaaaa|192\.0\.2\.44|must-not-leak/);

  const readiness=await fetch(base+'/api/operator/v1/readiness',{headers:{Cookie:signed.cookie}});
  assert.ok([200,503].includes(readiness.status));
  const readinessBody=await readiness.json();
  assert.equal(readinessBody.service,'rollands-api-v1');
  assert.ok(Array.isArray(readinessBody.checks));
}));

test('operator-session använder MFA, CSRF och server-side logout',()=>withOperatorApi(async({runtime,base,operator})=>{
  const badMfa=await fetch(base+'/api/operator/v1/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'lt.operator',password:'Operatorens starka testlosenord 2026!',totp:'000000'})
  });
  assert.equal(badMfa.status,401);

  const signed=await login(base);
  assert.equal(signed.response.status,200);

  const session=await fetch(base+'/api/operator/v1/session',{headers:{Cookie:signed.cookie}});
  assert.equal(session.status,200);
  const sessionBody=await session.json();
  assert.equal(sessionBody.authenticated,true);
  assert.equal(sessionBody.operator.id,operator.id);

  const logoutWithoutCsrf=await fetch(base+'/api/operator/v1/auth/logout',{method:'POST',headers:{Cookie:signed.cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal(logoutWithoutCsrf.status,403);

  const logout=await fetch(base+'/api/operator/v1/auth/logout',{
    method:'POST',
    headers:{Cookie:signed.cookie,'Content-Type':'application/json','X-CSRF-Token':signed.body.csrfToken},
    body:'{}'
  });
  assert.equal(logout.status,200);
  assert.match(String(logout.headers.get('set-cookie')||''),/lt_operator_session=;.*Max-Age=0/);

  const after=await fetch(base+'/api/operator/v1/session',{headers:{Cookie:signed.cookie}});
  assert.equal(after.status,200);
  assert.equal((await after.json()).authenticated,false);
  const audit=Db.platformOperatorAudit(runtime.db);
  assert.ok(audit.some(event=>event.action==='OPERATOR_SESSION_LOGIN'));
  assert.ok(audit.some(event=>event.action==='OPERATOR_SESSION_LOGOUT'));
}));

test('fem felaktiga operatörsinloggningar skapar critical-signal och spärrar nästa försök',()=>withOperatorApi(async({runtime,base})=>{
  for(let attempt=1;attempt<=5;attempt+=1){
    const response=await fetch(base+'/api/operator/v1/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'lt.operator',password:'helt fel lösenord',totp:'000000'})
    });
    assert.equal(response.status,401);
  }
  const blocked=await fetch(base+'/api/operator/v1/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:'lt.operator',password:'helt fel lösenord',totp:'000000'})
  });
  assert.equal(blocked.status,429);
  const events=Db.securityEvents(runtime.db).filter(event=>event.kind==='OPERATOR_LOGIN_FAILURE_THRESHOLD');
  assert.equal(events.length,1);
  assert.equal(events[0].severity,'critical');
  assert.match(events[0].fingerprintHash,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(events[0]),/lt\.operator|helt fel lösenord/);
}));
