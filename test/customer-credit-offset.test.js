'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase','migrations','20260926_customer_credit_offsets.sql'),'utf8');
const app=fs.readFileSync(path.join(root,'apps','portal','app.js'),'utf8');
const receivables=fs.readFileSync(path.join(root,'packages','receivables','customer-receivables.js'),'utf8');

test('credit offsets use an immutable company-scoped audit table',()=>{
  assert.match(sql,/create table if not exists public\.customer_credit_offsets/i);
  assert.match(sql,/primary key\(company_id,request_id\)/i);
  assert.match(sql,/credit_remaining_before_ore/i);
  assert.match(sql,/credit_remaining_after_ore\s*=\s*credit_remaining_before_ore\s*\+\s*amount_ore/i);
  assert.match(sql,/target_remaining_after_ore\s*=\s*target_remaining_before_ore\s*-\s*amount_ore/i);
  assert.match(sql,/alter table public\.customer_credit_offsets enable row level security/i);
  assert.match(sql,/grant select on table public\.customer_credit_offsets to authenticated/i);
  assert.doesNotMatch(sql,/grant[^;]*(insert|update|delete|truncate|trigger|references)[^;]*customer_credit_offsets[^;]*authenticated/i);
});

test('credit offset mutation stays behind a protected non-exposed security core',()=>{
  assert.match(sql,/create or replace function lt_security\.apply_customer_credit_offset/i);
  assert.match(sql,/language plpgsql\s+security definer/i);
  assert.match(sql,/coalesce\(\(select auth\.jwt\(\)->>'aal'\),'aal1'\)<>'aal2'/i);
  assert.match(sql,/lt_security\.session_within_personal_limit\(\)/i);
  assert.match(sql,/m\.role in \('admin','accountant'\)/i);
  assert.match(sql,/create or replace function public\.offset_customer_credit/i);
  assert.match(sql,/language sql\s+security invoker/i);
  assert.match(sql,/revoke all on function public\.offset_customer_credit\(text,text,text,text,date,bigint\) from public, anon/i);
});

test('credit offset validates customer, balances, period and idempotency',()=>{
  assert.match(sql,/CREDIT_OFFSET_IDEMPOTENCY_CONFLICT/);
  assert.match(sql,/for update/i);
  assert.match(sql,/CREDIT_OFFSET_CUSTOMER_MISMATCH/);
  assert.match(sql,/CREDIT_OFFSET_ORIGINAL_ALREADY_HANDLED/);
  assert.match(sql,/CREDIT_OFFSET_AMOUNT_EXCEEDS_AVAILABLE/);
  assert.match(sql,/PERIOD_LOCKED/);
  assert.match(sql,/CUSTOMER_CREDIT_ALREADY_REFUNDED/);
  assert.match(sql,/transaction_type[^\n]*'credit-offset'/i);
  assert.match(sql,/'credit-offset:'\|\|p_request_id/);
});

test('refund uses the live remaining credit after offsets',()=>{
  assert.match(sql,/v_refund_amount:=-v_credit_invoice\.remaining_ore/);
  assert.match(sql,/from public\.customer_credit_offsets o/i);
  assert.match(sql,/v_adjust\.refund_due_ore<>v_refund_amount\+v_offset_total/);
  assert.match(sql,/v_refund_amount,true,p_refund_account/i);
});

test('portal exposes offset only through Supabase and enriches the source-linked transaction',()=>{
  assert.match(app,/data-action="offset-credit"/);
  assert.match(app,/data-form="credit-offset"/);
  assert.match(app,/LTSupabase\.rpc\('offset_customer_credit'/);
  assert.match(app,/supabaseRows\('customer_credit_offsets'/);
  assert.match(app,/sourceType:offset\?'customer-credit-offset':''/);
  assert.match(app,/String\(candidate\.target_invoice_id\)===key/);
  assert.match(app,/Number\(tx\.amount_ore\|\|0\)===-Number\(candidate\.amount_ore\|\|0\)/);
  assert.match(app,/String\(tx\.posting_date\|\|''\)===String\(candidate\.offset_date\|\|''\)/);
  assert.match(app,/creditOffsetTargets\(invoice\)/);
});

test('interest history accepts only a verified source-linked credit offset',()=>{
  assert.match(receivables,/supportedCreditOffset/);
  assert.match(receivables,/sourceType === 'customer-credit-offset'/);
  assert.match(receivables,/bankReference === 'credit-offset:' \+ sourceId/);
  assert.match(receivables,/UNSUPPORTED_BALANCE_HISTORY/);
});
