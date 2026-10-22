'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { supplierJourney } = require('../apps/portal/supplier-journey.js');

test('unknown data never claims payment', () => {
  for (const value of [null, undefined, {}, {invoice:{approved:true}}, {payment:{bankSubmitted:true}}, {payment:{reconciled:true}}]) {
    assert.notEqual(supplierJourney(value).stage, 'paid');
  }
});
test('approval cannot imply bank execution', () => {
  assert.equal(supplierJourney({invoice:{approved:true,liabilityPosted:true}}).stage,'ready-to-plan');
});
test('payment plan is not payment execution', () => {
  assert.equal(supplierJourney({invoice:{approved:true},payment:{planned:true}}).stage,'planned');
});
test('authorized and submitted are distinct, neither is paid', () => {
  assert.equal(supplierJourney({payment:{authorized:true}}).stage,'authorized');
  assert.equal(supplierJourney({payment:{bankSubmitted:true}}).stage,'bank-pending');
});
test('bank acceptance without reconciliation cannot imply paid', () => {
  assert.notEqual(supplierJourney({payment:{bankSubmitted:true,bankSettlementVerified:true}}).stage,'paid');
});
test('full verified settlement plus reconciliation alone allows paid label', () => {
  assert.equal(supplierJourney({payment:{reconciled:true,bankSettlementVerified:true,invoiceFullySettled:true,bankTransactionId:'BANK-001'}}).stage,'paid');
  for(const field of ['reconciled','bankSettlementVerified','invoiceFullySettled','bankTransactionId']){
    const p={reconciled:true,bankSettlementVerified:true,invoiceFullySettled:true,bankTransactionId:'BANK-001'};
    delete p[field];
    assert.notEqual(supplierJourney({payment:p}).stage,'paid');
  }
});
test('failed and returned payments never imply success', () => {
  assert.equal(supplierJourney({payment:{failed:true,planned:true}}).stage,'payment-failed');
  assert.equal(supplierJourney({payment:{returned:true,authorized:true}}).stage,'payment-failed');
});
