'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const file=fs.readFileSync(path.join(root,'supabase/functions/ai-bookkeeping-pilot/index.ts'),'utf8');
const conf=fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
test('synthetic Edge Function is hard-disabled before reading tokens or parsing requests',()=>{
  assert.match(file,/const RELEASE_APPROVED = false;/);
  assert.match(file,/const DURABLE_IP_LIMITER_VERIFIED = false;/);
  const gate=file.indexOf('if(!RELEASE_APPROVED || !DURABLE_IP_LIMITER_VERIFIED)');
  const secrets=file.indexOf('Deno.env.get("CLOUDFLARE_AI_TOKEN")');
  const request=file.indexOf('const body=await readSmallJson(req)');
  const ipHash=file.indexOf('const ipHash=await clientIpHash(req)');
  assert.ok(gate>0&&secrets>gate&&request>gate&&ipHash>gate);
  assert.match(file,/AI_PILOT_NOT_RELEASED/);
});
test('no deployment config or public route is enabled by this preparatory PR',()=>{
  assert.doesNotMatch(conf,/\[functions\.ai-bookkeeping-pilot\]/);
  assert.doesNotMatch(file,/Deno\.env\.get\("AI_PILOT_RELEASE_APPROVED"\)/);
});
test('Cloudflare request requires auth, membership and complete server quota contract',()=>{
  assert.match(file,/runSyntheticPilot/);
  assert.match(file,/global:\{headers:\{Authorization:bearer\}\}/);
  assert.match(file,/createClient\(keys\.url,keys\.publishable/);
  assert.match(file,/admin\.rpc\("reserve_ai_pilot_request_server"/);
  assert.match(file,/p_session_id:params\.sessionId/);
  assert.match(file,/p_client_ip_hash:ipHash/);
  assert.match(file,/AI_PILOT_PRIVACY_APPROVED/);
  assert.match(file,/privacyApproved:/);
  assert.match(file,/AI_SYNTHETIC_PILOT_ENABLED/);
});
test('trusted-IP contract hashes a bounded platform value without storing raw IP',()=>{
  assert.match(file,/const TRUSTED_IP_HEADER = "x-real-ip"/);
  assert.match(file,/AI_PILOT_TRUSTED_IP_HEADER/);
  assert.match(file,/AI_PILOT_IP_HASH_SALT/);
  assert.match(file,/crypto\.subtle\.digest\("SHA-256",bytes\)/);
  assert.match(file,/salt\.length<32\|\|salt\.length>256/);
  assert.doesNotMatch(file,/req\.headers\.get\(["']x-forwarded-for/);
  assert.doesNotMatch(file,/req\.headers\.get\(["']cf-connecting-ip/);
});
test('Edge Function does not accept free prompt or call financial posting engines',()=>{
  assert.match(file,/readSmallJson/);
  assert.match(file,/manual-review/);
  assert.match(file,/posted:false/);
  assert.doesNotMatch(file,/\.from\(["']journal_entries["']\)/);
  assert.doesNotMatch(file,/\bpostEntry\s*\(/);
  assert.doesNotMatch(file,/\bstage_manual_customer_payment/);
});
test('secrets stay backend only with fixed API provider and safe origin',()=>{
  assert.match(file,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(file,/CLOUDFLARE_AI_TOKEN/);
  assert.match(file,/AI_PILOT_ALLOWED_ORIGIN/);
  assert.match(file,/Access-Control-Allow-Origin/);
  assert.doesNotMatch(file,/Access-Control-Allow-Origin":"\*"/);
  assert.match(file,/"Cache-Control"\s*:\s*"no-store"/);
});
