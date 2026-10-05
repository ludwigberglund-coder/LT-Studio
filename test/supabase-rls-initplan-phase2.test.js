'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(
  path.join(__dirname,'..','supabase','migrations','20261005170956_rls_advisor_performance_cleanup_phase2.sql'),
  'utf8'
);

test('phase 2 caches the shared AAL2 and personal-session request guard',()=>{
  assert.match(sql,/create or replace function lt_security\.request_has_aal2_personal_session\(\)/);
  assert.match(sql,/security invoker/);
  assert.match(sql,/coalesce\(\(select auth\.jwt\(\)->>'aal'\),'aal1'\)='aal2'/);
  assert.match(sql,/select lt_security\.session_within_personal_limit\(\)/);
  assert.match(sql,/grant execute on function lt_security\.request_has_aal2_personal_session\(\) to authenticated/);
  assert.match(sql,/hosted migration 20261005170956/);
});

test('phase 2 rewrites exactly the verified 47 request-guard policies',()=>{
  assert.match(sql,/RLS_INITPLAN_PHASE2_EXPECTED_47_POLICIES_CHANGED_GOT_/);
  assert.match(sql,/RLS_INITPLAN_PHASE2_EXPECTED_0_OLD_REQUEST_GUARDS_GOT_/);
  assert.match(sql,/alter policy %I on %I\.%I%s%s/);
});

test('manual customer payments cache auth uid without weakening membership scope',()=>{
  assert.match(sql,/alter policy customer_manual_payments_company_read/);
  assert.match(sql,/m\.company_id=customer_manual_payments\.company_id/);
  assert.match(sql,/m\.auth_user_id=\(select auth\.uid\(\)\)/);
});
