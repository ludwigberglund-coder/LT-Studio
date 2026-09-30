'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('customer invoice finalization auto-approves its balanced source batch',()=>{
  const sql=read('supabase/migrations/20260928095153_customer_invoice_auto_batch_approval.sql');
  assert.match(sql,/create or replace function public\.auto_approve_customer_invoice_batch\(\)/i);
  assert.match(sql,/after insert on public\.invoices/i);
  assert.match(sql,/new\.status='Väntar på bunt'/);
  assert.match(sql,/new\.total_ore>0/);
  assert.match(sql,/new\.total_ore<=0/);
  assert.match(sql,/v_batch\.control_state<>'balanced'/);
  assert.match(sql,/v_receivable<>new\.total_ore/);
  assert.match(sql,/insert into public\.journal_entries/i);
  assert.match(sql,/set remaining_ore=i\.total_ore,\s*status='Bokförd'/i);
  assert.match(sql,/event_type,entity_type,entity_id,details[\s\S]*FINANCIAL_BATCH_AUTO_APPROVED/i);
});

test('customer credit finalization stages and auto-approves its own F-series batch',()=>{
  const sql=read('supabase/migrations/20260928095153_customer_invoice_auto_batch_approval.sql');
  const start=sql.indexOf('create or replace function public.finalize_customer_credit');
  assert.ok(start>=0,'credit finalizer override missing');
  const credit=sql.slice(start);
  assert.match(credit,/kind,external_total_ore,transaction_count,total_debit_ore,total_credit_ore/);
  assert.match(credit,/'ready','source'/);
  assert.match(credit,/'customer-credit-note',v_credit_id,v_debit,'F','customer-credit-note'/);
  assert.match(credit,/status='Väntar på bunt'/);
  assert.match(credit,/insert into public\.journal_entries/i);
  assert.match(credit,/source_type,source_id,created_by[\s\S]*'customer-credit-note',v_credit_id,v_uid/i);
  assert.match(credit,/set status='approved',approved_by=v_uid,approved_at=now\(\)/i);
  assert.match(credit,/BATCH_AUTO_APPROVED/);
  assert.match(credit,/CREDIT_SOURCE_NOT_POSTED/);
});

test('auto approval remains transactional and rejects unsafe financial state',()=>{
  const sql=read('supabase/migrations/20260928095153_customer_invoice_auto_batch_approval.sql');
  for(const guard of [
    'AUTH_REQUIRED','ACCESS_DENIED','CUSTOMER_INVOICE_BATCH_NOT_READY','CUSTOMER_INVOICE_BATCH_INTEGRITY_ERROR',
    'BATCH_NOT_BALANCED','INVOICE_RECEIVABLE_MISMATCH','PERIOD_LOCKED','CUSTOMER_INVOICE_ALREADY_POSTED',
    'CREDIT_SOURCE_NOT_POSTED','CREDIT_SETTLEMENT_CHANGED','CREDIT_BATCH_ACTIVATION_CONFLICT'
  ])assert.match(sql,new RegExp(guard),guard+' guard missing');
  assert.match(sql,/perform set_config\('app\.controlled_financial_write','1',true\)/);
  assert.match(sql,/perform pg_advisory_xact_lock/);
});
