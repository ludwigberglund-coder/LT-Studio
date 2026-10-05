'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const invoices=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.js'),'utf8');

test('invoice recovery handles a stale request id safely',()=>{
  const start=invoices.indexOf('async function issueSupabaseInvoice');
  const end=invoices.indexOf('function proportionalCreditAllocate',start);
  const issuance=invoices.slice(start,end);
  assert.ok(issuance.includes('INVOICE_IDEMPOTENCY_CONFLICT'));
  assert.ok(issuance.includes('customer_invoice_number_reservations'));
  const issuedCheck=issuance.indexOf("reservation?.status==='issued'");
  const rotateId=issuance.indexOf('issueRequestId=crypto.randomUUID()',issuedCheck);
  assert.ok(issuedCheck>=0);
  assert.ok(rotateId>issuedCheck);
  assert.ok(issuance.includes('await refreshSupabaseCollections();await loadSupabaseInvoiceDetail(existingId);return;'));
  assert.ok(issuance.includes('if(privateDraftRecord)await saveSupabaseDraft();'));
});
