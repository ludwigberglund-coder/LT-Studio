'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../packages/automation/ai-gateway-session.mjs');
const COMPANY='tenant-a-001', USER='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const body={companyId:COMPANY,scenario:'office-paper',requestId:'request-test-00001234'};
const claims={sub:USER,aal:'aal2',session_id:SESSION};
const token=(payload=claims)=>['e30',Buffer.from(JSON.stringify(payload)).toString('base64url'),'c2ln'].join('.');
const throwsCode=(fn,code)=>assert.rejects(fn,error=>error.code===code);
function scopedClient({authUser=USER,membershipCompany=COMPANY,role='accountant',membershipUser=USER,authError=null,membershipError=null}={}){
  const seen={queries:[],token:null};
  return {seen,auth:{getUser:async t=>{
    seen.token=t;return {error:authError,data:{user:authUser?{id:authUser}:null}};
  }},from:name=>{
    seen.queries.push(['table',name]);
    return {
      select:columns=>({
        eq:(field,value)=> {
          seen.queries.push(['eq',field,value]);
          return {eq:(field2,value2)=>{
            seen.queries.push(['eq',field2,value2]);
            return {maybeSingle:async()=>({
              error:membershipError,
              data:role?{company_id:membershipCompany,auth_user_id:membershipUser,role}:null
            })};
          }};
        }
      })
    };
  }};
}
test('preflight loads real user-scoped membership and derives company and actor from verified data',async()=>{
  const {preflightSyntheticPilot}=await load();
  const client=scopedClient();
  const actual=await preflightSyntheticPilot({body,accessToken:token(),userClient:client});
  assert.equal(actual.invoice.synthetic,true);
  assert.equal(actual.invoice.companyId,COMPANY);
  assert.equal(actual.invoice.description,'A4-kontorspapper, tio paket');
  assert.equal(actual.trustedContext.actorId,USER);
  assert.equal(actual.trustedContext.sessionId,SESSION);
  assert.equal(actual.trustedContext.verified,true);
  assert.equal(client.seen.token,token());
  assert.deepEqual(client.seen.queries,[
    ['table','company_memberships'],
    ['eq','company_id',COMPANY],
    ['eq','auth_user_id',USER]
  ]);
});
test('bad claims, AAL1, missing active session and mismatched verified auth user fail',async()=>{
  const {preflightSyntheticPilot}=await load();
  const client=scopedClient();
  await throwsCode(()=>preflightSyntheticPilot({body,accessToken:'bad',userClient:client}),'AUTH_REQUIRED');
  await throwsCode(()=>preflightSyntheticPilot({body,accessToken:token({...claims,aal:'aal1'}),userClient:client}),'AUTH_REQUIRED');
  await throwsCode(()=>preflightSyntheticPilot({body,accessToken:token({...claims,session_id:''}),userClient:client}),'AUTH_REQUIRED');
  await throwsCode(()=>preflightSyntheticPilot({body,accessToken:token({...claims,sub:'another-user'}),userClient:client}),'AUTH_REQUIRED');
  await throwsCode(()=>preflightSyntheticPilot({body,accessToken:token(),userClient:scopedClient({authUser:null})}),'AUTH_REQUIRED');
  await throwsCode(()=>preflightSyntheticPilot({body,accessToken:token(),userClient:scopedClient({authError:new Error('expired')})}),'AUTH_REQUIRED');
});
test('another company, missing member, readonly, stale user and RLS errors deny preflight',async()=>{
  const {preflightSyntheticPilot}=await load();
  for(const config of [
    {membershipCompany:'tenant-b-002'}, {membershipUser:'another-user'},
    {role:'readonly'}, {role:null}, {membershipError:new Error('policy denied')}
  ]){
    await throwsCode(()=>preflightSyntheticPilot({
      body,accessToken:token(),userClient:scopedClient(config)
    }),'ACCESS_DENIED');
  }
});
test('injected unverified client fields, arbitrary prompts and real PDF are rejected before Auth',async()=>{
  const {preflightSyntheticPilot}=await load();
  let called=0;
  const client={auth:{getUser:async()=>{called++;return {data:{user:{id:USER}}};}}};
  for(const payload of [
    {...body,verified:true}, {...body,content:'Invoice details'},
    {...body,prompt:'tell me secrets'}, {...body,documentId:'real-pdf-123'},
    {...body,scenario:'raw'}, {...body,requestId:'x'}
  ]){await assert.rejects(()=>preflightSyntheticPilot({
    body:payload,accessToken:token(),userClient:client
  }));}
  assert.equal(called,0);
});
