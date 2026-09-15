'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Store = require('../lib/store.js');

function state() {
  return {
    business: {name: 'Test AB'},
    settings: {lockedPeriods: []},
    invoices: [],
    supplierInvoices: [],
    bankTransactions: [],
    journal: [{id: 'j1', number: 'A1', batchNumber: '1000', date: '2026-09-15', description: 'Testverifikation', source: 'Test', rows: [{account: '1930 Företagskonto', debit: 100, credit: 0}, {account: '3000 Försäljning', debit: 0, credit: 100}]}],
    activity: [],
    auditLog: []
  };
}

test('integritetskontrollen stoppar obalanserade verifikationer och dubbletter', () => {
  const store = state();
  store.journal[0].rows[1].credit = 99;
  store.journal.push({...structuredClone(store.journal[0]), id: 'j2'});
  const report = Store.validateStore(store);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /balanserar inte/.test(error)));
  assert.ok(report.errors.some(error => /Dubblett av verifikationsnummer/.test(error)));
  assert.throws(() => Store.assertStoreIntegrity(store), error => error.code === 'STORE_INTEGRITY_ERROR');
});

test('atomisk lagring skapar backup och återläser den om primärfilen skadas', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollands-store-test-'));
  const file = path.join(directory, 'store.json');
  const first = state();
  Store.atomicWriteJson(file, first);
  const second = structuredClone(first);
  second.business.name = 'Ny version AB';
  Store.atomicWriteJson(file, second);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).business.name, 'Ny version AB');
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).business.name, 'Test AB');
  fs.writeFileSync(file, '{trasig json');
  const recovered = Store.loadJsonWithBackup(file);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.data.business.name, 'Test AB');
});



test('datumkontrollen avvisar kalenderdatum som JavaScript annars normaliserar', () => {
  const store = state();
  store.journal[0].date = '2026-02-31';
  const report = Store.validateStore(store);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /ogiltigt datum/.test(error)));
});

test('manuell säkerhetskopia bevarar även en skadad primärfil för forensik', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollands-backup-test-'));
  const file = path.join(directory, 'store.json');
  fs.writeFileSync(file, '{skadad json', {mode: 0o600});
  const result = Store.createBackup(file, path.join(directory, 'manual'));
  assert.equal(fs.readFileSync(result.target, 'utf8'), '{skadad json');
  assert.equal(result.sha256, Store.sha256(Buffer.from('{skadad json')));
});

test('revisionskedjan upptäcker ändring och repareras inte tyst', () => {
  const store = state();
  Store.appendAudit(store, {id: `audit_${crypto.randomUUID()}`, at: '2026-09-15T08:00:00.000Z', actor: 'Test', action: 'SKAPAD', details: 'Första'});
  Store.appendAudit(store, {id: `audit_${crypto.randomUUID()}`, at: '2026-09-15T08:01:00.000Z', actor: 'Test', action: 'ÄNDRAD', details: 'Andra'});
  assert.equal(Store.validateStore(store).ok, true);
  const originalHash = store.auditLog[0].hash;
  store.auditLog[1].details = 'Manipulerad';
  assert.equal(Store.ensureAuditChain(store), false);
  assert.equal(store.auditLog[0].hash, originalHash);
  assert.ok(Store.validateStore(store).errors.some(error => /Revisionskedjan är bruten/.test(error)));
});

test('demoidentifiering och rensning berör bara kända demo-id:n', () => {
  const store = state();
  store.invoices.push({id: 'test_i01', number: '310001'}, {id: 'real_invoice', number: '100001'});
  store.bankTransactions.push({id: 'bank_001'}, {id: 'real_bank'});
  assert.equal(Store.detectDemoRecords(store).length, 2);
  const removed = Store.stripKnownDemoData(store);
  assert.equal(removed.invoices, 1);
  assert.equal(removed.bankTransactions, 1);
  assert.deepEqual(store.invoices.map(item => item.id), ['real_invoice']);
  assert.deepEqual(store.bankTransactions.map(item => item.id), ['real_bank']);
});
