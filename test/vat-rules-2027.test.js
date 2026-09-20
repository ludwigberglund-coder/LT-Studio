'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Invoice=require('../packages/invoicing/invoice.js');

test('verifierade svenska momssatser gäller genom hela 2027',()=>{
  assert.equal(Invoice.vatTreatmentRate('se-food','2026-03-31'),12);
  assert.equal(Invoice.vatTreatmentRate('se-food','2026-04-01'),6);
  assert.equal(Invoice.vatTreatmentRate('se-food','2027-12-31'),6);
  assert.equal(Invoice.vatTreatmentRate('se-restaurant-12','2027-12-31'),12);
  assert.equal(Invoice.vatTreatmentRate('se-standard-25','2027-12-31'),25);
});

test('momsmotorn spärrar 2028 tills regelverket har verifierats på nytt',()=>{
  assert.throws(()=>Invoice.vatTreatmentRate('se-food','2028-01-01'),/endast verifierade till och med 2027-12-31/i);
  assert.throws(()=>Invoice.vatTreatmentRate('se-restaurant-12','2028-01-01'),/endast verifierade till och med 2027-12-31/i);
});
