'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Receivables = require('../packages/receivables/customer-receivables.js');

const legalRates = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'legal-rates.json'), 'utf8'));

test('kundreskontran innehåller alla läsbara kolumner från kravbilden och kan styras per kolumn', () => {
  const labels = Receivables.RECEIVABLE_COLUMNS.map(column => column.label);
  for (const label of ['Period','Avityp','Bet sätt','Girokonto','Avinr','Bokfdatum avi/fakt','Avibelopp','Ffd','Senaste påm','Avi kont','Buntnr','Betdatum','Bokfdatum trans','Bokntyp','Transnr','Transbelopp','Trans godk','Trans kont','Restbelopp']) {
    assert.ok(labels.includes(label), `Saknar kolumn ${label}`);
  }
  assert.equal(new Set(Receivables.RECEIVABLE_COLUMNS.map(column => column.id)).size, Receivables.RECEIVABLE_COLUMNS.length);
  assert.ok(Receivables.RECEIVABLE_COLUMNS.every(column => typeof column.defaultVisible === 'boolean'));
});

test('dröjsmålsränta följer referensränta + 8 procentenheter och räknas i ören', () => {
  const result = Receivables.statutoryInterest(1_000_000, '2026-08-31', '2026-09-20', legalRates);
  assert.equal(result.days, 20);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].annualRateBasisPoints, 1000);
  assert.equal(result.interestOre, 5479);
});

test('ränteberäkning delar upp perioden när referensräntan ändras', () => {
  const result = Receivables.statutoryInterest(1_000_000, '2025-06-25', '2025-07-05', legalRates);
  assert.equal(result.days, 10);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].referenceRateBasisPoints, 300);
  assert.equal(result.segments[1].referenceRateBasisPoints, 200);
});

test('påminnelseavgift läggs inte på utan dokumenterat avtal', () => {
  const invoice = {id:'inv-1',invoiceDate:'2026-08-01',dueDate:'2026-09-01',totalOre:100_000,remainingOre:100_000,transactions:[]};
  assert.throws(() => Receivables.reminderPreview(invoice, {
    sentDate:'2026-09-10', includeReminderFee:true, reminderFeeAgreed:false
  }, legalRates), error => error.code === 'REMINDER_FEE_NOT_AGREED');

  const preview = Receivables.reminderPreview(invoice, {
    sentDate:'2026-09-10', includeReminderFee:true, reminderFeeAgreed:true
  }, legalRates);
  assert.equal(preview.reminderFeeOre, 6000);
  assert.ok(preview.interestOre > 0);
  assert.equal(preview.totalDueOre, 100_000 + 6000 + preview.interestOre);
});

test('förseningsersättning och påminnelseavgift kombineras inte felaktigt', () => {
  const invoice={id:'inv-1',invoiceDate:'2026-08-01',dueDate:'2026-09-01',totalOre:100_000,remainingOre:100_000,transactions:[]};
  assert.throws(()=>Receivables.reminderPreview(invoice,{
    sentDate:'2026-09-10',includeReminderFee:true,reminderFeeAgreed:true,includeBusinessLatePaymentCompensation:true,customerType:'business'
  },legalRates),error=>error.code==='COLLECTION_COST_OVERLAP');
  assert.throws(()=>Receivables.reminderPreview(invoice,{
    sentDate:'2026-09-10',includeBusinessLatePaymentCompensation:true,customerType:'consumer'
  },legalRates),error=>error.code==='INVALID_LATE_PAYMENT_COMPENSATION');
});

test('fakturakommentar kräver personlig identitet och bevarar författare och tid', () => {
  assert.throws(() => Receivables.createInvoiceComment({invoiceId:'inv-1',companyId:'co-1',actor:null,text:'Ring kunden'}), error => error.code === 'MISSING_IDENTITY');
  const comment = Receivables.createInvoiceComment({
    invoiceId:'inv-1', companyId:'co-1', actor:{id:'user-1',name:'Anna Andersson'}, text:'  Kunden återkommer på fredag.  ', now:'2026-09-15T12:00:00.000Z'
  });
  assert.equal(comment.text, 'Kunden återkommer på fredag.');
  assert.equal(comment.authorId, 'user-1');
  assert.equal(comment.authorName, 'Anna Andersson');
  assert.equal(comment.createdAt, '2026-09-15T12:00:00.000Z');
});

test('automatisk betalningsmatchning godkänns bara när referens och exakt restbelopp ger en unik träff', () => {
  const invoices = [
    {id:'i1',invoiceNumber:'310001',ocr:'310001',remainingOre:125_000},
    {id:'i2',invoiceNumber:'310002',ocr:'310002',remainingOre:125_000}
  ];
  const exact = Receivables.matchPaymentProposal({amountOre:125_000,reference:'OCR 310001',text:'INBETALNING'}, invoices);
  assert.deepEqual(exact, {decision:'exact-match',confidence:1,reason:'Referens/OCR och exakt restbelopp ger en entydig matchning.',invoiceId:'i1'});
  const uncertain = Receivables.matchPaymentProposal({amountOre:125_000,reference:'',text:'INBETALNING'}, invoices);
  assert.equal(uncertain.decision, 'review');
  assert.equal(uncertain.invoiceId, null);
});

