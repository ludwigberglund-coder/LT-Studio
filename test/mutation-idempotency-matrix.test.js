'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Bank=require('../apps/api/bank-payments.js');
const Payables=require('../apps/api/payables.js');
const Documents=require('../apps/api/documents.js');
const Accounting=require('../apps/api/accounting-store.js');
const Admin=require('../apps/api/accounting-admin.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Release=require('../apps/api/payment-release.js');
const Payroll=require('../apps/api/payroll.js');

function fixture(){
  const db=Db.openDatabase(':memory:');
  Bank.initializeBankPayments(db);Payables.initializePayables(db);Documents.initializeDocuments(db);Admin.initializeAccountingAdmin(db);SupplierAccounting.initializeSupplierAccounting(db);Payroll.initializePayroll(db);
  const company=Db.createCompany(db,{legalName:'Idempotens Test AB',displayName:'Idempotens Test',orgNumber:'559960-1001'});
  const user=Db.createUser(db,{username:'idem.user',displayName:'Idempotens User',passwordHash:'test-only'});
  const approver=Db.createUser(db,{username:'idem.approver',displayName:'Idempotens Approver',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.addMembership(db,{companyId:company.id,userId:approver.id});
  return{db,company,user,approver};
}

test('bankimport med samma externa id skapar inte en andra bankhändelse och ändrat innehåll ger konflikt',()=>{
  const {db,company,user}=fixture();
  try{
    const input={companyId:company.id,externalId:'BANK-EXT-1',bookingDate:'2026-09-20',valueDate:'2026-09-21',amountOre:12500,currency:'SEK',reference:'REF-1',message:'Faktura 100',payerName:'Kund AB',payerAccount:'SE123',createdBy:user.id};
    const first=Bank.create(db,input);
    const second=Bank.create(db,{...input,createdBy:null});
    assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);assert.equal(second.payment.id,first.payment.id);
    for(const patch of [{amountOre:12600},{bookingDate:'2026-09-19'},{reference:'REF-2'},{message:'Annat underlag'}]){
      assert.throws(()=>Bank.create(db,{...input,...patch}),e=>e.code==='BANK_IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
    }
    assert.equal(Bank.list(db,company.id).length,1);
    assert.equal(Bank.byExternalId(db,company.id,input.externalId).amountOre,12500);
  }finally{db.close()}
});

test('leverantörsfaktura med samma leverantör och normaliserade fakturanummer stoppas utan dubblett',()=>{
  const {db,company,user}=fixture();
  try{
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'Leverantör AB'});
    const first=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'INV-100 / 2026',invoiceDate:'2026-09-20',dueDate:'2026-10-20',totalOre:12500,vatOre:2500,registeredBy:user.id});
    assert.throws(()=>Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'inv1002026',invoiceDate:'2026-09-20',dueDate:'2026-10-20',totalOre:12500,vatOre:2500,registeredBy:user.id}),e=>e.code==='DUPLICATE_SUPPLIER_INVOICE'&&e.statusCode===409);
    assert.equal(Payables.listInvoices(db,company.id).length,1);
    assert.equal(Payables.listInvoices(db,company.id)[0].id,first.id);
  }finally{db.close()}
});

test('samma dokumentbytes kan inte arkiveras två gånger i samma företag',()=>{
  const {db,company,user}=fixture();
  try{
    const bytes=Buffer.from('%PDF-1.4\nSamma original\n');
    const first=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Original A',fileName:'a.pdf',mimeType:'application/pdf'});
    Documents.storeContent(db,{companyId:company.id,documentId:first.id,bytes});
    const second=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Original B',fileName:'b.pdf',mimeType:'application/pdf'});
    assert.throws(()=>Documents.storeContent(db,{companyId:company.id,documentId:second.id,bytes}),e=>e.code==='DUPLICATE_DOCUMENT'&&e.statusCode===409);
    assert.equal(Documents.listDocuments(db,company.id).filter(row=>row.status==='ready').length,1);
  }finally{db.close()}
});

test('dubbel rättelse av samma bokföringspost skapar inte extra motverifikation',()=>{
  const {db,company,user}=fixture();
  try{
    const original=Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-20',description:'Manuell post',sourceType:'manual',sourceId:'idem-original',createdBy:user.id,series:'A',lines:[
      {account:'1930',text:'Bank',debitOre:10000,creditOre:0},
      {account:'2999',text:'Motkonto',debitOre:0,creditOre:10000}
    ]}).entry;
    const first=Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-20',reason:'Rättelse test',replacementLines:null,createdBy:user.id});
    assert.ok(first.reversal?.id);
    const before=Accounting.listEntries(db,company.id,{limit:100}).length;
    assert.throws(()=>Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-20',reason:'Rättelse test',replacementLines:null,createdBy:user.id}),e=>e.code==='ENTRY_ALREADY_CORRECTED'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id,{limit:100}).length,before);
    assert.equal(Admin.listCorrections(db,company.id).length,1);
  }finally{db.close()}
});


