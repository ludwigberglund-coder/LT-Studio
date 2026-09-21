'use strict';

// Cross-company supplier change decisions must fail closed before state or audit mutation.
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');
const Master=require('../apps/api/supplier-masterdata.js');

test('leverantörens betalningsuppgifter kan inte ändras från annat företag',async()=>{
  const f=await fixture();
  try{
    const supplierId=f.otherPayable.supplierId;
    const supplierBefore=Payables.supplierById(f.db,f.b.id,supplierId);
    const headers=await f.login(f.admin.username);
    const response=await fetch(f.base+'/api/v1/suppliers/'+supplierId+'/payment-details',{
      method:'POST',
      headers,
      body:JSON.stringify({requestId:'cross-company-payment-0001',bankgiro:'999-8888'})
    });
    assert.equal(response.status,404);
    assert.equal((await response.json()).code,'SUPPLIER_NOT_FOUND');
    assert.deepEqual(Payables.supplierById(f.db,f.b.id,supplierId),supplierBefore);
    assert.equal(Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_PAYMENT_DETAILS_UPDATED').length,0);
  }finally{
    await f.close();
  }
});

test('leverantörs-HTTP återanvänder request-id utan dubbla audit- eller historikrader',async()=>{
  const f=await fixture();
  try{
    const supplier=Payables.createSupplier(f.db,{companyId:f.a.id,supplierNumber:'IDEMP-SUP',name:'Idempotent Leverantör AB',bankgiro:'111-2222',defaultCostAccount:'4010'});
    const headers=await f.login(f.admin.username);
    const profile={requestId:'supplier-http-profile-0001',name:'Idempotent Leverantör Ny AB',defaultCostAccount:'5460'};
    const first=await fetch(f.base+'/api/v1/suppliers/'+supplier.id+'/profile',{method:'PUT',headers,body:JSON.stringify(profile)});
    assert.equal(first.status,200);assert.equal((await first.json()).duplicate,false);
    const retry=await fetch(f.base+'/api/v1/suppliers/'+supplier.id+'/profile',{method:'PUT',headers,body:JSON.stringify(profile)});
    assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);
    assert.equal(Master.history(f.db,f.a.id,supplier.id).length,1);
    assert.equal(Db.auditForCompany(f.db,f.a.id).filter(e=>e.action==='SUPPLIER_PROFILE_UPDATED'&&e.entityId===supplier.id).length,1);
    const conflict=await fetch(f.base+'/api/v1/suppliers/'+supplier.id+'/profile',{method:'PUT',headers,body:JSON.stringify({...profile,name:'Konflikt AB'})});
    assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'SUPPLIER_IDEMPOTENCY_CONFLICT');

    const payment={requestId:'supplier-http-payment-0001',bankgiro:'999-8888'};
    const paymentFirst=await fetch(f.base+'/api/v1/suppliers/'+supplier.id+'/payment-details',{method:'POST',headers,body:JSON.stringify(payment)});
    assert.equal(paymentFirst.status,200);assert.equal((await paymentFirst.json()).duplicate,false);
    const paymentRetry=await fetch(f.base+'/api/v1/suppliers/'+supplier.id+'/payment-details',{method:'POST',headers,body:JSON.stringify(payment)});
    assert.equal(paymentRetry.status,200);assert.equal((await paymentRetry.json()).duplicate,true);
    assert.equal(Master.listPending(f.db,f.a.id).filter(x=>x.supplierId===supplier.id).length,0);
    assert.equal(Payables.supplierById(f.db,f.a.id,supplier.id).bankgiro,'999-8888');
    assert.equal(Master.history(f.db,f.a.id,supplier.id).filter(x=>x.changeType==='payment-details').length,1);
    assert.equal(Db.auditForCompany(f.db,f.a.id).filter(e=>e.action==='SUPPLIER_PAYMENT_DETAILS_UPDATED'&&e.entityId===supplier.id).length,1);
  }finally{await f.close()}
});
