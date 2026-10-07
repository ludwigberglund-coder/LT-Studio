'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('manuell kundinbetalning kan registreras som oplacerad direkt i fakturaväljaren',()=>{
  const payments=read('apps/portal/payments.js');
  assert.match(payments,/data-action="manual-payment-unplaced"/);
  assert.match(payments,/Registrera som oplacerad/);
  assert.match(payments,/id="manual-unplaced-payment-form"/);
  assert.match(payments,/placement:'unplaced'/);
  assert.match(payments,/Ingen faktura påverkas/);
});

test('oplacerad manuell inbetalning går genom MFA-skyddad Edge Function och server-only RPC',()=>{
  const edge=read('supabase/functions/manual-customer-payment/index.ts');
  const migration=read('supabase/migrations/20261007185000_manual_unplaced_customer_payments.sql');

  assert.match(edge,/claims\.aal!=="aal2"/);
  assert.match(edge,/placement==="unplaced"/);
  assert.match(edge,/stage_manual_unplaced_bank_payment_server/);
  assert.match(edge,/bankAccount!=="1930"/);

  assert.match(migration,/security definer/i);
  assert.match(migration,/set search_path=''/i);
  assert.match(migration,/auth\.sessions/);
  assert.match(migration,/m\.role in \('admin','accountant'\)/);
  assert.match(migration,/insert into public\.bank_payments/);
  assert.match(migration,/'unmatched'/);
  assert.match(migration,/MANUAL_UNPLACED_PAYMENT_CREATED/);
  assert.match(migration,/revoke all on function public\.stage_manual_unplaced_bank_payment_server[\s\S]*from public,anon,authenticated/);
  assert.match(migration,/grant execute on function public\.stage_manual_unplaced_bank_payment_server[\s\S]*to service_role/);
});

test('oplacerad manuell inbetalning har tydlig responsiv styling',()=>{
  const css=read('apps/portal/styles.css');
  assert.match(css,/\.manual-unplaced-choice/);
  assert.match(css,/#manual-unplaced-payment-form/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.manual-unplaced-choice/);
});
