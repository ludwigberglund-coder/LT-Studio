'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const edge=fs.readFileSync(path.join(root,'supabase/functions/ai-bookkeeping-pilot/index.ts'),'utf8');
const config=fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
const load=()=>import('../packages/automation/ai-finance-process-contract.mjs');

test('existing Edge route stays hard-disabled and unconfigured, even with future secrets',()=>{
  assert.match(edge,/const RELEASE_APPROVED = false;/);
  assert.match(edge,/const DURABLE_IP_LIMITER_VERIFIED = false;/);
  assert.doesNotMatch(config,/\[functions\.ai-bookkeeping-pilot\]/);
  assert.doesNotMatch(config,/\[functions\.ai-finance-pilot\]/);
  const gate=edge.indexOf('if(!RELEASE_APPROVED || !DURABLE_IP_LIMITER_VERIFIED)');
  for(const statement of ['const body=await readSmallJson(req)','const ipHash=await clientIpHash(req)',
    'Deno.env.get("CLOUDFLARE_AI_TOKEN")','const isFinanceRequest=']){
    const pos=edge.indexOf(statement);
    assert.ok(pos>gate,statement+' must remain after the disabled gate');
  }
  assert.match(edge,/AI_PILOT_NOT_RELEASED/);
});

test('the SAME Edge function dispatches ten synthetic finance types or three legacy scenarios',async()=>{
  const {SUPPORTED_PURPOSES}=await load();
  assert.equal(SUPPORTED_PURPOSES.length,10);
  assert.match(edge,/runSyntheticFinanceProcess/);
  assert.match(edge,/createFinanceCloudflareProvider/);
  assert.match(edge,/runSyntheticPilot/);
  assert.match(edge,/cloudflareProvider/);
  assert.match(edge,/Object\.hasOwn\(body,"purpose"\)/);
  assert.match(edge,/const isFinanceRequest=body!==null&&typeof body==="object"&&/);
  assert.match(edge,/if\(isFinanceRequest\)\{/);
  assert.ok(edge.indexOf('if(isFinanceRequest){')<edge.indexOf('const provider=cloudflareProvider('));
  assert.ok(edge.indexOf('return respond(200,{')<edge.indexOf('const provider=cloudflareProvider('));
  assert.doesNotMatch(edge,/if\s*\(\s*req\.url\.includes/);
  assert.doesNotMatch(edge,/req\.headers\.get\(["']x-finance-process/);
});

test('new flow shares the old trusted auth, quota reservation and IP protections',()=>{
  assert.equal((edge.match(/const body=await readSmallJson\(req\);/g)||[]).length,1);
  assert.equal((edge.match(/const ipHash=await clientIpHash\(req\);/g)||[]).length,1);
  assert.equal((edge.match(/const userClient=createClient\(/g)||[]).length,1);
  assert.equal((edge.match(/const reserveBudget=async\(/g)||[]).length,1);
  assert.match(edge,/global:\{headers:\{Authorization:bearer\}\}/);
  assert.match(edge,/admin\.rpc\("reserve_ai_pilot_request_server"/);
  for(const field of ['p_company_id','p_actor_uid','p_session_id','p_request_id','p_client_ip_hash']){
    assert.ok(edge.includes(field),field);
  }
  assert.match(edge,/AI_PILOT_TRUSTED_IP_HEADER/);
  assert.match(edge,/AI_PILOT_IP_HASH_SALT/);
  assert.match(edge,/AI_PILOT_PRIVACY_APPROVED/);
  assert.match(edge,/AI_SYNTHETIC_PILOT_ENABLED/);
  assert.match(edge,/privacyApproved:Deno\.env\.get\("AI_PILOT_PRIVACY_APPROVED"\)==="true"/);
});

test('finance output exposes only synthetic, human-reviewed advice and no posting fields',()=>{
  const start=edge.indexOf('const proposal=await runSyntheticFinanceProcess(');
  const finish=edge.indexOf('const provider=cloudflareProvider(',start);
  assert.ok(start>0&&finish>start);
  const financeResponse=edge.slice(start,finish);
  assert.match(financeResponse,/status:"manual-review",posted:false,synthetic:true/);
  assert.match(financeResponse,/requiresHumanApproval:true,advice:proposal\.advice/);
  assert.match(financeResponse,/companyId:proposal\.companyId,purpose:proposal\.purpose/);
  assert.doesNotMatch(financeResponse,/\.rpc\(|\.from\(|\.insert\(|\.update\(|journal_entries|sendPayment|executePayment/);
  assert.doesNotMatch(financeResponse,/documentText|userPrompt|rawDocument|fileBase64/);
});

test('malformed purpose requests are categorized as invalid without leaking model details',()=>{
  assert.match(edge,/"INVALID_PROCESS_REQUEST"\s*,\s*"UNSUPPORTED_PURPOSE"/);
  assert.match(edge,/"INVALID_MODEL_ADVICE", "UNSAFE_AI_PROPOSAL", "UNSAFE_AI_ADVICE"/);
  assert.match(edge,/code==="UNSUPPORTED_SCENARIO"\|\|code==="UNSUPPORTED_PURPOSE"/);
  assert.match(edge,/code==="INVALID_PROCESS_REQUEST"\|\|code==="INVALID_REQUEST_ID"\?422/);
  assert.match(edge,/error:"Testförslaget kunde inte behandlas\."/);
  assert.doesNotMatch(edge,/return respond\(5\d\d,\{.*error\.message/);
});

test('Edge imports are pinned and no additional HTTP or model endpoints are introduced',()=>{
  assert.match(edge,/npm:@supabase\/supabase-js@2\.117\.1/);
  assert.equal((edge.match(/Deno\.serve\(/g)||[]).length,1);
  assert.equal((edge.match(/"https:\/\/api\.cloudflare\.com/g)||[]).length,0);
  const allowedHost='ludwigberglund-coder.github.io';
  const httpsFragments=edge.split('https://').slice(1);
  assert.ok(httpsFragments.length>0);
  for(const fragment of httpsFragments){
    assert.equal(fragment.startsWith(allowedHost),true);
    assert.equal(['/',"'",'"','`'].includes(fragment[allowedHost.length]),true);
  }
  assert.doesNotMatch(edge,/CLOUDFLARE_AI_TOKEN.*console\.log/);
  assert.doesNotMatch(edge,/Access-Control-Allow-Origin":"\*"/);
});
