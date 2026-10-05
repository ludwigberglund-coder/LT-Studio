'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20261005124500_rls_advisor_performance_cleanup.sql'),'utf8');

test('RLS helper functions use query-level scalar subqueries',()=>{
  assert.match(sql,/v_uid uuid := \(select auth\.uid\(\)\)/);
  assert.match(sql,/create or replace function lt_security\.setting_is_one/);
  assert.match(sql,/select \(select current_setting\(p_setting, true\)\) = '1'/);
  assert.match(sql,/RLS_INITPLAN_EXPECTED_14_POLICIES_CHANGED_GOT_/);
});

test('duplicate permissive SELECT policies are split without dropping write actions',()=>{
  assert.match(sql,/drop policy if exists "accountants write company revenue accounts"/);
  assert.match(sql,/create policy "accountants insert company revenue accounts"/);
  assert.match(sql,/create policy "accountants update company revenue accounts"/);
  assert.match(sql,/create policy "accountants delete company revenue accounts"/);
  assert.match(sql,/drop policy if exists "controlled website cms writes"/);
  assert.match(sql,/create policy "controlled website cms inserts"/);
  assert.match(sql,/create policy "controlled website cms updates"/);
  assert.match(sql,/create policy "controlled website cms deletes"/);
  assert.doesNotMatch(sql,/create policy "accountants write company revenue accounts"[\s\S]*for all/i);
  assert.doesNotMatch(sql,/create policy "controlled website cms writes"[\s\S]*for all/i);
});

test('request-local write guards use the cached setting helper',()=>{
  for(const setting of [
    'app.audit_event_write',
    'app.system_batch_stage',
    'app.financial_batch_approval',
    'app.invoice_comment_write',
    'app.invoice_reminder_write',
    'app.website_cms_write',
    'app.revenue_account_write'
  ]){
    assert.match(sql,new RegExp("setting_is_one\\('"+setting.replace(/\./g,'\\.')+"'\\)"));
  }
});
