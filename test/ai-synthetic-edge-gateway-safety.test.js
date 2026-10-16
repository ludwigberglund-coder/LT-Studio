'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const edge=read('supabase/functions/ai-bookkeeping-pilot/index.ts');
const http=read('packages/automation/ai-synthetic-http.mjs');
const conf=read('supabase/config.toml');
const admission=read('supabase/migrations/20261016171526_ai_pilot_shared_admission.sql');

test('synthetic Edge Function is hard-disabled before handler work',()=>{
  assert.match(edge,/const RELEASE_APPROVED = false;/);
  assert.match(edge,/releaseApproved:\s*RELEASE_APPROVED/);
  assert.doesNotMatch(edge,/AI_PILOT_RELEASE_APPROVED/);
});

test('deployment policy is explicit while the code release remains locked',()=>{
  assert.match(conf,/\[functions\.ai-bookkeeping-pilot\]\s+verify_jwt = false/);
  assert.match(edge,/const RELEASE_APPROVED = false;/);
  assert.match(http,/releaseApproved=false/);
});

test('Cloudflare requests require Auth and both durable quota layers',()=>{
  assert.match(http,/runSyntheticPilot/);
  assert.match(http,/Authorization:bearer/);
  assert.match(http,/admin\.rpc\('admit_ai_pilot_request_server'\)/);
  assert.match(http,/admin\.rpc\('reserve_ai_pilot_request_server'/);
  assert.match(http,/p_session_id:params\.sessionId/);
  assert.match(http,/p_client_ip_hash:SHARED_BUCKET/);
  assert.match(http,/privacyApproved:true/);
});

test('aggregate admission cannot be bypassed with caller-selected IP headers',()=>{
  assert.match(http,/export const SHARED_BUCKET = '0'\.repeat\(64\)/);
  assert.match(admission,/for update/);
  assert.match(admission,/cardinality\(v_recent\)>=60/);
  assert.doesNotMatch(http,/headers\.get\(['"]x-real-ip|headers\.get\(['"]x-forwarded-for|headers\.get\(['"]cf-connecting-ip/);
});

test('Edge Function accepts no free prompt and calls no posting engine',()=>{
  assert.match(http,/readSmallJson/);
  assert.match(http,/manual-review/);
  assert.match(http,/posted:false/);
  assert.doesNotMatch(http,/journal_entries|postEntry\s*\(|stage_manual_customer_payment/);
});

test('secrets stay backend-only with fixed provider and origin',()=>{
  assert.match(http,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(http,/CLOUDFLARE_AI_TOKEN/);
  assert.match(http,/PILOT_ORIGIN/);
  assert.match(http,/Access-Control-Allow-Origin/);
  assert.doesNotMatch(http,/Access-Control-Allow-Origin['"]\s*:\s*['"]\*/);
  assert.match(http,/'Cache-Control':'no-store'/);
});