test('leverantörsbokföring och betalning är retry-säkra utan dubbla ekonomiska effekter',()=>{
  const {db,company,user,approver}=fixture();
  try{
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-PAY-1',name:'Retry Leverantör AB',bankgiro:'123-4567',defaultCostAccount:'4010'});
    const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'RETRY-100',invoiceDate:'2026-09-20',dueDate:'2026-09-25',totalOre:125000,vatOre:25000,registeredBy:user.id});
    Payables.storeDocument(db,{companyId:company.id,invoiceId:invoice.id,name:'retry.pdf',bytes:Buffer.from('%PDF-1.4\nretry supplier invoice\n')});
    Payables.saveCoding(db,{companyId:company.id,invoiceId:invoice.id,lines:[
      {account:'4010',text:'Kostnad',debitOre:100000,creditOre:0},
      {account:'2641',text:'Moms',debitOre:25000,creditOre:0},
      {account:'2440',text:'Skuld',debitOre:0,creditOre:125000}
    ]});
    const reviewed=Payables.invoiceById(db,company.id,invoice.id);
    Payables.approve(db,{companyId:company.id,invoiceId:invoice.id,actorId:approver.id,expectedCodingSha256:reviewed.codingSha256,expectedDocumentSha256:reviewed.documentSha256});

    const posted=SupplierAccounting.postSupplierInvoice(db,{companyId:company.id,invoiceId:invoice.id,actorId:user.id});
    const postedRetry=SupplierAccounting.postSupplierInvoice(db,{companyId:company.id,invoiceId:invoice.id,actorId:user.id});
    assert.equal(posted.duplicate,false);assert.equal(postedRetry.duplicate,true);assert.equal(postedRetry.entry.id,posted.entry.id);
    assert.equal(Accounting.listEntries(db,company.id).filter(row=>row.sourceType==='supplier-invoice').length,1);

    const paymentInput={companyId:company.id,invoiceId:invoice.id,paymentDate:'2026-09-25',amountOre:125000,account:'1930',preparedBy:user.id};
    const payment=Payables.preparePayment(db,paymentInput);
    const paymentRetry=Payables.preparePayment(db,paymentInput);
    assert.equal(paymentRetry.id,payment.id);
    assert.throws(()=>Payables.preparePayment(db,{...paymentInput,paymentDate:'2026-09-26'}),e=>e.code==='PAYMENT_ALREADY_EXISTS'&&e.statusCode===409);
    assert.equal(Payables.listPayments(db,company.id).length,1);

    const released=Release.releasePayment(db,{companyId:company.id,paymentId:payment.id,releasedBy:approver.id});
    assert.equal(released.status,'released');
    assert.throws(()=>Release.releasePayment(db,{companyId:company.id,paymentId:payment.id,releasedBy:approver.id}),e=>e.code==='INVALID_PAYMENT_STATUS'&&e.statusCode===409);

    const confirmation={companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-RETRY-100',postingDate:'2026-09-25',actorId:user.id};
    const confirmed=SupplierAccounting.confirmSupplierPayment(db,confirmation);
    const confirmedRetry=SupplierAccounting.confirmSupplierPayment(db,confirmation);
    assert.equal(confirmed.duplicate,false);assert.equal(confirmedRetry.duplicate,true);assert.equal(confirmedRetry.entry.id,confirmed.entry.id);
    assert.throws(()=>SupplierAccounting.confirmSupplierPayment(db,{...confirmation,confirmationReference:'BANK-RETRY-OTHER'}),e=>e.code==='IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id).filter(row=>row.sourceType==='supplier-payment').length,1);
    assert.equal(Payables.invoiceById(db,company.id,invoice.id).openAmountOre,0);
  }finally{db.close()}
});

test('löneimport och lönebokföring kan återförsökas utan dubbla lönekörningar eller verifikationer',()=>{
  const {db,company,user}=fixture();
  try{
    const input={
      companyId:company.id,period:'2026-09',payDate:'2026-09-25',sourceName:'Retry payroll',
      grossSalaryOre:100000,withheldTaxOre:30000,employerContributionsOre:31420,netPayOre:70000,vacationLiabilityChangeOre:0,importedBy:user.id,
      lines:[
        {account:'7010',text:'Bruttolön',debitOre:100000,creditOre:0},
        {account:'7510',text:'Arbetsgivaravgifter',debitOre:31420,creditOre:0},
        {account:'2710',text:'Personalskatt',debitOre:0,creditOre:30000},
        {account:'2731',text:'Arbetsgivaravgifter skuld',debitOre:0,creditOre:31420},
        {account:'2910',text:'Upplupna löner',debitOre:0,creditOre:70000}
      ]
    };
    const run=Payroll.importRun(db,input);
    assert.throws(()=>Payroll.importRun(db,input),e=>e.code==='DUPLICATE_PAYROLL_RUN'&&e.statusCode===409);
    assert.equal(Payroll.listRuns(db,company.id).length,1);

    const posted=Payroll.postRun(db,{companyId:company.id,runId:run.id,postedBy:user.id});
    assert.ok(posted.entry.id);
    assert.throws(()=>Payroll.postRun(db,{companyId:company.id,runId:run.id,postedBy:user.id}),e=>e.code==='PAYROLL_ALREADY_POSTED'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id).filter(row=>row.sourceType==='payroll-run'&&row.sourceId===run.id).length,1);
    assert.equal(Payroll.runById(db,company.id,run.id).accountingEntryId,posted.entry.id);
  }finally{db.close()}
});
