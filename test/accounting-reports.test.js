'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Reports = require('../public/accounting-reports.js');

function store() {
  return {journal: [
    {id:'j1',number:'A1',batchNumber:'1000',date:'2026-01-15',description:'Start',rows:[{account:'1930 Företagskonto',debit:1000,credit:0},{account:'2091 Balanserad vinst',debit:0,credit:1000}]},
    {id:'j2',number:'A2',batchNumber:'1001',date:'2026-02-01',description:'Försäljning',rows:[{account:'1930 Företagskonto',debit:125,credit:0},{account:'3051 Försäljning varor',debit:0,credit:100},{account:'2611 Utgående moms',debit:0,credit:25}]},
    {id:'j3',number:'A4',batchNumber:'1002',date:'2026-02-10',description:'Inköp',rows:[{account:'4010 Inköp av varor',debit:80,credit:0},{account:'1930 Företagskonto',debit:0,credit:80}]}
  ]};
}

test('saldobalans skiljer ingående saldo från periodens debet och kredit', () => {
  const rows = Reports.trialBalance(store(), {from:'2026-02-01',to:'2026-02-28'});
  const bank = rows.find(row => row.code === '1930');
  assert.deepEqual({opening:bank.opening,debit:bank.debit,credit:bank.credit,closing:bank.closing},{opening:1000,debit:125,credit:80,closing:1045});
  const sales = rows.find(row => row.code === '3051');
  assert.equal(sales.closing,-100);
});

test('huvudbok visar löpande saldo med korrekt ingående saldo', () => {
  const ledger = Reports.generalLedger(store(),'1930',{from:'2026-02-01',to:'2026-02-28'});
  assert.equal(ledger.opening,1000);
  assert.equal(ledger.rows.length,2);
  assert.deepEqual(ledger.rows.map(row => row.balance),[1125,1045]);
  assert.equal(ledger.closing,1045);
});

test('verifikationslista summerar debet och kredit per verifikation', () => {
  const rows = Reports.journalList(store(),{from:'2026-02-01',to:'2026-02-28'});
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row => [row.number,row.debit,row.credit]),[['A2',125,125],['A4',80,80]]);
});

test('periodkontroll hittar nummerserieglapp men godkänner balanserad period', () => {
  const control = Reports.periodControl(store(),{from:'2026-01-01',to:'2026-12-31'});
  assert.equal(control.ok,true);
  assert.deepEqual(control.sequenceGaps,['A3']);
  assert.equal(control.debit,1205);
  assert.equal(control.credit,1205);
});

test('periodkontroll flaggar obalanserad verifikation och saknad beskrivning', () => {
  const data = store();
  data.journal[1].rows[0].debit = 124;
  data.journal[1].description = '';
  const control = Reports.periodControl(data);
  assert.equal(control.ok,false);
  assert.deepEqual(control.unbalanced,['A2']);
  assert.deepEqual(control.missingDescription,['A2']);
});
