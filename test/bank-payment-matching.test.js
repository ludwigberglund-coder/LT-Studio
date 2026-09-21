'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Bank=require('../apps/api/bank-payments.js');
const Matcher=require('../packages/automation/bank-payment-matcher.js');

function invoice(overrides={}){return {id:'inv-1',companyId:'co-1',invoiceNumber:'310100',ocr:'83101001',customerName:'Nordic Office Göteborg AB',remainingOre:125000,...overrides}}
function payment(overrides={}){return {id:'bank-1',companyId:'co-1',externalId:'ext-1',bookingDate:'2026-09-16',amountOre:125000,reference:'83101001',message:'Faktura 310100',payerName:'Nordic Office Goteborg AB',...overrides}}

test('exakt OCR och restbelopp ger deterministiskt och begripligt förslag med full säkerhet',()=>{
  const analysis=Matcher.analyzeIncomingPayment(payment(),[invoice()]);
  assert.equal(analysis.status,'proposal');
  assert.equal(analysis.targetInvoiceId,'inv-1');
  assert.equal(analysis.targetInvoiceNumber,'310100');
  assert.equal(analysis.targetCustomerName,'Nordic Office Göteborg AB');
  assert.equal(analysis.confidence,1);
  assert.equal(analysis.deterministic,true);
  assert.equal(analysis.ambiguous,false);
  const proposal=Matcher.createMatchProposal(payment(),analysis,{createdBy:'user-1'});
  assert.equal(proposal.type,'bank-payment-match');
  assert.equal(proposal.status,'ready-for-approval');
  assert.equal(proposal.suggestion.invoiceId,'inv-1');
  assert.equal(proposal.suggestion.invoiceNumber,'310100');
  assert.equal(proposal.suggestion.customerName,'Nordic Office Göteborg AB');
  assert.equal(proposal.suggestion.amountOre,125000);
  assert.equal(proposal.suggestion.bankAccount,'1930');
  assert.equal(proposal.suggestion.receivableAccount,'1510');
});

test('korrekt fakturanummer och belopp ger också ett starkt förslag',()=>{
  const analysis=Matcher.analyzeIncomingPayment(payment({reference:'Faktura 310100',message:'',payerName:''}),[invoice({ocr:'99999999'})]);
  assert.equal(analysis.status,'proposal');
  assert.equal(analysis.targetInvoiceId,'inv-1');
  assert.equal(analysis.deterministic,true);
  assert.ok(analysis.confidence>=0.88);
});

test('samma belopp på flera fakturor utan tydlig referens går till manuell granskning eller ingen träff',()=>{
  const invoices=[invoice({id:'a',ocr:'111111',invoiceNumber:'1001',customerName:'Kund Ett AB'}),invoice({id:'b',ocr:'222222',invoiceNumber:'1002',customerName:'Kund Två AB'})];
  const analysis=Matcher.analyzeIncomingPayment(payment({reference:'Betalning',message:'',payerName:'',amountOre:125000}),invoices);
  assert.ok(['no-match','manual-review'].includes(analysis.status));
  assert.notEqual(analysis.deterministic,true);
});

test('nära lika starka kandidater markeras som tvetydiga',()=>{
  const invoices=[invoice({id:'a',invoiceNumber:'310100',ocr:'',customerName:'Test Kund AB'}),invoice({id:'b',invoiceNumber:'310100',ocr:'',customerName:'Test Kund AB'})];
  const analysis=Matcher.analyzeIncomingPayment(payment({reference:'310100',message:'',payerName:'Test Kund AB'}),invoices);
  assert.equal(analysis.ambiguous,true);
  assert.equal(analysis.status,'manual-review');
  assert.equal(analysis.deterministic,false);
});

test('stängda eller andra företags fakturor kan inte matchas',()=>{
  const analysis=Matcher.analyzeIncomingPayment(payment(),[
    invoice({id:'paid',remainingOre:0}),
    invoice({id:'other',companyId:'co-2'})
  ]);
  assert.equal(analysis.status,'no-match');
});

test('bankregistret stoppar dubbla externa bank-id och isolerar företag',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Bank.initializeBankPayments(db);
    const co1=Db.createCompany(db,{legalName:'Ett AB',displayName:'Ett',orgNumber:'559300-0001'});
    const co2=Db.createCompany(db,{legalName:'Två AB',displayName:'Två',orgNumber:'559300-0002'});
    const first=Bank.create(db,{companyId:co1.id,externalId:'bankref-123',bookingDate:'2026-09-16',amountOre:125000,reference:'83101001'});
    const second=Bank.create(db,{companyId:co1.id,externalId:'bankref-123',bookingDate:'2026-09-16',amountOre:125000,reference:'83101001'});
    assert.equal(first.duplicate,false);
    assert.equal(second.duplicate,true);
    assert.equal(first.payment.id,second.payment.id);
    assert.equal(Bank.list(db,co1.id).length,1);
    assert.equal(Bank.list(db,co2.id).length,0);
    assert.equal(Bank.byId(db,co2.id,first.payment.id),null);
  }finally{db.close()}
});

test('bankregistret accepterar endast positiva SEK-inbetalningar med datum',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const co=Db.createCompany(db,{legalName:'Ett AB',displayName:'Ett',orgNumber:'559300-0003'});
    Bank.initializeBankPayments(db);
    assert.throws(()=>Bank.create(db,{companyId:co.id,externalId:'x',bookingDate:'fel',amountOre:100}),e=>e.code==='INVALID_BANK_DATE');
    assert.throws(()=>Bank.create(db,{companyId:co.id,externalId:'x',bookingDate:'2026-09-16',amountOre:-1}),e=>e.code==='INVALID_BANK_AMOUNT');
    assert.throws(()=>Bank.create(db,{companyId:co.id,externalId:'x',bookingDate:'2026-09-16',amountOre:100,currency:'EUR'}),e=>e.code==='UNSUPPORTED_CURRENCY');
  }finally{db.close()}
});


test('tydlig referens och lägre belopp skapar ett mänskligt granskningsbart delbetalningsförslag',()=>{
  const analysis=Matcher.analyzeIncomingPayment(payment({amountOre:50000}),[invoice({remainingOre:125000})]);
  assert.equal(analysis.status,'proposal');
  assert.equal(analysis.targetInvoiceId,'inv-1');
  assert.equal(analysis.amountOre,50000);
  assert.equal(analysis.deterministic,false);
  assert.match(analysis.reason,/delbetalning/i);
  assert.ok(analysis.evidence.some(row=>row.label==='Delbetalning inom restbelopp'));
});

test('bankbelopp över fakturans restbelopp får inte matchas automatiskt',()=>{
  const analysis=Matcher.analyzeIncomingPayment(payment({amountOre:130000}),[invoice({remainingOre:125000})]);
  assert.equal(analysis.status,'no-match');
});
