'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Release=require('../apps/api/payment-release.js');
const Confirmation=require('../apps/api/payment-confirmation.js');
const SupplierAccounting=require('../apps/api/supplier-accounting.js');
const Accounting=require('../apps/api/accounting-store.js');
const Domain=require('../packages/payables/supplier-invoices.js');

function seed(){const db=Db.openDatabase(':memory:');SupplierAccounting.initializeSupplierAccounting(db);const company=Db.createCompany(db,{legalName:'Testbolag AB',displayName:'Testbolag',orgNumber:'559900-2020'});const hash=Auth.hashPassword('Sakert bokforingstest 2026!');const preparer=Db.createUser(db,{username:'prep2',displayName:'Förberedare',passwordHash:hash});const approver=Db.createUser(db,{username:'approve2',displayName:'Attestant',passwordHash:hash});const accountant=Db.createUser(db,{username:'account2',displayName:'Ekonom',passwordHash:hash});const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-20',name:'Grossisten AB',bankgiro:'222-3333',defaultCostAccount:'4010'});const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'F-2020',invoiceDate:'2026-09-01',dueDate:'2026-09-16',totalOre:125000,vatOre:25000,registeredBy:preparer.id});Payables.storeDocument(db,{companyId:company.id,invoiceId:invoice.id,name:'faktura.pdf',bytes:Buffer.from('%PDF-1.4\n% test\n')});const coding=Domain.buildCoding({totalOre:125000,vatOre:25000});Payables.saveCoding(db,{companyId:company.id,invoiceId:invoice.id,lines:coding.lines});approveCurrent(db,company.id,invoice.id,approver.id);const invoiceEntry=SupplierAccounting.postSupplierInvoice(db,{companyId:company.id,invoiceId:invoice.id,actorId:accountant.id}).entry;const payment=Payables.preparePayment(db,{companyId:company.id,invoiceId:invoice.id,paymentDate:'2026-09-16',amountOre:125000,account:'1930',preparedBy:preparer.id});Release.releasePayment(db,{companyId:company.id,paymentId:payment.id,releasedBy:approver.id});return{db,company,preparer,approver,accountant,invoice,payment,invoiceEntry}}
function approveCurrent(db,companyId,invoiceId,actorId){const current=Payables.invoiceById(db,companyId,invoiceId);return Payables.approve(db,{companyId,invoiceId,actorId,expectedCodingSha256:current.codingSha256,expectedDocumentSha256:current.documentSha256})}

test('återförsök måste behålla bokföringsdatum och bankreferens utan extra bokföring eller audit',()=>{
  const {db,company,accountant,payment,invoice}=seed();
  try {
    const request={companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-RETRY',postingDate:'2026-09-17',actorId:accountant.id};
    const first=Confirmation.confirmAndPost(db,request);
    for(let i=0;i<10;i++) assert.equal(Confirmation.confirmAndPost(db,request).entry.id,first.entry.id);
    for(const change of [{postingDate:'2026-10-01'},{postingDate:undefined},{confirmationReference:''},{confirmationReference:'OTHER-REFERENCE'}]) {
      assert.throws(()=>Confirmation.confirmAndPost(db,{...request,...change}),e=>e.code==='IDEMPOTENCY_CONFLICT');
    }
    assert.equal(Accounting.listEntries(db,company.id).filter(e=>e.sourceType==='supplier-payment').length,1);
    assert.equal(Db.auditForCompany(db,company.id).filter(e=>e.action==='SUPPLIER_PAYMENT_CONFIRMED_AND_POSTED').length,1);
    assert.equal(Payables.invoiceById(db,company.id,invoice.id).openAmountOre,0);
    assert.equal(Accounting.entryBySource(db,company.id,'supplier-payment',payment.id).postingDate,'2026-09-17');
  } finally {db.close()}
});


test('bekräftad leverantörsbetalning bokför 2440 mot bankkonto och markerar betald',()=>{const {db,company,accountant,invoice,payment,invoiceEntry}=seed();try{const result=Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-REF-20260916-1',postingDate:'2026-09-16',actorId:accountant.id});assert.equal(result.payment.status,'paid');assert.equal(result.payment.confirmationReference,'BANK-REF-20260916-1');assert.equal(result.entry.sourceType,'supplier-payment');assert.equal(result.entry.sourceId,payment.id);assert.deepEqual(result.entry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[['2440',125000,0],['1930',0,125000]]);const finalInvoice=Payables.invoiceById(db,company.id,invoice.id);assert.equal(finalInvoice.status,'paid');assert.equal(finalInvoice.openAmountOre,0);const net2440=[invoiceEntry,result.entry].flatMap(entry=>entry.lines).filter(line=>line.account==='2440').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);assert.equal(net2440,0);}finally{db.close()}});
test('utan bankreferens eller före frisläppning får betalning inte bokföras',()=>{const {db,company,accountant,payment}=seed();try{assert.throws(()=>Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'',postingDate:'2026-09-16',actorId:accountant.id}),e=>e.code==='CONFIRMATION_REFERENCE_REQUIRED');db.prepare(`UPDATE supplier_payments SET status='prepared' WHERE company_id=? AND id=?`).run(company.id,payment.id);assert.throws(()=>Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-2',postingDate:'2026-09-16',actorId:accountant.id}),e=>e.code==='INVALID_PAYMENT_STATUS');}finally{db.close()}});
test('låst period stoppar bokföringen och lämnar betalningen frisläppt',()=>{const {db,company,accountant,payment}=seed();try{db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(company.id,'2026-09');assert.throws(()=>Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-LOCK',postingDate:'2026-09-16',actorId:accountant.id}),e=>e.code==='PERIOD_LOCKED');assert.equal(Confirmation.paymentForConfirmation(db,company.id,payment.id).status,'released');assert.equal(Accounting.entryBySource(db,company.id,'supplier-payment',payment.id),null);}finally{db.close()}});
test('samma betalning med samma referens återanvänder befintlig verifikation',()=>{const {db,company,accountant,payment}=seed();try{const first=Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-ONCE',postingDate:'2026-09-16',actorId:accountant.id});const second=Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-ONCE',postingDate:'2026-09-16',actorId:accountant.id});assert.equal(second.duplicate,true);assert.equal(second.entry.id,first.entry.id);assert.equal(Accounting.listEntries(db,company.id).filter(entry=>entry.sourceType==='supplier-payment').length,1);assert.throws(()=>Confirmation.confirmAndPost(db,{companyId:company.id,paymentId:payment.id,confirmationReference:'BANK-TWICE',postingDate:'2026-09-16',actorId:accountant.id}),e=>e.code==='IDEMPOTENCY_CONFLICT');}finally{db.close()}});
