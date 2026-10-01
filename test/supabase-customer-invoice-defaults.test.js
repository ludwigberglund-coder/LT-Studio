'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260930_customer_invoice_defaults.sql'),'utf8');
const customers=fs.readFileSync(path.join(root,'apps','portal','customers.js'),'utf8');
const invoices=fs.readFileSync(path.join(root,'apps','portal','invoices.js'),'utf8');

test('Supabase customer invoice defaults are constrained and versioned',()=>{
  assert.match(migration,/payment_terms_days integer not null default 30/);
  assert.match(migration,/payment_terms_days between 0 and 365/);
  assert.match(migration,/our_reference text/);
  assert.match(migration,/your_reference text/);
  assert.match(migration,/char_length\(our_reference\) <= 120/);
  assert.match(migration,/char_length\(your_reference\) <= 120/);
});

test('customer register persists invoice defaults to Supabase',()=>{
  assert.match(customers,/name="paymentTermsDays"/);
  assert.match(customers,/field\('Vår referens','ourReference'\)/);
  assert.match(customers,/field\('Er referens','yourReference'\)/);
  assert.match(customers,/payment_terms_days:payload\.paymentTermsDays/);
  assert.match(customers,/our_reference:payload\.ourReference\|\|null/);
  assert.match(customers,/your_reference:payload\.yourReference\|\|null/);
  assert.match(customers,/ourReference'\|\|key==='yourReference'\?120:254/);
});

test('new invoice reuses the selected customer defaults',()=>{
  assert.match(invoices,/paymentTermsDays:Number\(r\.payment_terms_days\?\?30\)/);
  assert.match(invoices,/ourReference:r\.our_reference\|\|''/);
  assert.match(invoices,/yourReference:r\.your_reference\|\|''/);
  assert.match(invoices,/draft\.paymentTermsDays=Number\(c\.paymentTermsDays\?\?30\)/);
  assert.match(invoices,/draft\.ourReference=String\(c\.ourReference\|\|''\)/);
  assert.match(invoices,/draft\.yourReference=String\(c\.yourReference\|\|''\)/);
});
