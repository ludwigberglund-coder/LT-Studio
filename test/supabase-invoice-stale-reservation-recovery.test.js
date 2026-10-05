'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(
  path.join(root,'supabase','migrations','20261005174500_recover_stale_invoice_draft_reservations.sql'),
  'utf8'
);
const invoices=fs.readFileSync(path.join(root,'apps','portal','invoices.js'),'utf8');

test('stale invoice draft reservation recovery is versioned and fail-closed',()=>{
  assert.match(migration,/r\.status='reserved'/);
  assert.match(migration,/r\.purpose='invoice'/);
  assert.match(migration,/d\.updated_at>r\.updated_at/);
  assert.match(migration,/r\.created_at<now\(\)-interval '1 day'/);
  assert.match(migration,/STALE_INVOICE_RESERVATION_RECOVERY_SCOPE_TOO_LARGE/);
  assert.match(migration,/set request_id=s\.new_request_id/);
  assert.match(migration,/set status='cancelled'/);
  assert.doesNotMatch(migration,/delete\s+from\s+public\.customer_invoice_number_reservations/i);
});

test('runtime keeps automatic recovery for future idempotency conflicts',()=>{
  const start=invoices.indexOf('async function issueSupabaseInvoice');
  const end=invoices.indexOf('function proportionalCreditAllocate',start);
  const issuance=invoices.slice(start,end);
  assert.ok(issuance.includes('INVOICE_IDEMPOTENCY_CONFLICT'));
  assert.ok(issuance.includes("reservation?.status==='issued'"));
  assert.ok(issuance.includes('issueRequestId=crypto.randomUUID()'));
  assert.ok(issuance.includes('if(privateDraftRecord)await saveSupabaseDraft();'));
});
