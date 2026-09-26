'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260926_portal_runtime_hardening.sql'),'utf8');

test('Supabase portal hardening keeps company settings least-privilege',()=>{
  assert.match(sql,/revoke all on table public\.company_invoice_settings from authenticated/i);
  assert.match(sql,/grant select, insert, update on table public\.company_invoice_settings to authenticated/i);
  assert.doesNotMatch(sql,/grant[^;]*(delete|truncate|trigger|references)[^;]*company_invoice_settings/i);
  assert.match(sql,/m\.role = 'admin'/i);
});

test('period unlock requests do not expose destructive table privileges',()=>{
  assert.match(sql,/revoke all on table public\.period_unlock_requests from authenticated/i);
  assert.match(sql,/grant select, insert, update on table public\.period_unlock_requests to authenticated/i);
  assert.doesNotMatch(sql,/grant[^;]*(delete|truncate|trigger|references)[^;]*period_unlock_requests/i);
});


test('automation review edits use Supabase RPC instead of the legacy API',()=>{
  const js=fs.readFileSync(path.join(root,'apps','portal','automation.js'),'utf8');
  assert.match(js,/LTSupabase\.rpc\('save_automation_proposal_review'/);
  assert.doesNotMatch(js,/isSupabase[^\n]+automation\/proposals\/\$\{encodeURIComponent\(id\)\}\/suggestion/);
});

test('automation review migration removes destructive browser privileges',()=>{
  const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260926_automation_review_rpc.sql'),'utf8');
  assert.match(migration,/create or replace function public\.save_automation_proposal_review/i);
  assert.match(migration,/m\.role in \('admin','accountant'\)/i);
  assert.match(migration,/revoke delete, truncate, trigger, references\s+on table public\.automation_proposals\s+from authenticated/i);
});
