'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const invoices=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.js'),'utf8');

test('Supabase invoice issuance recovers safely from stale idempotency request ids',()=>{
  assert.match(invoices,/INVOICE_IDEMPOTENCY_CONFLICT/i);
  assert.match(invoices,/customer_invoice_number_reservations/);
  assert.match(invoices,/reservation\?\.status==='issued'/);
  assert.match(invoices,/await refreshSupabaseCollections\(\);await loadSupabaseInvoiceDetail\(existingId\);return;/);
  assert.match(invoices,/issueRequestId=crypto\.randomUUID\(\)/);
  assert.ok(
    invoices.indexOf("reservation?.status==='issued'")<
    invoices.indexOf('issueRequestId=crypto.randomUUID()'),
    'En redan utfärdad reservation måste återanvändas innan ett nytt request-id skapas.'
  );
  assert.match(invoices,/if\(privateDraftRecord\)await saveSupabaseDraft\(\)/);
});
