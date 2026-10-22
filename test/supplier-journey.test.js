'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { supplierJourney, fromInvoice, summarize } = require('../apps/portal/supplier-journey.js');
const settled = () => ({ reconciled: true, bankSettlementVerified: true, invoiceFullySettled: true, bankTransactionId: 'SYNTHETIC-BANK-001' });

test('unknown or malformed snapshots never claim payment', () => {
  for (const value of [null, undefined, [], '', 1, {}, { invoice: [] }, { payment: null }, { payment: 'paid' }, { invoice: { approved: 'true' } }]) {
    assert.equal(supplierJourney(value).stage, 'needs-review');
  }
});
test('invoice approval, posting, planning, authorization and submission remain distinct', () => {
  const cases = [
    [{ invoice: { readyForApproval: true } }, 'ready'],
    [{ invoice: { approved: true } }, 'approved'],
    [{ invoice: { approved: true, liabilityPosted: true } }, 'ready-to-plan'],
    [{ payment: { planned: true } }, 'planned'],
    [{ payment: { authorized: true } }, 'authorized'],
    [{ payment: { bankSubmitted: true } }, 'bank-pending']
  ];
  for (const [snapshot, expected] of cases) assert.equal(supplierJourney(snapshot).stage, expected);
});
test('settlement without every required evidence field never implies paid', () => {
  assert.equal(supplierJourney({ payment: settled() }).stage, 'paid');
  for (const field of Object.keys(settled())) {
    const payment = settled(); delete payment[field];
    assert.notEqual(supplierJourney({ payment }).stage, 'paid', field);
  }
  for (const bankTransactionId of ['', ' ', null, 1]) {
    assert.notEqual(supplierJourney({ payment: { ...settled(), bankTransactionId } }).stage, 'paid');
  }
});
test('returned or failed payments override stale successful settlement evidence', () => {
  for (const key of ['returned', 'failed']) {
    assert.equal(supplierJourney({ payment: { ...settled(), [key]: true } }).stage, 'payment-failed');
  }
});
test('unknown outcomes, cancellation and review flags cannot display settled', () => {
  assert.equal(supplierJourney({ payment: { ...settled(), resultUnknown: true } }).stage, 'payment-unknown');
  assert.equal(supplierJourney({ payment: { ...settled(), cancelled: true } }).stage, 'cancelled');
  assert.equal(supplierJourney({ invoice: { reviewRequired: true }, payment: settled() }).stage, 'needs-review');
});
test('truthy strings and numbers cannot provide evidence', () => {
  for (const key of ['reconciled', 'bankSettlementVerified', 'invoiceFullySettled']) {
    for (const value of ['true', 1, null, []]) {
      assert.equal(supplierJourney({ payment: { ...settled(), [key]: value } }).stage, 'needs-review');
    }
  }
});
test('a raw paid invoice remains merely recorded, never independently bank verified', () => {
  const current = fromInvoice({ status: 'paid', bankSettlementVerified: true, reconciled: true,
    invoiceFullySettled: true, bankTransactionId: 'TYPED-REFERENCE' });
  assert.equal(current.stage, 'recorded-paid');
  assert.equal(current.group, 'history');
  assert.doesNotMatch(current.label, /avstämd/);
});
test('approved invoices without a posted liability remain in needs-help', () => {
  for (const item of [{}, { liabilityBatchId: 'pending-batch' }, { liabilityPosted: 'true' }]) {
    assert.equal(fromInvoice({ status: 'approved', ...item }).group, 'help');
  }
  for (const item of [{ liabilityPosted: true }, { liabilityAccountingEntryId: 'posted-entry' }]) {
    assert.equal(fromInvoice({ status: 'approved', ...item }).stage, 'ready-to-plan');
  }
});
test('every current invoice appears in exactly one task group, unknown states remain visible', () => {
  const rows = [
    { status: 'registered' }, { status: 'coding-review' }, { status: 'coded' },
    { status: 'approved' }, { status: 'approved', liabilityPosted: true },
    { status: 'payment-prepared' }, { status: 'paid' }, { status: 'cancelled' },
    { status: 'rejected' }, { status: 'new-unknown-status' }, null
  ];
  assert.deepEqual(summarize(rows), { approval: 1, payment: 2, help: 6, history: 2 });
  assert.equal(Object.values(summarize(rows)).reduce((a, b) => a + b, 0), rows.length);
});
test('summary and immutable source records are never mutated', () => {
  const rows = Object.freeze([Object.freeze({ status: 'coded' }), Object.freeze({ status: 'paid' })]);
  const before = JSON.stringify(rows), summary = summarize(rows);
  assert.equal(JSON.stringify(rows), before); assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(fromInvoice(rows[0])));
  assert.deepEqual(summarize(undefined), { approval: 0, payment: 0, help: 0, history: 0 });
});
