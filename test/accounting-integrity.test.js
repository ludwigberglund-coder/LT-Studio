'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../lib/store.js');

function state() {
  return {
    business: {name: 'Test AB'},
    settings: {lockedPeriods: []},
    invoices: [{
      id: 'inv1', number: '100001', ocr: '100001', customerNumber: 'K-1', customer: 'Kund AB', address: 'Testgatan 1',
      reference: 'Test', ourContact: 'Anna', paymentTerms: 30, date: '2026-09-01', dueDate: '2026-10-01', postingDate: '2026-09-01',
      net: 100, vat: 25, total: 125, vatRate: 25, credit: false, lines: [{description: 'Vara', account: '3051', vatRate: 25, net: 100, vat: 25, total: 125}],
      vatSummary: [{rate: 25, net: 100, vat: 25}], seller: {name: 'Test AB'}, interestText: 'Dröjsmålsränta', journalNumber: 'A1', batchNumber: '1000', bookedDate: '2026-09-01'
    }],
    supplierInvoices: [],
    bankTransactions: [],
    journal: [{id: 'j1', number: 'A1', batchNumber: '1000', date: '2026-09-01', postingDate: '2026-09-01', series: 'A', description: 'Kundfaktura 100001', source: 'Kundfaktura', rows: [{account: '1510 Kundfordringar', debit: 125, credit: 0}, {account: '3051 Försäljning varor 25 %', debit: 0, credit: 100}, {account: '2611 Utgående moms 25 %', debit: 0, credit: 25}]}],
    activity: [],
    auditLog: []
  };
}

function balancedEntry(id, number, batchNumber, date = '2026-09-02') {
  return {id, number, batchNumber, date, postingDate: date, series: 'A', description: `Test ${number}`, source: 'Test', rows: [{account: '1930 Företagskonto', debit: 50, credit: 0}, {account: '3000 Försäljning', debit: 0, credit: 50}]};
}

test('försegling skyddar verifikationer och fakturans bokföringsunderlag', () => {
  const store = state();
  Store.sealAccountingIntegrity(store);
  const report = Store.validateStore(store);
  assert.equal(report.ok, true);
  assert.equal(report.summary.journalSealed, 1);
  assert.equal(report.summary.invoiceSealed, 1);
});

test('ändrad verifikationsrad upptäcks efter försegling', () => {
  const store = state();
  Store.sealAccountingIntegrity(store);
  store.journal[0].rows[1].credit = 99;
  const report = Store.validateStore(store);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /integritetskontrollen/.test(error)));
});

test('ändrad fakturakälla upptäcks efter försegling', () => {
  const store = state();
  Store.sealAccountingIntegrity(store);
  store.invoices[0].customer = 'Manipulerad Kund AB';
  const report = Store.validateStore(store);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /ursprungsuppgifterna har ändrats/.test(error)));
});

test('nya verifikationer kan läggas framför en befintlig obruten kedja', () => {
  const store = state();
  Store.sealAccountingIntegrity(store);
  store.journal.unshift(balancedEntry('j2', 'A2', '1001'));
  const before = Store.validateStore(store);
  assert.equal(before.ok, true);
  assert.equal(before.summary.journalPending, 1);
  Store.sealAccountingIntegrity(store);
  const after = Store.validateStore(store);
  assert.equal(after.ok, true);
  assert.equal(after.summary.journalSealed, 2);
  assert.equal(after.summary.journalPending, 0);
});

test('försegling vägrar reparera en manipulerad befintlig kedja', () => {
  const store = state();
  Store.sealAccountingIntegrity(store);
  store.journal[0].description = 'Efterhandsändrad';
  assert.throws(() => Store.sealAccountingIntegrity(store), error => error.code === 'ACCOUNTING_INTEGRITY_ERROR');
});

test('känd demobootstrap får byggas om kontrollerat och blir därefter helt förseglad', () => {
  const store = state();
  store.settings.testDataVersion = 2;
  store.journal[0].id = 'ver_A23';
  store.journal[0].number = 'A23';
  Store.sealAccountingIntegrity(store);
  store.journal.push(balancedEntry('test_v01', 'A180', '1180', '2026-08-18'));
  const pending = Store.validateStore(store);
  assert.equal(pending.ok, true);
  assert.equal(pending.summary.journalPending, 1);
  Store.sealAccountingIntegrity(store);
  const after = Store.validateStore(store);
  assert.equal(after.ok, true);
  assert.equal(after.summary.journalSealed, 2);
  assert.equal(after.summary.journalPending, 0);
});

test('okänd post efter en förseglad kedja stoppas även om testläget är aktivt', () => {
  const store = state();
  store.settings.testDataVersion = 2;
  store.journal[0].id = 'ver_A23';
  store.journal[0].number = 'A23';
  Store.sealAccountingIntegrity(store);
  store.journal.push(balancedEntry('real_journal', 'A180', '1180', '2026-08-18'));
  const report = Store.validateStore(store);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /oskyddat avbrott/.test(error)));
});
