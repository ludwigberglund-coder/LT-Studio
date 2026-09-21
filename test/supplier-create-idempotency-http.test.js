'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');

test('identiskt leverantörsskapande återanvänder leverantören utan ny audit',async()=>{
  const f=await fixture();
  try{
    const headers=await f.login(f.admin.username);
    const payload={
      supplierNumber:'L-IDEMP-NEW',
      name:'Idempotent Grossist AB',
      orgNumber:'559900-8820',
      email:'idem-supplier@example.invalid',
      bankgiro:'555-8820',
      plusgiro:'',
      defaultCostAccount:'4010'
    };

    const first=await fetch(f.base+'/api/v1/payables/suppliers',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const firstBody=await first.json();
    assert.equal(first.status,201);
    assert.equal(firstBody.duplicate,false);

    const retry=await fetch(f.base+'/api/v1/payables/suppliers',{
      method:'POST',headers,body:JSON.stringify(payload)
    });
    const retryBody=await retry.json();
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.supplier.id,firstBody.supplier.id);

    assert.equal(Payables.listSuppliers(f.db,f.a.id).filter(row=>row.supplierNumber===payload.supplierNumber).length,1);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_CREATED'&&event.entityId===firstBody.supplier.id).length,
      1
    );

    const changedName=await fetch(f.base+'/api/v1/payables/suppliers',{
      method:'POST',headers,body:JSON.stringify({...payload,name:'Annat Grossistnamn AB'})
    });
    assert.equal(changedName.status,409);
    assert.equal((await changedName.json()).code,'SUPPLIER_CREATE_IDEMPOTENCY_CONFLICT');

    const changedBank=await fetch(f.base+'/api/v1/payables/suppliers',{
      method:'POST',headers,body:JSON.stringify({...payload,bankgiro:'555-9999'})
    });
    assert.equal(changedBank.status,409);
    assert.equal((await changedBank.json()).code,'SUPPLIER_CREATE_IDEMPOTENCY_CONFLICT');

    assert.equal(Payables.listSuppliers(f.db,f.a.id).filter(row=>row.supplierNumber===payload.supplierNumber).length,1);
    assert.equal(
      Db.auditForCompany(f.db,f.a.id).filter(event=>event.action==='SUPPLIER_CREATED'&&event.entityId===firstBody.supplier.id).length,
      1
    );
  }finally{
    await f.close();
  }
});
