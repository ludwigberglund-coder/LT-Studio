'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const migration=()=>read('supabase/migrations/20260929_manual_customer_payments.sql');

test('manuell kundinbetalning lagras som väntande bunt utan att ändra fakturasaldo direkt',()=>{
  const sql=migration();
  const stage=sql.slice(sql.indexOf('create or replace function public.stage_manual_customer_payment'),sql.indexOf('create or replace function public.activate_customer_manual_payment_batch'));
  assert.match(sql,/create table if not exists public\.customer_manual_payments/i);
  assert.match(stage,/status='pending'|,'pending'/i);
  assert.match(stage,/insert into public\.financial_batches/i);
  assert.match(stage,/'ready','manual'/);
  assert.match(stage,/total_debit_ore,total_credit_ore/);
  assert.match(stage,/p_amount_ore,p_amount_ore/);
  assert.match(stage,/p_bank_account[\s\S]*v_invoice\.invoice_account/);
  assert.doesNotMatch(stage,/update public\.invoices/i);
  assert.doesNotMatch(stage,/insert into public\.journal_entries/i);
});

test('fullbetalning, delbetalning och överbetalning hanteras först atomärt vid buntgodkännande',()=>{
  const sql=migration();
  const activate=sql.slice(sql.indexOf('create or replace function public.activate_customer_manual_payment_batch'),sql.indexOf('create or replace function public.capture_customer_manual_payment_rejection'));
  assert.match(activate,/old\.status='ready' and new\.status='approved'/);
  assert.match(activate,/for update/i);
  assert.match(activate,/if v_invoice\.remaining_ore<v_payment\.amount_ore then raise exception 'PAYMENT_EXCEEDS_CURRENT_BALANCE'/);
  assert.match(activate,/v_new_remaining:=v_invoice\.remaining_ore-v_payment\.amount_ore/);
  assert.match(activate,/status=case when v_new_remaining=0 then 'Betald' else 'Delbetald' end/);
  assert.match(activate,/insert into public\.invoice_transactions/i);
  assert.match(activate,/-v_payment\.amount_ore/);
  assert.match(activate,/CUSTOMER_MANUAL_PAYMENT_APPROVED/);
  assert.match(sql,/PAYMENT_EXCEEDS_AVAILABLE_BALANCE/);
  assert.match(sql,/p_amount_ore is null or p_amount_ore<=0/);
});

test('idempotens, company isolation och revisionsspar finns serverside',()=>{
  const sql=migration();
  assert.match(sql,/unique\(company_id,request_id\)/i);
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\(p_company_id\|\|':manual-payment:'/);
  assert.match(sql,/m\.company_id=p_company_id[\s\S]*m\.auth_user_id=v_uid/);
  assert.match(sql,/where i\.company_id=p_company_id and i\.id=p_invoice_id/);
  assert.match(sql,/foreign key\(company_id,invoice_id\)/);
  assert.match(sql,/foreign key\(company_id,customer_id\)/);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/CUSTOMER_MANUAL_PAYMENT_STAGED/);
  assert.match(sql,/CUSTOMER_MANUAL_PAYMENT_APPROVED/);
  assert.match(sql,/CUSTOMER_MANUAL_PAYMENT_REJECTED/);
  assert.match(sql,/approved_by=v_actor,approved_at=now\(\)/);
  assert.match(sql,/rejected_by=v_actor,rejected_at=now\(\)/);
});

test('avvisad bunt påverkar inte huvudbok eller fakturasaldo och betalningsbunten kan inte redigeras',()=>{
  const sql=migration();
  const activate=sql.slice(sql.indexOf('create or replace function public.activate_customer_manual_payment_batch'),sql.indexOf('create or replace function public.capture_customer_manual_payment_rejection'));
  const reject=activate.slice(activate.indexOf("old.status='ready' and new.status='rejected'"));
  assert.match(reject,/set status='rejected'/);
  assert.doesNotMatch(reject,/update public\.invoices/);
  assert.doesNotMatch(reject,/insert into public\.journal_entries/);
  assert.match(sql,/MANUAL_PAYMENT_BATCH_LOCKED/);
  assert.match(sql,/protect_customer_manual_payment_batch_transactions/);
  assert.match(sql,/protect_customer_manual_payment_batch_lines/);
  assert.match(sql,/protect_customer_manual_payment_batch_header/);
});

test('Kundreskontra och Betalningar har samma sakra manuella betalningsflode',()=>{
  const receivables=read('apps/portal/app.js');
  const payments=read('apps/portal/payments.js');
  const client=read('apps/portal/supabase-client.js');
  const styles=read('apps/portal/styles.css');
  assert.match(receivables,/Registrera inbetalning/);
  assert.match(receivables,/stage_manual_customer_payment/);
  assert.match(receivables,/customer_manual_payments/);
  assert.match(receivables,/Väntar på godkännande/);
  assert.match(receivables,/paymentAccountOptions/);
  assert.match(payments,/Registrera manuell inbetalning/);
  assert.match(payments,/Fakturanummer, kund eller kundnummer/);
  assert.match(payments,/stage_manual_customer_payment/);
  assert.match(payments,/customer_manual_payments/);
  assert.match(client,/'receivables\.html':\[[^\]]*'customer_manual_payments'/);
  assert.match(client,/'payments\.html':\[[^\]]*'customer_manual_payments'/);
  assert.match(styles,/html\[data-lt-theme="dark"\] \.manual-payment-summary/);
  assert.match(styles,/html\[data-lt-theme="light"\] \.manual-payment-summary/);
});

test('betalningsdialogens submit kan inte fangas av modalbakgrunden och dialogen ar rymligare',()=>{
  const receivables=read('apps/portal/app.js');
  const payments=read('apps/portal/payments.js');
  const styles=read('apps/portal/styles.css');
  assert.match(payments,/data-manual-payment-backdrop/);
  assert.doesNotMatch(payments,/modal-backdrop" data-action="manual-payment-close"/);
  assert.match(payments,/event\.target\.matches\?\.\('\[data-manual-payment-backdrop\]'\)/);
  assert.match(payments,/Registrera & skapa bunt/);
  assert.match(receivables,/data-manual-payment-backdrop/);
  assert.doesNotMatch(receivables,/modal-backdrop" data-action="close-modal"><section class="modal manual-payment-modal/);
  assert.match(receivables,/event\.target\.matches\?\.\('\[data-manual-payment-backdrop\]'\)/);
  assert.match(receivables,/Registrera & skapa bunt/);
  assert.match(styles,/\.manual-payment-picker-modal\{width:min\(1180px/);
  assert.match(styles,/\.manual-payment-picker-modal\{[^}]*height:min\(820px/);
  assert.match(styles,/\.manual-payment-picker-modal \.manual-invoice-results\{[^}]*min-height:390px/);
  assert.match(styles,/\.manual-payment-picker-modal \.manual-invoice-results\{[^}]*position:relative;[^}]*top:auto/);
  assert.match(styles,/\.manual-payment-form-modal\{width:min\(1080px/);
  assert.match(styles,/form\[data-form="manual-payment"\]\{display:grid;grid-template-columns:repeat\(2/);
});

test('front-endfilerna ar giltig JavaScript-syntax',()=>{
  for(const file of ['apps/portal/app.js','apps/portal/payments.js','apps/portal/supabase-client.js']){
    assert.doesNotThrow(()=>new vm.Script(read(file),{filename:file}),file+' har syntaxfel');
  }
});
