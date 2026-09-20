'use strict';

// Cross-company supplier change decisions must fail closed before state or audit mutation.
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');
const Master=require('../apps/api/supplier-masterdata.js');

test('leverantörsändringar kan inte godkännas eller avslås från annat företag',async()=>{
  const f=await fixture();
  try{
    const supplierId=f.otherPayable.supplierId;
    const supplierBefore=Payables.supplierById(f.db,f.b.id,supplierId);
    const pending=Master.requestChange(f.db,{
      companyId:f.b.id,
      supplierId,
      kind:'payment-details',
      changes:{bankgiro:'999-8888'},
      requestedBy:f.other.id
    });
    assert.equal(pending.status,'pending');

    const headers=await f.login(f.admin.username);

    const approve=await fetch(f.base+'/api/v1/suppliers/changes/'+pending.id+'/approve',{
      method:'POST',
      headers,
      body:JSON.stringify({})
    });
    assert.equal(approve.status,404);
    assert.equal((await approve.json()).code,'CHANGE_NOT_FOUND');

    const reject=await fetch(f.base+'/api/v1/suppliers/changes/'+pending.id+'/reject',{
      method:'POST',
      headers,
      body:JSON.stringify({reason:'Otillåtet försök'})
    });
    assert.equal(reject.status,404);
    assert.equal((await reject.json()).code,'CHANGE_NOT_FOUND');

    assert.equal(Master.changeRequestById(f.db,f.b.id,pending.id).status,'pending');
    assert.deepEqual(Payables.supplierById(f.db,f.b.id,supplierId),supplierBefore);

    const wrongCompanyAudit=Db.auditForCompany(f.db,f.a.id).filter(event=>
      ['SUPPLIER_PAYMENT_DETAILS_APPROVED','SUPPLIER_PAYMENT_DETAILS_REJECTED'].includes(event.action)
    );
    assert.equal(wrongCompanyAudit.length,0);
  }finally{
    await f.close();
  }
});
