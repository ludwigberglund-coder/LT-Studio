'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const migrationPath=path.resolve(__dirname,'..','supabase','migrations','20260926_001_shared_uat_foundation.sql');

test('Supabase UAT migration keeps critical tenant and accounting fields',()=>{
  const sql=fs.readFileSync(migrationPath,'utf8');

  for(const table of [
    'customers','suppliers','customer_invoices','supplier_invoices',
    'accounting_entries','documents','audit_events'
  ]){
    const start=sql.indexOf(`create table if not exists public.${table}`);
    assert.notEqual(start,-1,`missing table ${table}`);
    const end=sql.indexOf('\n);',start);
    assert.notEqual(end,-1,`unterminated table ${table}`);
    const block=sql.slice(start,end);
    assert.match(block,/company_id text/i,`${table} must remain tenant-scoped`);
  }

  assert.match(sql,/id text primary key/i);
  assert.doesNotMatch(sql,/id uuid primary key/i);
  assert.doesNotMatch(sql,/entry_id uuid/i);
  assert.match(sql,/role text not null default 'admin' check \(role in \('admin','accountant','approver','readonly'\)\)/i);
  assert.match(sql,/archived_at timestamptz/i);
  assert.match(sql,/ocr text/i);
  assert.match(sql,/payment_method text/i);
  assert.match(sql,/payment_account text/i);
  assert.match(sql,/invoice_account text not null default '1510'/i);
  assert.match(sql,/batch_number text/i);
  assert.match(sql,/journal_number text/i);
  assert.match(sql,/pdf_sha256 text/i);
  assert.match(sql,/bankgiro text/i);
  assert.match(sql,/plusgiro text/i);
  assert.match(sql,/default_cost_account text/i);
  assert.match(sql,/vat_ore bigint/i);
  assert.match(sql,/coding_json jsonb/i);
  assert.match(sql,/open_amount_ore bigint/i);
  assert.match(sql,/unique \(company_id, supplier_id, supplier_invoice_number\)/i);

  assert.match(sql,/unique \(company_id, series, fiscal_year, sequence\)/i);
  assert.match(sql,/unique \(company_id, source_type, source_id\)/i);
  assert.match(sql,/debit_ore bigint/i);
  assert.match(sql,/credit_ore bigint/i);

  for(const table of [
    'companies','app_users','company_memberships','customers','suppliers',
    'customer_invoices','supplier_invoices','accounting_entries',
    'accounting_entry_lines','documents','audit_events'
  ]){
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
      `RLS must stay enabled for ${table}`
    );
  }

  assert.doesNotMatch(sql,/create\s+policy\s+.*using\s*\(\s*true\s*\)/i);
});

test('Supabase migration does not commit secrets or live customer values',()=>{
  const sql=fs.readFileSync(migrationPath,'utf8');
  assert.doesNotMatch(sql,/service_role|eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(sql,/insert\s+into\s+public\.(companies|app_users|customers|suppliers)/i);
});
