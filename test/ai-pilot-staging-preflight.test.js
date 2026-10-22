'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('supabase/migrations/20261013071500_ai_pilot_atomic_quota.sql');
const sharedSql=read('supabase/migrations/20261016171526_ai_pilot_shared_admission.sql');
const edge=read('supabase/functions/ai-bookkeeping-pilot/index.ts');
const browser=read('apps/portal/ai-bookkeeping.js');
const config=read('supabase/config.toml');
const runbook=read('docs/AI-PILOT-STAGING-PREFLIGHT.md');

test('AI gateway and portal remain locked until explicit source changes',()=>{
  assert.match(edge,/const RELEASE_APPROVED = false;/);
  assert.match(edge,/createSyntheticHttpHandler/);
  assert.match(edge,/releaseApproved:\s*RELEASE_APPROVED/);
  assert.match(browser,/const AI_PILOT_RELEASED = false;/);
  assert.match(config,/\[functions\.ai-bookkeeping-pilot\]\s+verify_jwt = false/);
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
test('shared admission remains durable, service-only and disabled by runtime setting',()=>{
  assert.match(sharedSql,/ai_pilot_admission_state/);
  assert.match(sharedSql,/cardinality\(recent_admissions\) <= 60/);
  assert.match(sharedSql,/where s\.singleton and s\.enabled/);
  assert.match(sharedSql,/revoke all on public\.ai_pilot_admission_state from public,anon,authenticated/);
  assert.match(sharedSql,/grant execute on function public\.admit_ai_pilot_request_server\(\) to service_role/);
});
test('operator preflight is environment-specific, metadata-only and documents release state',()=>{
  assert.match(runbook,/rwnqkgbbbxjjfhwtepsi/);
  assert.match(runbook,/bwbhnotpuuhgghjpmflk/);
  assert.match(runbook,/to_regclass\('public\.ai_pilot_runtime_settings'\)/);
  assert.match(runbook,/to_regclass\('public\.ai_pilot_admission_state'\)/);
  assert.match(runbook,/to_regprocedure\('public\.reserve_ai_pilot_request_server/);
  assert.match(runbook,/to_regprocedure\('public\.admit_ai_pilot_request_server/);
  assert.match(runbook,/has_function_privilege/);
  assert.match(runbook,/has_table_privilege/);
  assert.match(runbook,/RELEASE_APPROVED=true/);
  assert.match(runbook,/AI_PILOT_RELEASED=true/);
  assert.match(runbook,/enabled=false/);
  assert.match(runbook,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(runbook,/CLOUDFLARE_AI_TOKEN/);
  assert.match(runbook,/Öppna, kopiera, återge eller skärmdumpa aldrig secret-värden/);
  assert.match(runbook,/Rollback/);
  assert.doesNotMatch(runbook,/\b(delete from|truncate table|drop table|insert into|update public\.)/i);
});

test('staging alias and both AI migrations are documented with staging-only release controls',()=>{
  const parity=read('docs/SUPABASE-PARITY.md');
  assert.match(runbook,/20261015071358_ai_pilot_atomic_quota/);
  assert.match(runbook,/20261013071500_ai_pilot_atomic_quota\.sql/);
  assert.match(runbook,/20261016171526_ai_pilot_shared_admission\.sql/);
  assert.match(runbook,/enabled=false/);
  assert.match(parity,/AI-kvot: separat staging-paritet 2026-10-15/);
  assert.match(parity,/20261015071358/);
  assert.match(parity,/UAT har inte fått migreringen/);
  const uatHistory=JSON.parse(read('supabase/migration-history-parity.json'));
  assert.equal(uatHistory.project_ref,'bwbhnotpuuhgghjpmflk');
  assert.equal(uatHistory.aliases.some(item=>item.live_version==='20261015071358'),false);
  assert.match(browser,/const AI_PILOT_RELEASED = false;/);
});
