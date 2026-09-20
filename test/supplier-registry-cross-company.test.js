'use strict';

// Cross-company supplier registry mutations are intentionally verified at the HTTP boundary.
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');

// Cross-company supplier mutations must fail closed before any masterdata change is persisted.

test('leverantörsregister stoppar profil- och betalningsändring över företagsgränsen',async()=>{
  const f=await fixture();
  try{
    const foreignSupplierId=f.otherPayable.supplierId;
    const before=Payables.supplierById(f.db,f.b.id,foreignSupplierId);
    assert.ok(before);

    const headers=await f.login(f.admin.username);

    const profile=await fetch(f.base+'/api/v1/suppliers/'+foreignSupplierId+'/profile',{
      method:'PUT',
      headers,
      body:JSON.stringify({
        name:'Otillåtet ändrat leverantörsnamn',
        orgNumber:'559900-2888',
        email:'changed@example.invalid',
        defaultCostAccount:'4010'
      })
    });
    assert.equal(profile.status,404);
    assert.equal((await profile.json()).code,'SUPPLIER_NOT_FOUND');

    const payment=await fetch(f.base+'/api/v1/suppliers/'+foreignSupplierId+'/payment-details',{
      method:'POST',
      headers,
      body:JSON.stringify({bankgiro:'999-8888'})
    });
    assert.equal(payment.status,404);
    assert.equal((await payment.json()).code,'SUPPLIER_NOT_FOUND');

    const after=Payables.supplierById(f.db,f.b.id,foreignSupplierId);
    assert.deepEqual(after,before);

    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>
        ['SUPPLIER_PROFILE_UPDATED','SUPPLIER_PAYMENT_DETAILS_REQUESTED'].includes(event.action)&&
        event.entityId===foreignSupplierId
      ).length,
      0
    );
  }finally{
    await f.close();
  }
});
