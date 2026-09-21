'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
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
