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


test('admin kan alltid låsa upp sin egen period medan ekonom behåller kontrollregler',async()=>{
  const f=await fixture();
  try{
    const periodAdmin='2026-12';
    const adminHeaders=await f.login(f.admin.username);
    let response=await fetch(f.base+`/api/v1/accounting/periods/${periodAdmin}/lock`,{method:'POST',headers:adminHeaders,body:'{}'});
    assert.equal(response.status,200);
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodAdmin}/unlock-request`,{method:'POST',headers:adminHeaders,body:JSON.stringify({reason:'Admin behöver öppna perioden för kontrollerad rättelse'})});
    assert.equal(response.status,201);
    const adminRequest=(await response.json()).request;

    const adminPolicy=await (await fetch(f.base+'/api/v1/accounting/unlock-requests?status=pending',{headers:adminHeaders})).json();
    assert.equal(adminPolicy.unlockPolicy.adminSelfUnlockAllowed,true);
    assert.equal(adminPolicy.unlockPolicy.selfUnlockAllowed,true);

    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${adminRequest.id}/approve`,{
      method:'POST',headers:adminHeaders,
      body:JSON.stringify({reason:'Admin öppnar perioden efter kontroll'})
    });
    assert.equal(response.status,200);
    assert.equal((await response.json()).selfUnlock,true);
    assert.equal(Admin.periodStatus(f.db,f.a.id,periodAdmin).status,'open');
    const adminAudit=Db.auditForCompany(f.db,f.a.id).find(event=>event.action==='ACCOUNTING_PERIOD_UNLOCKED'&&event.entityId===periodAdmin);
    assert.ok(adminAudit);
    assert.equal(adminAudit.details.selfUnlock,true);
    assert.equal(adminAudit.details.adminOverride,true);
    assert.equal(adminAudit.details.reauthenticated,false);

    const accountantCompany=Db.createCompany(f.db,{legalName:'Ekonomitest AB',displayName:'Ekonomitest',orgNumber:'559900-2998'});
    const accountant=Db.createUser(f.db,{username:'period.accountant',displayName:'Periodekonom',passwordHash:Auth.hashPassword(f.PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(f.MFA,'test-only-private-workflows-key-not-for-production-1234')});
    const secondAccountant=Db.createUser(f.db,{username:'period.accountant.2',displayName:'Periodekonom 2',passwordHash:Auth.hashPassword(f.PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(f.MFA,'test-only-private-workflows-key-not-for-production-1234')});
    Db.addMembership(f.db,{companyId:accountantCompany.id,userId:accountant.id,role:'accountant'});
    Db.addMembership(f.db,{companyId:accountantCompany.id,userId:secondAccountant.id,role:'accountant'});
    const accountantHeaders=await f.login(accountant.username);
    const periodMulti='2026-09';
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodMulti}/lock`,{method:'POST',headers:accountantHeaders,body:'{}'});
    assert.equal(response.status,200);
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodMulti}/unlock-request`,{method:'POST',headers:accountantHeaders,body:JSON.stringify({reason:'Ekonom behöver öppna perioden'})});
    assert.equal(response.status,201);
    const multiRequest=(await response.json()).request;
    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${multiRequest.id}/approve`,{
      method:'POST',headers:accountantHeaders,body:JSON.stringify({reason:'Försök till självbeslut',password:f.PASSWORD,totp:Auth.totpCode(f.MFA)})
    });
    assert.equal(response.status,409);
    assert.equal((await response.json()).code,'SEPARATION_OF_DUTIES_FAILED');
    assert.equal(Admin.periodStatus(f.db,accountantCompany.id,periodMulti).status,'locked');

    const singleCompany=Db.createCompany(f.db,{legalName:'Enmansbolag Ekonom AB',displayName:'Enmansbolag Ekonom',orgNumber:'559900-1999'});
    const single=Db.createUser(f.db,{username:'single.accountant',displayName:'Ensam ekonom',passwordHash:Auth.hashPassword(f.PASSWORD),mfaSecretEncrypted:Auth.encryptSecret(f.MFA,'test-only-private-workflows-key-not-for-production-1234')});
    Db.addMembership(f.db,{companyId:singleCompany.id,userId:single.id,role:'accountant'});
    const singleHeaders=await f.login(single.username);
    const periodSingle='2026-10';
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodSingle}/lock`,{method:'POST',headers:singleHeaders,body:'{}'});
    assert.equal(response.status,200);
    response=await fetch(f.base+`/api/v1/accounting/periods/${periodSingle}/unlock-request`,{method:'POST',headers:singleHeaders,body:JSON.stringify({reason:'Ensam ekonom behöver fortsätta bokföringen'})});
    assert.equal(response.status,201);
    const singleRequest=(await response.json()).request;
    const singlePolicy=await (await fetch(f.base+'/api/v1/accounting/unlock-requests?status=pending',{headers:singleHeaders})).json();
    assert.equal(singlePolicy.unlockPolicy.adminSelfUnlockAllowed,false);
    assert.equal(singlePolicy.unlockPolicy.selfUnlockAllowed,true);
    const selfUnlockNow=Date.now();
    const currentCounter=Math.floor(selfUnlockNow/1000/30);
    let freshTotp='';
    for(const offset of [-1,0,1]){
      const counter=currentCounter+offset;
      const alreadyUsed=f.db.prepare('SELECT 1 FROM mfa_used_steps WHERE user_id=? AND totp_counter=?').get(single.id,counter);
      if(!alreadyUsed){freshTotp=Auth.totpCode(f.MFA,selfUnlockNow+offset*30000);break}
    }
    assert.equal(/^[0-9]{6}$/.test(freshTotp),true);
    response=await fetch(f.base+`/api/v1/accounting/unlock-requests/${singleRequest.id}/approve`,{
      method:'POST',headers:singleHeaders,
      body:JSON.stringify({reason:'Verifierad självupplåsning för fortsatt bokföring',password:f.PASSWORD,totp:freshTotp})
    });
    assert.equal(response.status,200);
    assert.equal(Admin.periodStatus(f.db,singleCompany.id,periodSingle).status,'open');
  }finally{
    await f.close();
  }
});
