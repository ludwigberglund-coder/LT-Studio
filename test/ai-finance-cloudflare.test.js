'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const USER='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const REQUEST={companyId:'tenant-a-001',purpose:'vat-review',requestId:'finance-pilot-0000001'};
const RESERVATION={persisted:true,companyAllowed:true,globalAllowed:true,idempotent:true,reservationId:'reserved-finance-00001'};
const ANSWER={
  decision:'ask-human',
  explanation:'Uppgifterna måste granskas mot originalunderlagen innan någon momsåtgärd genomförs.',
  uncertainties:['Periodens särskilda momstransaktioner måste kontrolleras.']
};
const ACCOUNT='a'.repeat(32);
const TOKEN='synthetic-api-token-not-a-real-secret';
const loadProvider=()=>import('../packages/automation/ai-finance-cloudflare.mjs');
const loadEngine=()=>import('../packages/automation/ai-finance-process-orchestrator.mjs');
function userClient(){
  return {auth:{getUser:async()=>({error:null,data:{user:{id:USER}}})},
    from:()=>{
      const chain={
        select:()=>chain,eq:()=>chain,
        maybeSingle:async()=>({error:null,data:{company_id:REQUEST.companyId,auth_user_id:USER,role:'accountant'}})
      };
      return chain;
    }};
}
function signedToken(){
  return ['e30',Buffer.from(JSON.stringify({sub:USER,session_id:SESSION,aal:'aal2'})).toString('base64url'),'c2ln'].join('.');
}
function options(provider){
  return {body:REQUEST,accessToken:signedToken(),userClient:userClient(),
    enabled:true,privacyApproved:true,reserveBudget:async()=>RESERVATION,provider};
}
function provider(fetchImpl){
  return loadProvider().then(({createFinanceCloudflareProvider})=>createFinanceCloudflareProvider({
    enabled:true,accountId:ACCOUNT,apiToken:TOKEN,fetchImpl
  }));
}
function mockResponse(body,status=200,type='application/json'){
  return new Response(typeof body==='string'?body:JSON.stringify(body),{
    status,headers:{'content-type':type}
  });
}
const hasCode=code=>error=>error?.code===code;

test('Cloudflare adapter is disabled by default and rejects invalid credentials',async()=>{
  const {createFinanceCloudflareProvider}=await loadProvider();
  assert.throws(()=>createFinanceCloudflareProvider({accountId:ACCOUNT,apiToken:TOKEN}),hasCode('AI_DISABLED'));
  assert.throws(()=>createFinanceCloudflareProvider({
    enabled:true,accountId:'https://attacker.example',apiToken:TOKEN
  }),hasCode('PROVIDER_NOT_CONFIGURED'));
  assert.throws(()=>createFinanceCloudflareProvider({
    enabled:true,accountId:ACCOUNT,apiToken:'too-short'
  }),hasCode('PROVIDER_NOT_CONFIGURED'));
  assert.throws(()=>createFinanceCloudflareProvider({
    enabled:true,accountId:ACCOUNT,apiToken:TOKEN+'\nmalicious'
  }),hasCode('PROVIDER_NOT_CONFIGURED'));
});

test('verified synthetic finance example reaches fixed model with no company, user or session',async()=>{
  const {MODEL}=await loadProvider();
  const {runSyntheticFinanceProcess}=await loadEngine();
  let requests=0;
  const adapter=await provider(async(url,req)=>{
    requests++;
    assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/ai/run/'+MODEL);
    assert.equal(req.method,'POST');
    assert.equal(req.redirect,'error');
    assert.equal(req.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(req.headers['Content-Type'],'application/json');
    assert.equal(req.signal.aborted,false);
    const data=JSON.parse(req.body);
    assert.equal(data.temperature,0);
    assert.equal(data.stream,false);
    assert.equal(data.response_format.type,'json_schema');
    assert.equal(data.response_format.json_schema.additionalProperties,false);
    assert.deepEqual(data.response_format.json_schema.required,['decision','explanation','uncertainties']);
    assert.deepEqual(data.response_format.json_schema.properties.decision.enum,[
      'review-source','review-numbers','ask-human'
    ]);
    for(const forbidden of [USER,SESSION,REQUEST.companyId,REQUEST.requestId,TOKEN]){
      assert.equal(req.body.includes(forbidden),false,'sensitive data may not be sent to Cloudflare');
    }
    assert.match(req.body,/Syntetiska|syntetiska|syntetisk|påhittade/);
    return mockResponse({success:true,result:{response:ANSWER}});
  });
  const proposal=await runSyntheticFinanceProcess(options(adapter));
  assert.equal(requests,1);
  assert.equal(proposal.status,'manual-review');
  assert.equal(proposal.posted,false);
  assert.equal(proposal.requiresHumanApproval,true);
  assert.deepEqual(proposal.advice,ANSWER);
});

test('unverified or fabricated source cannot be sent to provider',async()=>{
  let calls=0;
  const adapter=await provider(async()=>{calls++;return mockResponse({success:true,result:{response:ANSWER}});});
  await assert.rejects(()=>adapter({synthetic:true,purpose:REQUEST.purpose,facts:{}}),hasCode('UNTRUSTED_SOURCE'));
  assert.equal(calls,0);
});

test('non-JSON, markdown, extra fields, provider errors and network timeouts fail closed',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  const invalid=[
    [()=>mockResponse({success:true,result:{response:{...ANSWER,posted:true}}}),'INVALID_MODEL_ADVICE'],
    [()=>mockResponse({success:true,result:{response:'NOT JSON'}}),'MODEL_INVALID_RESPONSE'],
    [()=>mockResponse({success:false,result:{response:ANSWER}}),'MODEL_INVALID_RESPONSE'],
    [()=>mockResponse({success:true,result:{response:ANSWER}},500),'PROVIDER_REJECTED'],
    [()=>mockResponse('plain text',200,'text/plain'),'MODEL_INVALID_RESPONSE'],
    [()=>mockResponse('{bad-json'),'MODEL_INVALID_RESPONSE'],
    [()=>mockResponse('x'.repeat(9000)),'MODEL_INVALID_RESPONSE']
  ];
  for(const [make,code] of invalid){
    const adapter=await provider(async()=>make());
    await assert.rejects(()=>runSyntheticFinanceProcess(options(adapter)),hasCode(code));
  }
  let attempts=0;
  const unavailable=await provider(async()=>{
    attempts++;throw new Error('secret remote server details must stay hidden');
  });
  await assert.rejects(()=>runSyntheticFinanceProcess(options(unavailable)),hasCode('PROVIDER_UNAVAILABLE'));
  assert.equal(attempts,1,'no hidden retries or paid provider fallback');
});

test('provider may return JSON encoded as a string but must still satisfy strict schema',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  const adapter=await provider(async()=>mockResponse({
    success:true,result:{response:JSON.stringify(ANSWER)}
  }));
  const reply=await runSyntheticFinanceProcess(options(adapter));
  assert.deepEqual(reply.advice,ANSWER);
});
