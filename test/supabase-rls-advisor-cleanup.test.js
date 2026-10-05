'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20261005135109_rls_advisor_performance_cleanup.sql'),
  'utf8'
);

test('RLS session helper caches auth identity per query',()=>{
  assert.match(sql,/v_uid uuid := \(select auth\.uid\(\)\)/);
  assert.match(sql,/v_session_id := nullif\(\(select auth\.jwt\(\)->>'session_id'\)/);
  assert.match(sql,/create or replace function lt_security\.setting_is_one/);
  assert.match(sql,/select \(select current_setting\(p_setting, true\)\) = '1'/);
  assert.match(sql,/revoke all on function lt_security\.setting_is_one\(text\) from public, anon/);
  assert.match(sql,/grant execute on function lt_security\.setting_is_one\(text\) to authenticated/);
});

test('company revenue account policies no longer use a FOR ALL write policy',()=>{
  assert.match(sql,/drop policy if exists "accountants write company revenue accounts"/);
  assert.match(sql,/create policy "members read company revenue accounts"/);
  assert.match(sql,/create policy "accountants insert company revenue accounts"/);
  assert.match(sql,/create policy "accountants update company revenue accounts"/);
  assert.match(sql,/create policy "accountants delete company revenue accounts"/);
  assert.doesNotMatch(sql,/create policy "accountants write company revenue accounts"[\s\S]*for all/i);
});

test('website CMS policies no longer use a FOR ALL write policy',()=>{
  assert.match(sql,/drop policy if exists "controlled website cms writes"/);
  assert.match(sql,/create policy "members read website cms state"/);
  assert.match(sql,/create policy "controlled website cms inserts"/);
  assert.match(sql,/create policy "controlled website cms updates"/);
  assert.match(sql,/create policy "controlled website cms deletes"/);
  assert.doesNotMatch(sql,/create policy "controlled website cms writes"[\s\S]*for all/i);
});

test('phase 1 migration documents the exact hosted version',()=>{
  assert.match(sql,/hosted migration 20261005135109/);
  assert.match(sql,/setting_is_one\('app\.revenue_account_write'\)/);
  assert.match(sql,/setting_is_one\('app\.website_cms_write'\)/);
});
