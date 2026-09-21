'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const AccountingSettings=require('../apps/api/accounting-settings.js');
const {createServer}=require('../apps/api/server.js');

const MFA='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const KEY='accounting-settings-api-test-key-longer-than-thirty-two-characters';
const PASSWORD='Sakert accounting settings test 2026!';

test('kundåterbetalningskonto kan läsas och ändras endast inom inloggat företag med CSRF',async()=>{
  const db=Db.openDatabase(':memory:');
  const a=Db.createCompany(db,{legalName:'Accounting Settings A AB',displayName:'Settings A',orgNumber:'559940-1001'});
  const b=Db.createCompany(db,{legalName:'Accounting Settings B AB',displayName:'Settings B',orgNumber:'559940-1002'});
  const user=Db.createUser(db,{username:'settings.user',displayName:'Settings User',passwordHash:Auth.hashPassword(PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA,KEY)});
  const other=Db.createUser(db,{username:'settings.other',displayName:'Other User',passwordHash:Auth.hashPassword(PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(MFA,KEY)});
  Db.addMembership(db,{companyId:a.id,userId:user.id});
  Db.addMembership(db,{companyId:b.id,userId:other.id});
  AccountingSettings.setCustomerRefundLiabilityAccount(db,{companyId:b.id,account:'2880',decisionReference:'Separat testbeslut för företag B.',updatedBy:other.id});

  const runtime=createServer({databasePath:':memory:',db,secureCookies:false,authEncryptionKey:KEY});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try{
    const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.username,password:PASSWORD,totp:Auth.totpCode(MFA)})});
    const signed=await login.json(),cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    assert.equal(login.status,200);

    const initial=await fetch(base+'/api/v1/accounting/settings',{headers:{Cookie:cookie}});
    const initialBody=await initial.json();
    assert.equal(initial.status,200);
    assert.equal(initialBody.settings,null);

    const noCsrf=await fetch(base+'/api/v1/accounting/settings/customer-refund-liability',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({account:'2890',decisionReference:'Verifierat testbeslut för företag A.'})});
    assert.equal(noCsrf.status,403);

    const headers={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':signed.csrfToken};
    const protectedAccount=await fetch(base+'/api/v1/accounting/settings/customer-refund-liability',{method:'PUT',headers,body:JSON.stringify({account:'2440',decisionReference:'Felaktigt testkonto ska stoppas.'})});
    const protectedBody=await protectedAccount.json();
    assert.equal(protectedAccount.status,409);
    assert.equal(protectedBody.code,'PROTECTED_CUSTOMER_REFUND_LIABILITY_ACCOUNT');

    const saved=await fetch(base+'/api/v1/accounting/settings/customer-refund-liability',{method:'PUT',headers,body:JSON.stringify({account:'2890',decisionReference:'Verifierat testbeslut för företag A.'})});
    const savedBody=await saved.json();
    assert.equal(saved.status,200);
    assert.equal(savedBody.settings.companyId,a.id);
    assert.equal(savedBody.settings.customerRefundLiabilityAccount,'2890');

    const loaded=await fetch(base+'/api/v1/accounting/settings',{headers:{Cookie:cookie}});
    const loadedBody=await loaded.json();
    assert.equal(loaded.status,200);
    assert.equal(loadedBody.settings.companyId,a.id);
    assert.equal(loadedBody.settings.customerRefundLiabilityAccount,'2890');
    assert.notEqual(loadedBody.settings.customerRefundLiabilityAccount,AccountingSettings.getAccountingSettings(db,b.id).customerRefundLiabilityAccount);

    const audit=Db.auditForCompany(db,a.id).find(event=>event.action==='CUSTOMER_REFUND_LIABILITY_ACCOUNT_CONFIGURED');
    assert.ok(audit);
    assert.equal(audit.details.account,'2890');
    assert.equal(Db.auditForCompany(db,b.id).some(event=>event.action==='CUSTOMER_REFUND_LIABILITY_ACCOUNT_CONFIGURED'),false);
  }finally{
    await new Promise(resolve=>runtime.close(resolve));
  }
});
