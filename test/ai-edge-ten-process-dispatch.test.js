'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const edge=read('supabase/functions/ai-bookkeeping-pilot/index.ts');
const http=read('packages/automation/ai-synthetic-http.mjs');
const config=read('supabase/config.toml');
const load=()=>import('../packages/automation/ai-finance-process-contract.mjs');

test('Edge route uses an explicit staging release while delegating to the guarded boundary',()=>{
  assert.match(edge,/const RELEASE_APPROVED = true;/);
  assert.match(edge,/createSyntheticHttpHandler/);
  assert.match(edge,/releaseApproved:\s*RELEASE_APPROVED/);
  assert.doesNotMatch(edge,/Deno\.env\.get\(["']AI_PILOT_RELEASE_APPROVED/);
  assert.match(config,/\[functions\.ai-bookkeeping-pilot\]\s+verify_jwt = false/);
});

test('the same boundary dispatches ten synthetic finance types or three legacy scenarios',async()=>{
  const {SUPPORTED_PURPOSES}=await load();
  assert.equal(SUPPORTED_PURPOSES.length,10);
  assert.match(http,/runSyntheticFinanceProcess/);
  assert.match(http,/createFinanceCloudflareProvider/);
  assert.match(http,/runSyntheticPilot/);
  assert.match(http,/cloudflareProvider/);
  assert.match(http,/Object\.hasOwn\(body,'purpose'\)/);
  assert.doesNotMatch(http,/req\.url\.includes|x-finance-process/);
});

test('new flow shares Auth, AAL2, durable admission and reservation protections',()=>{
  assert.equal((http.match(/const body=await lifetime\.wait\(\(\)=>readSmallJson\(req,2500,lifetime\.signal\)\);/g)||[]).length,1);
  assert.equal((http.match(/const userClient=createClient\(/g)||[]).length,1);
  assert.equal((http.match(/const reserveBudget=async/g)||[]).length,1);
  assert.match(http,/admin\.rpc\('admit_ai_pilot_request_server'\)/);
  assert.match(http,/admin\.rpc\('reserve_ai_pilot_request_server'/);
  for(const field of ['p_company_id','p_actor_uid','p_session_id','p_request_id','p_client_ip_hash']){
    assert.ok(http.includes(field),field);
  }
  assert.match(http,/p_client_ip_hash:SHARED_BUCKET/);
  assert.match(http,/privacyApproved:true/);
});

test('finance output exposes only synthetic human-reviewed advice',()=>{
  const start=http.indexOf('const proposal=await lifetime.wait(()=>runSyntheticFinanceProcess(');
  const finish=http.indexOf('const suggestion=await lifetime.wait(()=>runSyntheticPilot(',start);
  assert.ok(start>0&&finish>start);
  const response=http.slice(start,finish);
  assert.match(response,/status:'manual-review',posted:false,synthetic:true/);
  assert.match(response,/requiresHumanApproval:true,advice:proposal\.advice/);
  assert.doesNotMatch(response,/\.insert\(|\.update\(|journal_entries|sendPayment|executePayment/);
});

test('malformed purpose requests are categorized without leaking details',()=>{
  assert.match(http,/'INVALID_PROCESS_REQUEST','UNSUPPORTED_PURPOSE'/);
  assert.match(http,/'INVALID_MODEL_ADVICE','UNSAFE_AI_PROPOSAL','UNSAFE_AI_ADVICE'/);
  assert.match(http,/AI-testet kunde inte genomforas\./);
  assert.doesNotMatch(http,/error\.message|error\.stack/);
});

test('Edge imports are pinned and no extra route or origin is introduced',()=>{
  assert.match(edge,/npm:@supabase\/supabase-js@2\.117\.1/);
  assert.equal((edge.match(/Deno\.serve\(/g)||[]).length,1);
  assert.equal((edge.match(/createSyntheticHttpHandler/g)||[]).length,2);
  assert.equal(edge.includes('https://'),false);
  assert.match(http,/export const PILOT_ORIGIN = 'https:\/\/ludwigberglund-coder\.github\.io'/);
  assert.doesNotMatch(http,/Access-Control-Allow-Origin['"]\s*:\s*['"]\*/);
});
