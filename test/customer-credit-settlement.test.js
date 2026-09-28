const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('kundreskontran erbjuder manuell kvittning i LT Studio-gränssnittet',()=>{
  const app=read('apps/portal/app.js');
  const css=read('apps/portal/styles.css');
  assert.match(app,/Kvitta kreditfaktura/);
  assert.match(app,/function settlementModal\(\)/);
  assert.match(app,/Debetfaktura · samma kund/);
  assert.match(app,/Skapa bunt för godkännande/);
  assert.match(app,/stage_customer_credit_settlement/);
  assert.match(app,/String\(credit\.customerId\|\|''\)!==String\(debit\.customerId\|\|''\)/);
  assert.match(app,/Kundreskontran ändras först när bunten godkänns/);
  assert.match(css,/\.settlement-modal/);
  assert.match(css,/\.settlement-grid/);
});

test('kvittningsbunten begränsas till samma kund och påverkar inte reskontran före godkännande',()=>{
  const sql=read('supabase/migrations/20260928_customer_credit_settlement_batches.sql');
  const stageStart=sql.indexOf('create or replace function public.stage_customer_credit_settlement');
  const triggerStart=sql.indexOf('create or replace function public.apply_customer_credit_settlement_batch');
  assert.ok(stageStart>=0&&triggerStart>stageStart);
  const stage=sql.slice(stageStart,triggerStart);
  const apply=sql.slice(triggerStart);
  assert.match(stage,/v_credit\.customer_id is distinct from v_debit\.customer_id/);
  assert.match(stage,/CUSTOMER_SETTLEMENT_DIFFERENT_CUSTOMER/);
  assert.match(stage,/v_credit\.total_ore>=0 or v_credit\.remaining_ore>=0/);
  assert.match(stage,/v_debit\.total_ore<=0 or v_debit\.remaining_ore<=0/);
  assert.match(stage,/public\.create_financial_batch/);
  assert.match(stage,/public\.save_financial_batch/);
  assert.match(stage,/public\.mark_financial_batch_ready/);
  assert.doesNotMatch(stage,/update public\.invoices/);
  assert.match(stage,/'1510'/);
  assert.match(stage,/status,'ready'/);

  assert.match(apply,/new\.status<>'approved'/);
  assert.match(apply,/CUSTOMER_SETTLEMENT_BATCH_INTEGRITY_ERROR/);
  assert.match(apply,/update public\.invoices i[\s\S]*remaining_ore=i\.remaining_ore\+v_settlement\.amount_ore/);
  assert.match(apply,/update public\.invoices i[\s\S]*remaining_ore=i\.remaining_ore-v_settlement\.amount_ore/);
  assert.match(apply,/insert into public\.invoice_transactions/);
  assert.match(apply,/'CUSTOMER_CREDIT_SETTLED'/);
});

test('pågående kvittningar reserverar belopp och godkänd kvittning kan ingå i saldohistorik',()=>{
  const sql=read('supabase/migrations/20260928_customer_credit_settlement_batches.sql');
  const domain=read('packages/receivables/customer-receivables.js');
  const portal=read('apps/portal/app.js');
  assert.match(sql,/v_pending_credit/);
  assert.match(sql,/v_pending_debit/);
  assert.match(sql,/CUSTOMER_SETTLEMENT_AMOUNT_EXCEEDS_AVAILABLE/);
  assert.match(sql,/CUSTOMER_SETTLEMENT_BALANCE_CHANGED/);
  assert.match(domain,/supportedSettlement = type === 'credit-settlement' && amountOre < 0/);
  assert.match(portal,/transactionType==='credit-settlement'\?'Kvittning'/);
});
