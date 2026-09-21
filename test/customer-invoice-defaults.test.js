'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Invoicing=require('../apps/api/customer-invoicing.js');

test('kundens faktureringsstandarder är tenant-isolerade och har säkra defaults',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Invoicing.initializeCustomerInvoicing(db);
    const a=Db.createCompany(db,{legalName:'Defaults A AB',displayName:'Defaults A',orgNumber:'559933-1001'});
    const b=Db.createCompany(db,{legalName:'Defaults B AB',displayName:'Defaults B',orgNumber:'559933-1002'});
    const ua=Db.createUser(db,{username:'defaults.a',displayName:'Defaults A',passwordHash:'test-only'});
    const ub=Db.createUser(db,{username:'defaults.b',displayName:'Defaults B',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:a.id,userId:ua.id});
    Db.addMembership(db,{companyId:b.id,userId:ub.id});
    const ca=Db.createCustomer(db,{companyId:a.id,customerNumber:'K-1001',name:'Kund A',customerType:'business'});
    const cb=Db.createCustomer(db,{companyId:b.id,customerNumber:'K-2001',name:'Kund B',customerType:'business'});

    assert.deepEqual(
      Invoicing.customerInvoicePreferences(db,a.id,ca.id),
      {paymentTermsDays:30,ourReference:'',yourReference:'',updatedBy:null,updatedAt:null}
    );

    const saved=Invoicing.setCustomerInvoicePreferences(db,{
      companyId:a.id,customerId:ca.id,paymentTermsDays:14,ourReference:'Anna Sälj',yourReference:'PO-4477',updatedBy:ua.id
    });
    assert.equal(saved.paymentTermsDays,14);
    assert.equal(saved.ourReference,'Anna Sälj');
    assert.equal(saved.yourReference,'PO-4477');
    assert.equal(Invoicing.customersWithInvoicePreferences(db,a.id)[0].paymentTermsDays,14);
    assert.equal(Invoicing.customersWithInvoicePreferences(db,b.id)[0].paymentTermsDays,30);

    assert.throws(
      ()=>Invoicing.setCustomerInvoicePreferences(db,{companyId:a.id,customerId:cb.id,paymentTermsDays:14,updatedBy:ua.id}),
      /TENANT_RELATION_VIOLATION/
    );
    assert.throws(
      ()=>Invoicing.setCustomerInvoicePreferences(db,{companyId:a.id,customerId:ca.id,paymentTermsDays:366,updatedBy:ua.id}),
      error=>error.code==='INVALID_CUSTOMER_PAYMENT_TERMS'
    );
    assert.throws(
      ()=>Invoicing.setCustomerInvoicePreferences(db,{companyId:a.id,customerId:ca.id,paymentTermsDays:30,ourReference:'x'.repeat(121),updatedBy:ua.id}),
      error=>error.code==='INVALID_CUSTOMER_INVOICE_REFERENCE'
    );
  }finally{
    db.close();
  }
});
