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
  const invoice = {id:'inv-1', dueDate:'2026-09-01', totalOre:100_000, remainingOre:100_000, transactions:[]};
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
  const invoice={id:'inv-1',dueDate:'2026-09-01',totalOre:100_000,remainingOre:100_000,transactions:[]};
  assert.throws(()=>Receivables.reminderPreview(invoice,{
    sentDate:'2026-09-10',includeReminderFee:true,reminderFeeAgreed:true,includeBusinessLatePaymentCompensation:true,customerType:'business'
  },legalRates),error=>error.code==='COLLECTION_COST_OVERLAP');
  assert.throws(()=>Receivables.reminderPreview(invoice,{
    sentDate:'2026-09-10',includeBusinessLatePaymentCompensation:true,customerType:'consumer'
  },legalRates),error=>error.code==='INVALID_LATE_PAYMENT_COMPENSATION');
});

test('dröjsmålsränta följer faktisk delbetalningsdag i stället för dagens restbelopp', () => {
  const base={id:'inv-1',dueDate:'2026-09-01',totalOre:100_000,remainingOre:50_000};
  const early=Receivables.reminderPreview({...base,transactions:[{id:'p1',transactionType:'payment',paymentDate:'2026-09-02',amountOre:-50_000,approved:true}]},{sentDate:'2026-09-18'},legalRates);
  const late=Receivables.reminderPreview({...base,transactions:[{id:'p1',transactionType:'payment',paymentDate:'2026-09-17',amountOre:-50_000,approved:true}]},{sentDate:'2026-09-18'},legalRates);
  assert.equal(early.principalOre,50_000);
  assert.equal(late.principalOre,50_000);
  assert.ok(early.interestOre < late.interestOre);
  assert.equal(early.interest.segments[0].principalOre,100_000);
  assert.ok(early.interest.segments.some(segment=>segment.principalOre===50_000));
});

test('betalning före förfallodagen minskar kapitalet innan räntan börjar', () => {
  const preview=Receivables.reminderPreview({
    id:'inv-1',dueDate:'2026-09-10',totalOre:100_000,remainingOre:40_000,
    transactions:[{id:'p1',transactionType:'payment',paymentDate:'2026-09-05',amountOre:-60_000,approved:true}]
  },{sentDate:'2026-09-20'},legalRates);
  assert.equal(preview.principalOre,40_000);
  assert.ok(preview.interest.segments.every(segment=>segment.principalOre===40_000));
});

test('okänd framtida referensränteperiod är blockerad i stället för att ärva senaste räntan', () => {
  assert.throws(()=>Receivables.referenceRateFor('2027-01-01',legalRates),error=>error.code==='MISSING_REFERENCE_RATE');
  assert.throws(()=>Receivables.statutoryInterest(100_000,'2026-12-31','2027-01-02',legalRates),error=>error.code==='MISSING_REFERENCE_RATE');
});

test('ofullständig eller komplex saldohistorik blockeras hellre än att ränta gissas', () => {
  assert.throws(()=>Receivables.reminderPreview({id:'inv-1',dueDate:'2026-09-01',totalOre:100_000,remainingOre:50_000},{sentDate:'2026-09-18'},legalRates),error=>error.code==='INCOMPLETE_BALANCE_HISTORY');
  assert.throws(()=>Receivables.reminderPreview({
    id:'inv-1',dueDate:'2026-09-01',totalOre:100_000,remainingOre:50_000,
    transactions:[{id:'c1',transactionType:'credit',postingDate:'2026-09-10',amountOre:-50_000,approved:true}]
  },{sentDate:'2026-09-18'},legalRates),error=>error.code==='UNSUPPORTED_BALANCE_HISTORY');
});

test('påminnelsepost sparar beräkningsdag, leveransstatus och verifierad räntekonfiguration', () => {
  const record=Receivables.createReminderRecord({
    invoice:{id:'inv-1',dueDate:'2026-09-01',totalOre:100_000,remainingOre:100_000,transactions:[]},
    companyId:'co-1',actor:{id:'u1',name:'Anna'},options:{sentDate:'2026-09-18'},config:legalRates,now:'2026-09-18T09:00:00.000Z'
  });
  assert.equal(record.reminderDate,'2026-09-18');
  assert.equal(record.deliveryStatus,'not-sent');
  assert.equal(record.deliveredAt,null);
  assert.equal(record.rateConfigVersion,'1');
  assert.equal(record.rateVerifiedAt,'2026-09-15');
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
