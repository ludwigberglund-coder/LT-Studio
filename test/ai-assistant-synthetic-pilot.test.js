'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.js'),'utf8');
const catalog=require('../apps/portal/ai-process-guides.js');
const UUID='11111111-1111-4111-8111-111111111111';
const requestId='ai-finance-'+UUID;
const advice={decision:'review-source',
  explanation:'Kontrollera originalunderlaget innan någon ekonomisk åtgärd beslutas.',
  uncertainties:['Belopp och underlag behöver granskas av rätt person.']};
function reply(payload){
  return {
    schemaVersion:1,companyId:payload.companyId,purpose:payload.purpose,
    sourceId:'synthetic-'+payload.purpose+'-'+payload.requestId,
    status:'manual-review',posted:false,synthetic:true,requiresHumanApproval:true,
    advice:{...advice,uncertainties:[...advice.uncertainties]}
  };
}
function fixture({demo=false,role='accountant',replyOverride,invokeError,sessionChange}={}){
  const callbacks={},app={innerHTML:''},results={innerHTML:''},status={textContent:''},calls=[];
  let authCalls=0,redirect='';
  const scoped={
    authenticated:true,company:{id:'tenant-qa-alpha',name:'Fiktivt företag AB'},
    user:{displayName:'Testperson'},membership:{role},accessToken:'synthetic-fake-access-token'
  };
  const sandbox={
    window:{
      LTStudioAiProcessGuides:catalog,
      LTSupabaseUat:{context:async()=>{authCalls++;return sessionChange&&authCalls>1?sessionChange:scoped}},
      LTSupabase:{functions:{invoke:async(name,payload,token)=>{
        calls.push({name,payload,token});
        if(invokeError)throw invokeError;
        return replyOverride?replyOverride(payload):reply(payload);
      }}}
    },
    location:{hostname:'ludwigberglund-coder.github.io',search:demo?'?demo=1':'',
      replace:value=>{redirect=value}},
    document:{
      getElementById:id=>id==='ai-assistant-app'?app:
        id==='ai-assistant-results'?results:id==='ai-assistant-results-status'?status:null,
      addEventListener:(event,handler)=>{callbacks[event]=handler},
      querySelectorAll:()=>[]
    },
    crypto:{randomUUID:()=>UUID},
    URLSearchParams
  };
  vm.runInNewContext(script,sandbox,{filename:'ai-assistant.js'});
  const click=()=>callbacks.click({target:{closest:selector=>selector==='[data-ai-run-pilot]'?
    {disabled:false}:null}});
  const change=purpose=>callbacks.change({target:{id:'ai-finance-purpose',value:purpose}});
  const type=value=>callbacks.input({target:{id:'ai-assistant-query',value}});
  return {app,calls,click,change,type,get authCalls(){return authCalls},get redirect(){return redirect}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('assistant advertises exactly ten server-defined finance purposes without private source input',async()=>{
  const {SUPPORTED_PURPOSES}=await import('../packages/automation/ai-finance-process-contract.mjs');
  const f=fixture({demo:true});
  for(const purpose of SUPPORTED_PURPOSES){
    assert.ok(f.app.innerHTML.includes('value="'+purpose+'"'),purpose);
  }
  assert.equal((f.app.innerHTML.match(/<option value="/g)||[]).length,SUPPORTED_PURPOSES.length);
  assert.match(f.app.innerHTML,/data-ai-run-pilot disabled/);
  assert.match(f.app.innerHTML,/Sökfrågan ovan skickas aldrig till AI/);
  assert.equal(f.authCalls,0);
  f.click();await settle();
  assert.equal(f.calls.length,0);
});

test('signed-in accountant sends ONLY trusted company ID, allowed purpose and request ID',async()=>{
  const f=fixture();
  await settle();
  assert.match(f.app.innerHTML,/data-ai-run-pilot /);
  assert.doesNotMatch(f.app.innerHTML,/data-ai-run-pilot disabled/);
  f.type('Min kund heter Personligen Hemlig och har personnummer 19000101');
  f.change('year-close');
  f.click();await settle();
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].name,'ai-bookkeeping-pilot');
  assert.equal(f.calls[0].token,'synthetic-fake-access-token');
  assert.deepEqual(Object.keys(f.calls[0].payload).sort(),['companyId','purpose','requestId']);
  assert.equal(f.calls[0].payload.companyId,'tenant-qa-alpha');
  assert.equal(f.calls[0].payload.purpose,'year-close');
  assert.equal(f.calls[0].payload.requestId,requestId);
  assert.doesNotMatch(JSON.stringify(f.calls),/personnummer|Hemlig|19000101|prompt|pdf|documentText/);
  assert.match(f.app.innerHTML,/syntetiska granskningsförslag/);
  assert.match(f.app.innerHTML,/inte bokfört/);
  assert.match(f.app.innerHTML,/Ingenting är bokfört eller sparat/);
});

test('all ten finance purposes can request strictly synthetic preview output',async()=>{
  const {SUPPORTED_PURPOSES}=await import('../packages/automation/ai-finance-process-contract.mjs');
  const f=fixture({role:'admin'});await settle();
  for(const purpose of SUPPORTED_PURPOSES){
    f.change(purpose);
    f.click();await settle();
    assert.equal(f.calls.at(-1).payload.purpose,purpose);
    assert.match(f.app.innerHTML,/AI:s syntetiska granskningsförslag/);
  }
  assert.equal(f.calls.length,10);
});

test('readonly users and changed tenant or role cannot submit any finance pilot requests',async()=>{
  const readonly=fixture({role:'readonly'});await settle();
  assert.doesNotMatch(readonly.app.innerHTML,/data-ai-run-pilot/);
  readonly.click();await settle();
  assert.equal(readonly.calls.length,0);
  for(const sessionChange of [
    {authenticated:true,company:{id:'tenant-qa-other'},membership:{role:'accountant'}},
    {authenticated:true,company:{id:'tenant-qa-alpha'},membership:{role:'readonly'}},
    {authenticated:false,company:{id:'tenant-qa-alpha'},membership:{role:'admin'}}
  ]){
    const f=fixture({sessionChange});await settle();
    f.click();await settle();
    assert.equal(f.calls.length,0);
    assert.match(f.app.innerHTML,/saknar giltig session eller behörighet/);
  }
});

test('wrong tenant, source, amount/status or model-injected HTML never becomes trusted pilot output',async()=>{
  const mutations=[
    p=>({...reply(p),companyId:'tenant-qa-other'}),
    p=>({...reply(p),sourceId:'synthetic-wrong'}),
    p=>({...reply(p),schemaVersion:2}),
    p=>({...reply(p),status:'approved'}),
    p=>({...reply(p),posted:true}),
    p=>({...reply(p),requiresHumanApproval:false}),
    p=>({...reply(p),synthetic:false}),
    p=>({...reply(p),journalLines:[{account:'1930',debitOre:100}]}),
    p=>({...reply(p),advice:{...reply(p).advice,approved:true}}),
    p=>({...reply(p),advice:{...reply(p).advice,explanation:'<script>alert(1)</script> kontrollera allt.'}}),
    p=>({...reply(p),advice:{...reply(p).advice,uncertainties:['x']}})
  ];
  for(const mutate of mutations){
    const f=fixture({replyOverride:mutate});await settle();
    f.click();await settle();
    assert.equal(f.calls.length,1);
    assert.doesNotMatch(f.app.innerHTML,/AI:s syntetiska granskningsförslag/);
    assert.match(f.app.innerHTML,/kunde inte visas säkert/);
    assert.doesNotMatch(f.app.innerHTML,/<script>|alert\(1\)/);
  }
});

test('disabled gateway or untrusted provider error appears as neutral explanation only',async()=>{
  const notReleased=fixture({invokeError:Object.assign(new Error('secret API response'),{
    code:'AI_PILOT_NOT_RELEASED',status:503
  })});
  await settle();notReleased.click();await settle();
  assert.match(notReleased.app.innerHTML,/AI-piloten är ännu inte aktiverad/);
  assert.doesNotMatch(notReleased.app.innerHTML,/secret API response/);
  const quota=fixture({invokeError:Object.assign(new Error('service role key'),{status:429})});
  await settle();quota.click();await settle();
  assert.match(quota.app.innerHTML,/kostnadsgräns är nådd/);
  assert.doesNotMatch(quota.app.innerHTML,/service role key/);
});

test('assistant never directly posts journal, accesses storage or holds model credentials',()=>{
  assert.doesNotMatch(script,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(script,/\.rpc\s*\(|\.from\s*\(|\bfetch\s*\(|localStorage|sessionStorage/);
  assert.match(script,/\.functions\.invoke\('ai-bookkeeping-pilot'/);
  assert.match(script,/companyId:String\(current\.company\.id\),purpose:pilotPurpose,requestId/);
  assert.match(script,/validatedPilotResult\(response,requestId/);
});
