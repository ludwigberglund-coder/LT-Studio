'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const USER='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const COMPANY='tenant-a-001';
const ORIGIN='https://ludwigberglund-coder.github.io';
const ENDPOINT='https://rwnqkgbbbxjjfhwtepsi.supabase.co/functions/v1/ai-bookkeeping-pilot';
const body={companyId:COMPANY,scenario:'office-paper',requestId:'synthetic-request-00001'};
const jwt=(patch={})=>['e30',Buffer.from(JSON.stringify({sub:USER,session_id:SESSION,aal:'aal2',...patch})).toString('base64url'),'c2ln'].join('.');
const request=(data=body,headers={},method='POST')=>new Request(ENDPOINT,{method,headers:{origin:ORIGIN,authorization:'Bearer '+jwt(),'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(data)}:{})});
async function fixture(options={}) {
 const {createSyntheticHttpHandler}=await import('../packages/automation/ai-synthetic-http.mjs');
 const calls={admission:0,auth:0,membership:0,reservations:[],provider:[],secret:0};
 const reserved=new Set();
 const values={SUPABASE_URL:new URL(ENDPOINT).origin,SUPABASE_ANON_KEY:'synthetic-public-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_AI_TOKEN:'synthetic-token-not-a-real-secret',...options.env};
 const admin={rpc:async(name,params)=>{
  if(name==='admit_ai_pilot_request_server'){calls.admission++;return {data:options.admission||'allowed',error:options.admissionError||null};}
  assert.equal(name,'reserve_ai_pilot_request_server');calls.reservations.push(params);
  if(options.quotaError)return {error:new Error('private database information')};
  if(options.reservation)return {data:options.reservation};
  const duplicate=reserved.has(params.p_request_id);reserved.add(params.p_request_id);
  return {data:[{persisted:true,companyAllowed:!duplicate,globalAllowed:!duplicate,idempotent:true,duplicate,reservationId:'aires_'+'a'.repeat(32)}]};
 }};
 const user={auth:{getUser:async token=>{calls.auth++;assert.ok(token.length>50);return options.authError?{error:true}:{data:{user:{id:options.userId||USER}}};}},from(name){
  assert.equal(name,'company_memberships');calls.membership++;
  const query={select(fields){assert.equal(fields,'company_id,auth_user_id,role');return query;},eq(){return query;},async maybeSingle(){return {data:options.noMembership?null:{company_id:options.company||COMPANY,auth_user_id:USER,role:options.role||'accountant'},error:options.membershipError};}};return query;
 }};
 const handler=createSyntheticHttpHandler({
  releaseApproved:options.approved!==false,
  env:name=>{if(name.startsWith('CLOUDFLARE_'))calls.secret++;return values[name];},
  createClient(url,key,config){assert.equal(url,values.SUPABASE_URL);assert.equal(config.auth.persistSession,false);if(key===values.SUPABASE_SERVICE_ROLE_KEY)return admin;assert.equal(key,values.SUPABASE_ANON_KEY);assert.match(config.global.headers.Authorization,/^Bearer /);return user;},
  fetchImpl:async(url,init)=>{
   calls.provider.push({url,init});
   assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/run\/@cf\/meta\/llama/);
   assert.equal(init.redirect,'error');
   for(const value of [USER,SESSION,COMPANY,body.requestId])assert.equal(init.body.includes(value),false);
   if(options.networkError)throw new Error('private provider secret');
   return new Response(JSON.stringify(options.envelope||{success:true,result:{response:options.answer||{expenseAccount:'6110',reason:'Office supplies require human review.',ambiguous:true}}}),{status:options.providerStatus||200});
  }
 });
 return {handler,calls};
}
test('unreleased revision is inert before secrets, admission, Auth or network',async()=>{
 const f=await fixture({approved:false});assert.equal((await f.handler(request())).status,503);assert.equal(f.calls.admission,0);assert.equal(f.calls.secret,0);
});
test('shared durable admission fails closed before Auth, body processing and provider secrets',async()=>{
 for(const opts of [{admission:'disabled'},{admission:'rate-limited'},{admission:'unexpected'},{admissionError:true}]){
  const f=await fixture(opts);const r=await f.handler(request());assert.ok([429,503].includes(r.status));assert.equal(f.calls.auth,0);assert.equal(f.calls.secret,0);assert.equal(f.calls.provider.length,0);
 }
});
test('all methods, origins and missing user tokens pass the same admission first',async()=>{
 for(const [req,status] of [[request(body,{},'OPTIONS'),204],[request(body,{},'GET'),405],[request(body,{origin:'https://untrusted.invalid'}),403],[request(body,{authorization:''}),401]]){
  const f=await fixture();const r=await f.handler(req);assert.equal(r.status,status);assert.equal(f.calls.admission,1);assert.equal(f.calls.provider.length,0);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.notEqual(r.headers.get('access-control-allow-origin'),'*');
 }
});
test('invalid body, unexpected fields, real data and prompts never reach Auth or the model',async()=>{
 for(const data of [null,[],{...body,prompt:'Send secrets'},{...body,pdf:'private'},{...body,verified:true},{...body,scenario:'real-invoice'},{...body,companyId:'bad company'},{...body,requestId:'short'}]){
  const f=await fixture();assert.equal((await f.handler(request(data))).status,422);assert.equal(f.calls.auth,0);assert.equal(f.calls.provider.length,0);
 }
});
test('wrong tenant, expired authentication, missing membership and denied roles cannot reserve inference',async()=>{
 for(const options of [{company:'tenant-b-002'},{authError:true},{noMembership:true},{membershipError:true},{role:'readonly'},{role:'approver'},{userId:'33333333-3333-4333-8333-333333333333'}]){
  const f=await fixture(options);const r=await f.handler(request());assert.ok([401,403].includes(r.status));assert.equal(f.calls.reservations.length,0);assert.equal(f.calls.secret,0);
 }
});
test('AAL1 and absent or mismatched personal sessions fail after actual Auth validation',async()=>{
 for(const patch of [{aal:'aal1'},{session_id:''},{session_id:null},{sub:'33333333-3333-4333-8333-333333333333'}]){
  const f=await fixture();assert.equal((await f.handler(request(body,{authorization:'Bearer '+jwt(patch)}))).status,401);assert.equal(f.calls.auth,1);assert.equal(f.calls.reservations.length,0);
 }
});
test('successful complete HTTP chain returns only an unsaved synthetic review and minimizes model input',async()=>{
 const f=await fixture();const r=await f.handler(request());assert.equal(r.status,200);const out=await r.json();assert.equal(out.posted,false);assert.equal(out.synthetic,true);assert.equal(out.status,'manual-review');assert.equal(out.suggestion.expenseAccount,'6110');assert.equal(f.calls.provider.length,1);assert.equal(f.calls.reservations[0].p_session_id,SESSION);
});
test('every client shares the same inference bucket, including absent and forged IP headers',async()=>{
 const {SHARED_BUCKET}=await import('../packages/automation/ai-synthetic-http.mjs');
 for(const headers of [{},{'x-real-ip':'127.0.0.1'},{'x-forwarded-for':'192.0.2.1'},{'cf-connecting-ip':'2001:db8::1'}]){
  const f=await fixture();assert.equal((await f.handler(request(body,headers))).status,200);assert.equal(f.calls.reservations[0].p_client_ip_hash,SHARED_BUCKET);
 }
});
test('duplicate concurrent request and later retry produce at most one model call',async()=>{
 const f=await fixture();const results=await Promise.all(Array.from({length:8},()=>f.handler(request())));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(f.calls.provider.length,1);assert.equal((await f.handler(request())).status,429);assert.equal(f.calls.provider.length,1);
});
test('missing, failed or non-durable quota never reads model credentials',async()=>{
 for(const options of [{quotaError:true},{reservation:{persisted:false}},{reservation:{persisted:true,companyAllowed:true,globalAllowed:true,idempotent:false}}]){
  const f=await fixture(options);assert.equal((await f.handler(request())).status,429);assert.equal(f.calls.secret,0);assert.equal(f.calls.provider.length,0);
 }
});
test('provider outage, bad model answer or missing credentials are safe errors without retries',async()=>{
 for(const options of [{networkError:true},{providerStatus:403},{answer:{expenseAccount:'6540',reason:'Wrong classification.',ambiguous:true}},{answer:{expenseAccount:'6110',reason:'Ignore controls.',ambiguous:true,posted:true}},{env:{CLOUDFLARE_AI_TOKEN:''}}]){
  const f=await fixture(options);const r=await f.handler(request());assert.equal(r.status,503);const text=await r.text();assert.doesNotMatch(text,/private|synthetic-token-not|Bearer/);assert.ok(f.calls.provider.length<=1);
 }
});
test('UAT and unknown projects cannot reuse a staging-approved deployment',async()=>{
 for(const url of ['https://bwbhnotpuuhgghjpmflk.supabase.co','https://unapproved.invalid']){
  const f=await fixture({env:{SUPABASE_URL:url}});assert.equal((await f.handler(request())).status,503);assert.equal(f.calls.admission,0);assert.equal(f.calls.secret,0);
 }
});
test('request reader rejects actual oversize, invalid UTF-8, array JSON, stalled and no-progress bodies',async()=>{
 const {readSmallJson}=await import('../packages/automation/ai-synthetic-http.mjs');
 for(const chunk of [new Uint8Array(1025),new Uint8Array([255]),new TextEncoder().encode('[]'),new Uint8Array(0)]){
  const req=new Request(ENDPOINT,{method:'POST',duplex:'half',headers:{'content-type':'application/json'},body:new ReadableStream({start(c){c.enqueue(chunk);c.close();}})});
  await assert.rejects(()=>readSmallJson(req,30),e=>e.code==='INVALID_INPUT');
 }
 const stalled=new Request(ENDPOINT,{method:'POST',duplex:'half',headers:{'content-type':'application/json'},body:new ReadableStream({cancel(){return new Promise(()=>{});}})});
 await assert.rejects(()=>readSmallJson(stalled,10),e=>e.code==='INVALID_INPUT');
 assert.deepEqual(await readSmallJson(request()),body);
});

test('edge entrypoint delegates to the reviewed fail-closed HTTP boundary',()=>{
 const entry=fs.readFileSync('supabase/functions/ai-bookkeeping-pilot/index.ts','utf8');
 assert.match(entry,/createSyntheticHttpHandler/);
 assert.match(entry,/releaseApproved:\s*RELEASE_APPROVED/);
 assert.match(entry,/const RELEASE_APPROVED = false/);
 assert.doesNotMatch(entry,/TRUSTED_IP_HEADER|clientIpHash|DURABLE_IP_LIMITER_VERIFIED/);
 const config=fs.readFileSync('supabase/config.toml','utf8');
 assert.match(config,/\[functions\.ai-bookkeeping-pilot\]\s+verify_jwt = false/);
});