test('reskontraraden visar påminnelse, konto och transaktionsuppgifter', () => {
  const row = Receivables.receivableRow({
    id:'i1', kind:'customer', invoiceDate:'2026-09-01', postingDate:'2026-09-01', dueDate:'2026-09-30',
    invoiceNumber:'310001', totalOre:125_000, remainingOre:25_000, paymentAccount:'BG 123-4567', invoiceAccount:'1510',
    reminders:[{sentAt:'2026-10-03T09:00:00.000Z'}]
  }, {type:'payment',method:'Bankgiro',date:'2026-10-05',postingDate:'2026-10-05',batchNumber:'1042',journalNumber:'A42',amountOre:-100_000,approved:true,account:'1930'});
  assert.equal(row.latestReminderDate, '2026-10-03');
  assert.equal(row.paymentAccount, 'BG 123-4567');
  assert.equal(row.invoiceAccount, '1510');
  assert.equal(row.batchNumber, '1042');
  assert.equal(row.paymentDate, '2026-10-05');
  assert.equal(row.transactionApproved, 'Ja');
  assert.equal(row.transactionAccount, '1930');
  assert.equal(row.remainingOre, 25_000);
});


test('delbetalningens verkliga datum ändrar räntan och kapitalet delas upp spårbart', () => {
  const base={id:'inv-interest',invoiceDate:'2026-08-01',dueDate:'2026-09-01',totalOre:100_000,remainingOre:50_000};
  const early=Receivables.reminderPreview({...base,transactions:[{id:'p1',transactionType:'payment',paymentDate:'2026-09-02',amountOre:-50_000,approved:true}]},{reminderDate:'2026-09-18',includeInterest:true},legalRates);
  const late=Receivables.reminderPreview({...base,transactions:[{id:'p1',transactionType:'payment',paymentDate:'2026-09-17',amountOre:-50_000,approved:true}]},{reminderDate:'2026-09-18',includeInterest:true},legalRates);
  assert.equal(early.interestOre,246);
  assert.equal(late.interestOre,452);
  assert.deepEqual(early.interest.segments.map(s=>[s.from,s.to,s.principalOre]),[['2026-09-01','2026-09-02',100_000],['2026-09-02','2026-09-18',50_000]]);
  assert.deepEqual(late.interest.segments.map(s=>[s.from,s.to,s.principalOre]),[['2026-09-01','2026-09-17',100_000],['2026-09-17','2026-09-18',50_000]]);
});

test('kredit och betalning på påminnelsedagen påverkar saldo utan att bakdatera räntan', () => {
  const invoice={id:'inv-credit',invoiceDate:'2026-08-01',dueDate:'2026-09-01',totalOre:100_000,remainingOre:25_000,transactions:[
    {id:'c1',transactionType:'credit',postingDate:'2026-09-10',amountOre:-25_000,approved:true},
    {id:'p1',transactionType:'payment',paymentDate:'2026-09-18',amountOre:-50_000,approved:true}
  ]};
  const preview=Receivables.reminderPreview(invoice,{reminderDate:'2026-09-18',includeInterest:true},legalRates);
  assert.equal(preview.principalOre,25_000);
  assert.deepEqual(preview.interest.segments.map(s=>[s.from,s.to,s.principalOre]),[['2026-09-01','2026-09-10',100_000],['2026-09-10','2026-09-18',75_000]]);
});

test('automatisk ränta stoppas om saldohistoriken inte kan stämmas av', () => {
  const invoice={id:'inv-bad',invoiceDate:'2026-08-01',dueDate:'2026-09-01',totalOre:100_000,remainingOre:50_000,transactions:[]};
  assert.throws(()=>Receivables.reminderPreview(invoice,{reminderDate:'2026-09-18',includeInterest:true},legalRates),error=>error.code==='BALANCE_HISTORY_MISMATCH');
  const unknown={...invoice,remainingOre:90_000,transactions:[{id:'x',transactionType:'manual-adjustment',postingDate:'2026-09-10',amountOre:-10_000,approved:true}]};
  assert.throws(()=>Receivables.reminderPreview(unknown,{reminderDate:'2026-09-18',includeInterest:true},legalRates),error=>error.code==='UNSUPPORTED_BALANCE_HISTORY');
});

test('referensränta används bara inom uttryckligen verifierad kalenderhalvårsperiod', () => {
  const current=Receivables.referenceRateFor('2026-12-31',legalRates);
  assert.equal(current.basisPoints,200);
  assert.equal(current.validTo,'2026-12-31');
  assert.throws(()=>Receivables.referenceRateFor('2027-01-01',legalRates),error=>error.code==='MISSING_REFERENCE_RATE');
  assert.throws(()=>Receivables.statutoryInterest(100_000,'2026-12-31','2027-01-02',legalRates),error=>error.code==='MISSING_REFERENCE_RATE');
});

test('ränteunderlaget sparar exakt ränteperiod, konfigurationsversion och fakturabevis', () => {
  const invoice={id:'inv-proof',invoiceDate:'2026-08-01',dueDate:'2026-09-01',totalOre:100_000,remainingOre:100_000,transactions:[]};
  const record=Receivables.createReminderRecord({invoice,companyId:'co-1',actor:{id:'u1',name:'Test'},options:{reminderDate:'2026-09-18',includeInterest:true,interestBasis:{type:'issued-invoice-fixed-due-date',documentSha256:'abc'}},config:legalRates,now:'2026-09-18T08:00:00.000Z'});
  assert.equal(record.reminderDate,'2026-09-18');
  assert.equal(record.interestSegments[0].referenceRateValidFrom,'2026-07-01');
  assert.equal(record.interestSegments[0].referenceRateValidTo,'2026-12-31');
  assert.equal(record.interestSegments[0].rateConfigVersion,2);
  assert.equal(record.interestSegments[0].interestBasis.documentSha256,'abc');
});
