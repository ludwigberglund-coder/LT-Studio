'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Receivables=require('../packages/receivables/customer-receivables.js');

test('kundöversiktens restbelopp är samma källa som fakturornas reskontrasaldo',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Synthetic Receivables AB',displayName:'Synthetic Receivables',orgNumber:'555555-5555'});
    const a=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1001',name:'Kund Ett AB',orgNumber:'111111-1111',email:'ett@example.invalid',address:{full:'Testgatan 1'},customerType:'business'});
    const b=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1002',name:'Kund Två AB',orgNumber:'222222-2222',email:'tva@example.invalid',address:{full:'Testgatan 2'},customerType:'business'});
    Db.createInvoice(db,{companyId:company.id,customerId:a.id,invoiceNumber:'310001',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-10-01',totalOre:100000,remainingOre:60000,vatOre:20000,status:'Delbetald'});
    Db.createInvoice(db,{companyId:company.id,customerId:a.id,invoiceNumber:'310002',invoiceDate:'2026-09-02',postingDate:'2026-09-02',dueDate:'2026-10-02',totalOre:50000,remainingOre:50000,vatOre:10000,status:'Bokförd'});

    const summaries=Db.listCustomerReceivableSummaries(db,company.id);
    assert.equal(summaries.length,2,'alla aktiva kunder ska finnas i överblicken även utan fakturor');

    const first=summaries.find(row=>row.customerId===a.id);
    const second=summaries.find(row=>row.customerId===b.id);
    assert.equal(first.orgNumber,'111111-1111');
    assert.equal(first.invoiceCount,2);
    assert.equal(first.openInvoiceCount,2);
    assert.equal(first.remainingOre,110000,'kundsaldo ska vara summan av fakturornas remaining_ore');
    assert.equal(second.invoiceCount,0);
    assert.equal(second.remainingOre,0);

    const invoices=Db.listReceivables(db,company.id).filter(row=>row.customerId===a.id);
    assert.equal(invoices.reduce((sum,row)=>sum+row.remainingOre,0),first.remainingOre,'kundöversikt och reskontra ska alltid kunna stämmas av mot samma remaining_ore');
    assert.equal(invoices[0].customerOrgNumber,'111111-1111');
  }finally{
    db.close();
  }
});

test('reskontrasökning hittar kund via namn, organisationsnummer och fakturanummer',()=>{
  const customer={customerId:'customer-1',customerNumber:'K-1001',customerName:'Testkunden AB',orgNumber:'556677-8899'};
  const invoices=[{invoiceNumber:'310001',ocr:'310001'}];
  assert.equal(Receivables.customerMatchesReceivableSearch(customer,invoices,'Testkunden'),true);
  assert.equal(Receivables.customerMatchesReceivableSearch(customer,invoices,'556677-8899'),true);
  assert.equal(Receivables.customerMatchesReceivableSearch(customer,invoices,'310001'),true);
  assert.equal(Receivables.customerMatchesReceivableSearch(customer,invoices,'K-1001'),true);
  assert.equal(Receivables.customerMatchesReceivableSearch(customer,invoices,'annan kund'),false);
});
