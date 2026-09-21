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


test('marsfaktura med 12 procent krediterad i april återför 12 procent medan nya aprilfakturor använder 6 procent',()=>{
  const {db,company,user,customer}=base();
  try{
    const march=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'M-RATE-12',invoiceDate:'2026-03-31',postingDate:'2026-03-31',dueDate:'2026-04-30',totalOre:11200,vatOre:1200,status:'Bokförd'});
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-03-31',description:'Livsmedel före sänkning',sourceType:'customer-invoice',sourceId:march.id,createdBy:user.id,series:'F',lines:[
      {account:'1510',text:'Kundfordran',debitOre:11200,creditOre:0},
      {account:'3052',text:'Livsmedel 12 procent',debitOre:0,creditOre:10000},
      {account:'2621',text:'Utgående moms 12',debitOre:0,creditOre:1200}
    ]});

    const credit=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'M-RATE-CREDIT',invoiceDate:'2026-04-02',postingDate:'2026-04-02',dueDate:'2026-04-02',totalOre:-11200,remainingOre:0,vatOre:-1200,status:'Kreditfaktura'});
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-04-02',description:'Kredit av marsfaktura',sourceType:'customer-credit-note',sourceId:credit.id,createdBy:user.id,series:'F',lines:[
      {account:'1510',text:'Återför kundfordran',debitOre:0,creditOre:11200},
      {account:'3052',text:'Återför livsmedel 12 procent',debitOre:10000,creditOre:0},
      {account:'2621',text:'Återför utgående moms 12',debitOre:1200,creditOre:0}
    ]});

    const april=Db.createInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'M-RATE-6',invoiceDate:'2026-04-03',postingDate:'2026-04-03',dueDate:'2026-05-03',totalOre:10600,vatOre:600,status:'Bokförd'});
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-04-03',description:'Livsmedel efter sänkning',sourceType:'customer-invoice',sourceId:april.id,createdBy:user.id,series:'F',lines:[
      {account:'1510',text:'Kundfordran',debitOre:10600,creditOre:0},
      {account:'3053',text:'Livsmedel 6 procent',debitOre:0,creditOre:10000},
      {account:'2631',text:'Utgående moms 6',debitOre:0,creditOre:600}
    ]});

    const marchReport=Reports.vatControl(db,company.id,{period:'2026-03'});
    assert.equal(marchReport.integrityOk,true);
    assert.equal(marchReport.outputVatByRate['12'],1200);
    assert.equal(marchReport.outputVatByRate['6'],0);

    const aprilReport=Reports.vatControl(db,company.id,{period:'2026-04'});
    assert.equal(aprilReport.integrityOk,true);
    assert.equal(aprilReport.outputVatByRate['12'],-1200);
    assert.equal(aprilReport.outputVatByRate['6'],600);
    assert.equal(aprilReport.outputVatOre,-600);
    assert.equal(aprilReport.sourceReconciliation.mismatches.length,0);
    assert.deepEqual(
      aprilReport.sourceReconciliation.customerInvoices.map(row=>[row.invoiceNumber,row.expectedVatOre,row.bookedVatOre]).sort(),
      [['M-RATE-6',600,600],['M-RATE-CREDIT',-1200,-1200]].sort()
    );
  }finally{db.close()}
});

test('EU/import och omvänd moms på ännu ej stödda momskonton gör perioden fail-closed',()=>{
  const {db,company,user}=base();
  try{
    Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-15',description:'EU-köp specialfall',sourceType:'manual',sourceId:'vat-special-eu',createdBy:user.id,series:'A',lines:[
      {account:'4056',text:'Inköp varor inom EU',debitOre:100000,creditOre:0},
      {account:'2614',text:'Utgående moms omvänd',debitOre:0,creditOre:25000},
      {account:'2645',text:'Beräknad ingående moms',debitOre:25000,creditOre:0},
      {account:'2440',text:'Leverantörsskuld',debitOre:0,creditOre:100000}
    ]});
    const report=Reports.vatControl(db,company.id,{period:'2026-09'});
    assert.equal(report.integrityOk,false);
    assert.equal(report.declarationReady,false);
    assert.deepEqual(report.unsupportedVatAccounts.map(row=>row.account).sort(),['2614','2645']);
    assert.match(report.warning,/inte.*deklarationsklar/i);
  }finally{db.close()}
});
