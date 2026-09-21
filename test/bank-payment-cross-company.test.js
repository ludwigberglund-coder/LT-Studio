'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./private-workflows-fixture.cjs');
const Db=require('../apps/api/database.js');
const Bank=require('../apps/api/bank-payments.js');

test('bankmatchning stoppar bankhändelse från annat företag',async()=>{
  const f=await fixture();
  try{
    const created=Bank.create(f.db,{
      companyId:f.b.id,
      externalId:'FOREIGN-BANK-001',
      bookingDate:'2026-09-20',
      valueDate:'2026-09-20',
      amountOre:125000,
      currency:'SEK',
      reference:'TEST-1001',
      payerName:'Främmande betalare',
      createdBy:f.other.id
    }).payment;
    const before=Bank.byId(f.db,f.b.id,created.id);
    assert.equal(before.status,'unmatched');

    const headers=await f.login(f.admin.username);
    const response=await fetch(f.base+'/api/v1/bank/payments/'+created.id+'/match',{
      method:'POST',
      headers,
      body:JSON.stringify({})
    });

    assert.equal(response.status,404);
    assert.equal((await response.json()).code,'BANK_PAYMENT_NOT_FOUND');
    assert.deepEqual(Bank.byId(f.db,f.b.id,created.id),before);

    const wrongCompanyAudit=Db.auditForCompany(f.db,f.a.id).filter(event=>
      ['BANK_PAYMENT_MATCH_NO_RESULT','BANK_PAYMENT_MATCH_PROPOSED'].includes(event.action)&&
      event.entityId===created.id
    );
    assert.equal(wrongCompanyAudit.length,0);
  }finally{
    await f.close();
  }
});
