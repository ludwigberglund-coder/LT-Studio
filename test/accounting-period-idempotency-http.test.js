'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Admin=require('../apps/api/accounting-admin.js');

test('periodlås och upplåsningsbegäran är idempotenta vid identiska HTTP-retries',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const period='2026-11';

    const firstLock=await fetch(f.base+`/api/v1/accounting/periods/${period}/lock`,{
      method:'POST',headers,body:JSON.stringify({})
    });
    const firstLockBody=await firstLock.json();
    assert.equal(firstLock.status,200);
    assert.equal(firstLockBody.duplicate,false);
    assert.equal(firstLockBody.period.status,'locked');

    const retryLock=await fetch(f.base+`/api/v1/accounting/periods/${period}/lock`,{
      method:'POST',headers,body:JSON.stringify({})
    });
    const retryLockBody=await retryLock.json();
    assert.equal(retryLock.status,200);
    assert.equal(retryLockBody.duplicate,true);
    assert.equal(retryLockBody.period.lockedAt,firstLockBody.period.lockedAt);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='ACCOUNTING_PERIOD_LOCKED'&&event.entityId===period).length,
      1
    );

    const payload={reason:'Retry-safe upplåsning för verifierad rättelse'};
    const firstUnlock=await fetch(f.base+`/api/v1/accounting/periods/${period}/unlock-request`,{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const firstUnlockBody=await firstUnlock.json();
    assert.equal(firstUnlock.status,201);
    assert.equal(firstUnlockBody.duplicate,false);
    assert.equal(firstUnlockBody.request.status,'pending');

    const retryUnlock=await fetch(f.base+`/api/v1/accounting/periods/${period}/unlock-request`,{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const retryUnlockBody=await retryUnlock.json();
    assert.equal(retryUnlock.status,200);
    assert.equal(retryUnlockBody.duplicate,true);
    assert.equal(retryUnlockBody.request.id,firstUnlockBody.request.id);
    assert.equal(
      Admin.listUnlockRequests(f.db,f.a.id,{status:'pending'}).filter(row=>row.period===period).length,
      1
    );
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='ACCOUNTING_PERIOD_UNLOCK_REQUESTED'&&event.entityId===period).length,
      1
    );

    const conflict=await fetch(f.base+`/api/v1/accounting/periods/${period}/unlock-request`,{
      method:'POST',headers,body:JSON.stringify({reason:'En annan orsak på samma väntande begäran'})
    });
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).code,'UNLOCK_ALREADY_PENDING');

    assert.equal(Admin.periodStatus(f.db,f.a.id,period).status,'locked');
    assert.equal(
      Admin.listUnlockRequests(f.db,f.a.id,{status:'pending'}).filter(row=>row.period===period).length,
      1
    );
  }finally{
    await f.close();
  }
});


test('flera behöriga kräver annan beslutsfattare men ensam kundanvändare kan självupplåsa med ny MFA',async()=>{
  const f=await fixture();
  try{
    const periodMulti='2026-12';
    const adminHeaders=await f.login(f.admin.username);
    let response=await fetch(f.base+`/api/v1/accounting/periods/${periodMulti}/lock`,{method:'POST',headers:adminHeaders,body:'{}'});
    assert.equal(response.status,200);
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodMulti}/unlock-request`,{method:'POST',headers:adminHeaders,body:JSON.stringify({reason:'Behöver öppna perioden för kontrollerad rättelse'})});
    assert.equal(response.status,201);
    const multiRequest=(await response.json()).request;

    const multiPolicy=await (await fetch(f.base+'/api/v1/accounting/unlock-requests?status=pending',{headers:adminHeaders})).json();
    assert.equal(multiPolicy.unlockPolicy.eligibleCustomerApprovers,2);
    assert.equal(multiPolicy.unlockPolicy.selfUnlockAllowed,false);

    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${multiRequest.id}/approve`,{
      method:'POST',headers:adminHeaders,
      body:JSON.stringify({reason:'Försök till självbeslut',password:f.PASSWORD,totp:Auth.totpCode(f.MFA)})
    });
    assert.equal(response.status,409);
    assert.equal((await response.json()).code,'SEPARATION_OF_DUTIES_FAILED');
    assert.equal(Admin.periodStatus(f.db,f.a.id,periodMulti).status,'locked');

    const otherHeaders=await f.login(f.auditor.username);
    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${multiRequest.id}/approve`,{
      method:'POST',headers:otherHeaders,body:JSON.stringify({reason:'Granskad och godkänd av annan behörig'})
    });
    assert.equal(response.status,200);
    assert.equal((await response.json()).selfUnlock,false);
    assert.equal(Admin.periodStatus(f.db,f.a.id,periodMulti).status,'open');

    const singleCompany=Db.createCompany(f.db,{legalName:'Enmansbolag Test AB',displayName:'Enmansbolag Test',orgNumber:'559900-1999'});
    const single=Db.createUser(f.db,{username:'single.owner',displayName:'Ensam ägare',passwordHash:Auth.hashPassword(f.PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(f.MFA,'test-only-private-workflows-key-not-for-production-1234')});
    Db.addMembership(f.db,{companyId:singleCompany.id,userId:single.id,role:'admin'});
    const singleHeaders=await f.login(single.username);
    const periodSingle='2026-10';

    response=await fetch(f.base+`/api/v1/accounting/periods/${periodSingle}/lock`,{method:'POST',headers:singleHeaders,body:'{}'});
    assert.equal(response.status,200);
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodSingle}/unlock-request`,{method:'POST',headers:singleHeaders,body:JSON.stringify({reason:'Ensam användare behöver fortsätta bokföringen'})});
    assert.equal(response.status,201);
    const singleRequest=(await response.json()).request;

    const singlePolicy=await (await fetch(f.base+'/api/v1/accounting/unlock-requests?status=pending',{headers:singleHeaders})).json();
    assert.equal(singlePolicy.unlockPolicy.eligibleCustomerApprovers,1);
    assert.equal(singlePolicy.unlockPolicy.selfUnlockAllowed,true);

    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${singleRequest.id}/approve`,{
      method:'POST',headers:singleHeaders,
      body:JSON.stringify({reason:'Verifierad självupplåsning för fortsatt bokföring',password:'fel lösenord',totp:Auth.totpCode(f.MFA)})
    });
    assert.equal(response.status,401);
    assert.equal((await response.json()).code,'REAUTH_PASSWORD_INVALID');
    assert.equal(Admin.periodStatus(f.db,singleCompany.id,periodSingle).status,'locked');

    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${singleRequest.id}/approve`,{
      method:'POST',headers:singleHeaders,
      body:JSON.stringify({reason:'Verifierad självupplåsning för fortsatt bokföring',password:f.PASSWORD,totp:Auth.totpCode(f.MFA)})
    });
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.selfUnlock,true);
    assert.equal(Admin.periodStatus(f.db,singleCompany.id,periodSingle).status,'open');
    const audit=Db.auditForCompany(f.db,singleCompany.id).find(event=>event.action==='ACCOUNTING_PERIOD_UNLOCKED'&&event.entityId===periodSingle);
    assert.ok(audit);
    assert.equal(audit.details.selfUnlock,true);
    assert.equal(audit.details.reauthenticated,true);
    assert.equal(audit.details.eligibleCustomerApprovers,1);
  }finally{
    await f.close();
  }
});
