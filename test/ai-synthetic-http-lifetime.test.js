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
 const calls={admission:0,auth:0,membership:0,reservations:[],provider:[],secret:0,envReads:[],configs:[]};
 const reserved=new Set();
 const values={SUPABASE_URL:new URL(ENDPOINT).origin,SUPABASE_ANON_KEY:'synthetic-public-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_AI_TOKEN:'synthetic-token-not-a-real-secret',...options.env};
 const admin={rpc:async(name,params)=>{
  if(name==='admit_ai_pilot_request_server'){calls.admission++;if(options.hold?.admission)await options.hold.admission.promise;return {data:options.admission||'allowed',error:options.admissionError||null};}
  assert.equal(name,'reserve_ai_pilot_request_server');calls.reservations.push(params);
  if(options.hold?.quota)await options.hold.quota.promise;
  if(options.quotaError)return {error:new Error('private database information')};
  if(options.reservation)return {data:options.reservation};
  const duplicate=reserved.has(params.p_request_id);reserved.add(params.p_request_id);
  return {data:[{persisted:true,companyAllowed:!duplicate,globalAllowed:!duplicate,idempotent:true,duplicate,reservationId:'aires_'+'a'.repeat(32)}]};
 }};
 const user={auth:{getUser:async token=>{calls.auth++;if(options.hold?.auth)await options.hold.auth.promise;assert.ok(token.length>50);return options.authError?{error:true}:{data:{user:{id:options.userId||USER}}};}},from(name){
  assert.equal(name,'company_memberships');calls.membership++;
  const query={select(fields){assert.equal(fields,'company_id,auth_user_id,role');return query;},eq(){return query;},async maybeSingle(){if(options.hold?.membership)await options.hold.membership.promise;return {data:options.noMembership?null:{company_id:options.company||COMPANY,auth_user_id:USER,role:options.role||'accountant'},error:options.membershipError};}};return query;
 }};
 const handler=createSyntheticHttpHandler({
  releaseApproved:options.approved!==false,requestTimeoutMs:options.requestTimeoutMs,
  supabaseFetch:options.supabaseFetch,
  env:name=>{calls.envReads.push(name);if(name.startsWith('CLOUDFLARE_'))calls.secret++;return values[name];},
  createClient(url,key,config){assert.equal(url,values.SUPABASE_URL);assert.equal(config.auth.persistSession,false);assert.equal(config.db.retry,false);assert.equal(typeof config.global.fetch,'function');calls.configs.push(config);if(key===values.SUPABASE_SERVICE_ROLE_KEY)return admin;assert.equal(key,values.SUPABASE_ANON_KEY);assert.match(config.global.headers.Authorization,/^Bearer /);return user;},
  fetchImpl:async(url,init)=>{
   calls.provider.push({url,init});
   if(options.hold?.provider)await options.hold.provider.promise;
   if(options.providerResponse)return options.providerResponse;
   assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/run\/@cf\/meta\/llama/);
   assert.equal(init.redirect,'error');
   for(const value of [USER,SESSION,COMPANY,body.requestId])assert.equal(init.body.includes(value),false);
   if(options.networkError)throw new Error('private provider secret');
   return new Response(JSON.stringify(options.envelope||{success:true,result:{response:options.answer||{expenseAccount:'6110',reason:'Office supplies require human review.',ambiguous:true}}}),{status:options.providerStatus||200});
  }
 });
 return {handler,calls};
}
test('cancelled HTTP request never starts admission, authentication or inference',async()=>{
 const f=await fixture(),abort=new AbortController();abort.abort('PRIVATE_CLIENT_REASON');
 const req=new Request(request(),{signal:abort.signal});
 const r=await f.handler(req);
 assert.equal(r.status,408);assert.deepEqual(f.calls.envReads,[]);
 assert.equal(f.calls.admission,0);assert.equal(f.calls.auth,0);assert.equal(f.calls.provider.length,0);
 assert.equal((await r.json()).code,'AI_REQUEST_CANCELLED');
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};}
async function stageReached(f,stage){
 const count=()=>stage==='quota'?f.calls.reservations.length:stage==='provider'?f.calls.provider.length:f.calls[stage];
 for(let i=0;i<30&&!count();i++)await tick();
 assert.equal(count(),1,'the intended delayed stage was reached');
}
for(const stage of ['admission','auth','membership','quota','provider']){
 test('client abort stops the request while '+stage+' is pending',{timeout:1000},async()=>{
  const held=deferred(),f=await fixture({hold:{[stage]:held}}),abort=new AbortController();
  const req=new Request(request(),{signal:abort.signal});
  const pending=f.handler(req);await stageReached(f,stage);abort.abort('PRIVATE_CLIENT_REASON');
  const r=await pending;assert.equal(r.status,408);assert.equal((await r.json()).code,'AI_REQUEST_CANCELLED');
  held.resolve();await tick();await tick();
  assert.equal(f.calls.provider.length,stage==='provider'?1:0);
  if(stage!=='provider')assert.equal(f.calls.secret,0);
  if(stage==='provider')assert.equal(f.calls.provider[0].init.signal.aborted,true);
  if(stage==='quota')assert.equal(f.calls.reservations.length,1,'do not retry/refund uncertain committed quota');
 });
 test('total deadline stops a stalled '+stage+' before any later model work',{timeout:1000},async()=>{
  const held=deferred(),f=await fixture({hold:{[stage]:held},requestTimeoutMs:30});
  const r=await f.handler(request());assert.equal(r.status,408);assert.equal((await r.json()).code,'AI_REQUEST_TIMEOUT');
  held.resolve();await tick();await tick();
  assert.equal(f.calls.provider.length,stage==='provider'?1:0);
  if(stage!=='provider')assert.equal(f.calls.secret,0);
  if(stage==='provider')assert.equal(f.calls.provider[0].init.signal.aborted,true);
 });
}
test('aborted stalled upload is cancelled without authentication or inference',{timeout:1000},async()=>{
 let cancelled=0;const f=await fixture(),abort=new AbortController();
 const req=new Request(ENDPOINT,{method:'POST',duplex:'half',signal:abort.signal,
  headers:{origin:ORIGIN,authorization:'Bearer '+jwt(),'content-type':'application/json'},
  body:new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}})});
 const pending=f.handler(req);await stageReached(f,'admission');await tick();abort.abort();
 assert.equal((await pending).status,408);await tick();assert.equal(cancelled,1);
 assert.equal(f.calls.auth,0);assert.equal(f.calls.provider.length,0);
});
test('lifetime signal propagates through the actual Supabase fetch option',{timeout:1000},async()=>{
 const held=deferred(),wire=deferred(),abort=new AbortController();let signal,wireCalls=0;
 const f=await fixture({hold:{auth:held},supabaseFetch:async(_url,init)=>{wireCalls++;signal=init.signal;return wire.promise;}});
 const pending=f.handler(new Request(request(),{signal:abort.signal}));await stageReached(f,'auth');
 const fetch=f.calls.configs[1].global.fetch;
 const result=fetch(ENDPOINT,{signal:new AbortController().signal});
 const rejected=assert.rejects(result,e=>e.code==='AI_REQUEST_CANCELLED');
 await tick();assert.equal(signal.aborted,false);abort.abort();
 assert.equal((await pending).status,408);await rejected;assert.equal(signal.aborted,true);
 await assert.rejects(()=>fetch(ENDPOINT),e=>e.code==='AI_REQUEST_CANCELLED');assert.equal(wireCalls,1);
 wire.resolve(new Response('{}'));held.resolve();await tick();
});
test('a late provider response is cancelled and never reported as AI success',{timeout:1000},async()=>{
 let cancelled=0;const held=deferred(),abort=new AbortController();
 const response=new Response(new ReadableStream({cancel(){cancelled++;}}));
 const f=await fixture({hold:{provider:held},providerResponse:response});
 const pending=f.handler(new Request(request(),{signal:abort.signal}));await stageReached(f,'provider');abort.abort();
 const r=await pending;assert.equal(r.status,408);assert.doesNotMatch(await r.text(),/PRIVATE|synthetic-token|Bearer/);
 held.resolve();await tick();await tick();assert.equal(cancelled,1);assert.equal(f.calls.provider.length,1);
});
test('successful and failed requests release the caller abort listener',async()=>{
 const {getEventListeners}=require('node:events');
 for(const options of [{},{authError:true},{approved:false}]){
  const f=await fixture(options),req=request(),before=getEventListeners(req.signal,'abort').length;
  await f.handler(req);assert.equal(getEventListeners(req.signal,'abort').length,before);
 }
});
test('internal test deadlines cannot exceed the production ceiling',async()=>{
 const {createSyntheticHttpHandler}=await import('../packages/automation/ai-synthetic-http.mjs');
 for(const requestTimeoutMs of [0,-1,14001,Infinity,NaN,1.5,'20'])
  assert.throws(()=>createSyntheticHttpHandler({requestTimeoutMs}),e=>e.code==='INVALID_INPUT');
});
