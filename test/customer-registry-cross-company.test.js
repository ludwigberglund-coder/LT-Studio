'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');

test('kundregister stoppar uppdatering av kund som tillhör annat företag',async()=>{
  const f=await fixture();
  try{
    const foreign=Db.createCustomer(f.db,{
      companyId:f.b.id,
      customerNumber:'K-FOREIGN-1',
      name:'Annat företags kund AB',
      address:{full:'Främmande gatan 1, Teststad'},
      orgNumber:'559900-1999',
      email:'foreign@example.invalid'
    });

    const before=Db.customerById(f.db,f.b.id,foreign.id);
    const headers=await f.login(f.admin.username);
    const response=await fetch(f.base+'/api/v1/customers/'+foreign.id,{
      method:'PUT',
      headers,
      body:JSON.stringify({
        name:'Försök till otillåten ändring',
        orgNumber:'559900-2888',
        email:'changed@example.invalid',
        address:'Ändrad adress 2, Teststad',
        reminderFeeAgreed:true
      })
    });

    assert.equal(response.status,404);
    assert.equal((await response.json()).code,'CUSTOMER_NOT_FOUND');

    const after=Db.customerById(f.db,f.b.id,foreign.id);
    assert.deepEqual(after,before);

    const wrongCompanyAudit=Db.auditForCompany(f.db,f.a.id)
      .filter(event=>event.action==='CUSTOMER_UPDATED'&&event.entityId===foreign.id);
    assert.equal(wrongCompanyAudit.length,0);
  }finally{
    await f.close();
  }
});
