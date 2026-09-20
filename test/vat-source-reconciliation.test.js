'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Accounting=require('../apps/api/accounting-store.js');
const Payables=require('../apps/api/payables.js');
const Reports=require('../apps/api/reports.js');

function base(){
  const db=Db.openDatabase(':memory:');
  Accounting.initializeAccountingStore(db);Payables.initializePayables(db);
  const company=Db.createCompany(db,{legalName:'Moms Test AB',displayName:'Moms Test',orgNumber:'559970-1001'});
  const user=Db.createUser(db,{username:'vat.user',displayName:'VAT User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1',name:'Momskund AB'});
  return{db,company,user,customer};
}

test('momsavstämning stödjer blandad 25, 12 och 6 procent i samma kundfaktura',()=>{
  const {db,company,user,customer}=base();
  try{
    const invoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'M-1001',invoiceDate:'2026-09-10',postingDate:'2026-09-10',dueDate:'2026-10-10',totalOre:34300,vatOre:4300,status:'Bokförd'});
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-10',description:'Blandad moms',sourceType:'customer-invoice',sourceId:invoice.id,createdBy:user.id,series:'F',lines:[
      {account:'1510',text:'Kundfordran',debitOre:34300,creditOre:0},
      {account:'3051',text:'25 procent',debitOre:0,creditOre:10000},
      {account:'2611',text:'Utgående moms 25',debitOre:0,creditOre:2500},
      {account:'3052',text:'12 procent',debitOre:0,creditOre:10000},
      {account:'2621',text:'Utgående moms 12',debitOre:0,creditOre:1200},
      {account:'3053',text:'6 procent',debitOre:0,creditOre:10000},
      {account:'2631',text:'Utgående moms 6',debitOre:0,creditOre:600}
    ]});
    const report=Reports.vatControl(db,company.id,{period:'2026-09'});
    assert.equal(report.integrityOk,true);
    assert.deepEqual(report.outputVatByRate,{'25':2500,'12':1200,'6':600});
    assert.equal(report.outputVatOre,4300);
    assert.equal(report.sourceReconciliation.mismatches.length,0);
  }finally{db.close()}
});

test('bokförd kundfaktura utan källverifikation gör momsavstämningen fail-closed',()=>{
  const {db,company,customer}=base();
  try{
    const invoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'M-1002',invoiceDate:'2026-09-11',postingDate:'2026-09-11',dueDate:'2026-10-11',totalOre:12500,vatOre:2500,status:'Bokförd'});
    const report=Reports.vatControl(db,company.id,{period:'2026-09'});
    assert.equal(report.integrityOk,false);
    const mismatch=report.sourceReconciliation.mismatches.find(row=>row.invoiceId===invoice.id);
    assert.ok(mismatch);
    assert.equal(mismatch.missingEntry,true);
    assert.equal(mismatch.expectedVatOre,2500);
    assert.equal(mismatch.bookedVatOre,0);
  }finally{db.close()}
});

test('leverantörsfaktura markerad som bokförd utan källverifikation gör momsavstämningen fail-closed',()=>{
  const {db,company,user}=base();
  try{
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'Momsleverantör AB'});
    const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'L-MOMS-1',invoiceDate:'2026-09-12',dueDate:'2026-10-12',totalOre:12500,vatOre:2500,registeredBy:user.id});
    db.prepare("UPDATE supplier_invoices SET status='payment-prepared',liability_accounting_entry_id='missing-entry' WHERE company_id=? AND id=?").run(company.id,invoice.id);
    const report=Reports.vatControl(db,company.id,{period:'2026-09'});
    assert.equal(report.integrityOk,false);
    const mismatch=report.sourceReconciliation.mismatches.find(row=>row.invoiceId===invoice.id);
    assert.ok(mismatch);
    assert.equal(mismatch.kind,'supplier-invoice');
    assert.equal(mismatch.missingEntry,true);
    assert.equal(mismatch.expectedVatOre,2500);
  }finally{db.close()}
});

test('källverifikation med annat bokföringsdatum än fakturan flaggas',()=>{
  const {db,company,user,customer}=base();
  try{
    const invoice=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'M-1003',invoiceDate:'2026-09-13',postingDate:'2026-09-13',dueDate:'2026-10-13',totalOre:12500,vatOre:2500,status:'Bokförd'});
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-14',description:'Fel datum',sourceType:'customer-invoice',sourceId:invoice.id,createdBy:user.id,series:'F',lines:[
      {account:'1510',text:'Kundfordran',debitOre:12500,creditOre:0},
      {account:'3051',text:'Försäljning',debitOre:0,creditOre:10000},
      {account:'2611',text:'Utgående moms',debitOre:0,creditOre:2500}
    ]});
    const report=Reports.vatControl(db,company.id,{period:'2026-09'});
    const mismatch=report.sourceReconciliation.mismatches.find(row=>row.invoiceId===invoice.id);
    assert.equal(report.integrityOk,false);
    assert.ok(mismatch);assert.equal(mismatch.postingDateMismatch,true);
    assert.equal(mismatch.expectedPostingDate,'2026-09-13');assert.equal(mismatch.entryPostingDate,'2026-09-14');
  }finally{db.close()}
});
