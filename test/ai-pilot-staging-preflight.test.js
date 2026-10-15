'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('supabase/migrations/20261013071500_ai_pilot_atomic_quota.sql');
const edge=read('supabase/functions/ai-bookkeeping-pilot/index.ts');
const browser=read('apps/portal/ai-bookkeeping.js');
const config=read('supabase/config.toml');
const runbook=read('docs/AI-PILOT-STAGING-PREFLIGHT.md');

test('AI gateway and portal stay hard-locked until explicitly reviewed',()=>{
  assert.match(edge,/const RELEASE_APPROVED = false;/);
  assert.match(edge,/const DURABLE_IP_LIMITER_VERIFIED = false;/);
  assert.match(browser,/const AI_PILOT_RELEASED = false;/);
  assert.doesNotMatch(config,/\[functions\.ai-bookkeeping-pilot\]/);
});
test('atomic AI pilot migration remains disabled and browser-inaccessible',()=>{
  assert.match(sql,/enabled boolean not null default false/);
  assert.match(sql,/values\(true,false\)/);
  for(const table of ['ai_pilot_runtime_settings','ai_pilot_request_reservations']){
    assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security;'));
    assert.match(sql,new RegExp('revoke all on public\\.'+table+' from public,anon,authenticated;'));
  }
  assert.match(sql,/revoke all on function public\.reserve_ai_pilot_request_server\(text,uuid,uuid,text,text\)\s+from public,anon,authenticated;/);
  assert.match(sql,/grant execute on function public\.reserve_ai_pilot_request_server\(text,uuid,uuid,text,text\)\s+to service_role;/);
  assert.match(sql,/unique\(company_id,actor_uid,request_id\)/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/client_ip_hash/);
});
test('preflight uses metadata-only reads and requires staging before release',()=>{
  assert.match(runbook,/to_regclass\('public\.ai_pilot_runtime_settings'\)/);
  assert.match(runbook,/to_regprocedure\('public\.reserve_ai_pilot_request_server/);
  assert.match(runbook,/has_function_privilege/);
  assert.match(runbook,/has_table_privilege/);
  assert.match(runbook,/staging först/);
  assert.match(runbook,/enabled=false/);
  assert.doesNotMatch(runbook,/\b(delete from|truncate table|drop table|insert into|update public\.)/i);
});
