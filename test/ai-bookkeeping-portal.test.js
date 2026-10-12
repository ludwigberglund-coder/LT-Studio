'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.html'),'utf8');
const nav=fs.readFileSync(path.join(root,'apps/portal/portal-nav.js'),'utf8');
const sample=[
  {account:'6110',debitOre:100000,creditOre:0},
  {account:'2641',debitOre:25000,creditOre:0},
  {account:'2440',debitOre:0,creditOre:125000}
];
function fixture({demo=false,role='accountant',response,throwInvoke}={}){
  const callbacks={};
  const app={innerHTML:''};
  let calls=0,authCalls=0;
  const context={authenticated:true,company:{id:'tenant-a-001',name:'Test AB'},
    user:{displayName:'Anna'},membership:{role},accessToken:'test-access-token'};
  const win={
    LTSupabaseUat:{context:async()=>{authCalls++;return context;}},
    LTSupabase:{functions:{invoke:async(name,body,token)=>{
      calls++;
      assert.equal(name,'ai-bookkeeping-pilot');
      assert.equal(token,'test-access-token');
      assert.equal(body.companyId,'tenant-a-001');
      assert.ok(['office-paper','software-service','cleaning-supplies'].includes(body.scenario));
      assert.match(body.requestId,/^ai-pilot-/);
      assert.deepEqual(Object.keys(body).sort(),['companyId','requestId','scenario']);
      if(throwInvoke)throw throwInvoke;
      return response??{status:'manual-review',posted:false,companyId:'tenant-a-001',
        reason:'Denna leverantör är ett kontorsmaterialtest.',suggestion:{rows:sample,requiresHumanApproval:true}};
    }}}
  };
  const sandbox={
    document:{getElementById:()=>app,addEventListener:(name,callback)=>{callbacks[name]=callback;}},
    window:win,
    location:{search:demo?'?demo=1':'',hostname:'ludwigberglund-coder.github.io',href:''},
    URLSearchParams,Intl,Set,Number,Object,Error,String,Array,
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
  };
  vm.runInNewContext(script,sandbox,{filename:'ai-bookkeeping.js'});
  const select=(value)=>callbacks.change({target:{id:'ai-scenario',value}});
  const click=(action)=>callbacks.click({target:{
    closest:(key)=>key==='[data-ai-action]'?{disabled:false,dataset:{aiAction:action}}:null
  }});
  return {app,callbacks,select,click,get calls(){return calls},get authCalls(){return authCalls}};
}
function settle(){return new Promise(resolve=>setImmediate(resolve));}
test('customer portal has an accounting-permission-scoped AI navigation item',()=>{
  assert.match(nav,/\['ai-bookkeeping','AI-bokföring','portal\/ai-bookkeeping\.html'\]/);
  assert.match(nav,/'ai-bookkeeping':'accounting\.view'/);
  assert.match(html,/ai-bookkeeping\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(html,/portal-nav\.js/);
});
test('demo makes no external calls, renders honest example and 25% VAT balanced rows',()=>{
  const f=fixture({demo:true});
  assert.match(f.app.innerHTML,/Begränsat testläge/);
  assert.match(f.app.innerHTML,/Visa bokföringsexempel/);
  assert.match(f.app.innerHTML,/För att prova AI-knappen krävs inloggning/);
  f.click('example');
  assert.match(f.app.innerHTML,/FAST RÄKNEEXEMPEL – INTE AI/);
  assert.match(f.app.innerHTML,/6110/);
  assert.match(f.app.innerHTML,/2641/);
  assert.match(f.app.innerHTML,/2440/);
  assert.match(f.app.innerHTML,/1 250,00|1 250,00|1 250,00/);
  assert.equal(f.calls,0);
  f.select('software-service');
  f.click('example');
  assert.match(f.app.innerHTML,/6540/);
  assert.equal(f.calls,0);
});
test('real portal calls only fixed synthetic scenario, not user-entered amounts or PDFs',async()=>{
  const f=fixture();
  await settle();
  f.click('analyze');
  await settle();
  assert.equal(f.calls,1);
  assert.match(f.app.innerHTML,/AI-FÖRSLAG/);
  assert.match(f.app.innerHTML,/Inte bokfört/);
  assert.match(f.app.innerHTML,/Förslaget är bara en förhandsvisning/);
  assert.ok(!f.app.innerHTML.includes('test-access-token'));
});
test('AI not released fails safely and leaves manual preview available',async()=>{
  const f=fixture({throwInvoke:Object.assign(new Error('provider internal detail'),{status:503,code:'AI_PILOT_NOT_RELEASED'})});
  await settle();
  f.click('analyze');await settle();
  assert.equal(f.calls,1);
  assert.match(f.app.innerHTML,/AI-testet är ännu inte aktiverat/);
  assert.doesNotMatch(f.app.innerHTML,/provider internal detail/);
  f.click('example');
  assert.match(f.app.innerHTML,/FAST RÄKNEEXEMPEL – INTE AI/);
});
test('malicious provider body or different tenant is never displayed as a trusted AI suggestion',async()=>{
  const f=fixture({response:{status:'manual-review',posted:false,companyId:'tenant-b-002',suggestion:{rows:sample,requiresHumanApproval:true}}});
  await settle();f.click('analyze');await settle();
  assert.equal(f.calls,1);
  assert.doesNotMatch(f.app.innerHTML,/AI-FÖRSLAG/);
  assert.match(f.app.innerHTML,/Ingen bokföring ändrades/);
});
test('readonly user can see an example but never trigger AI',async()=>{
  const f=fixture({role:'readonly'});
  await settle();
  assert.match(f.app.innerHTML,/Prova med AI \(pilot\)/);
  assert.match(f.app.innerHTML,/\bdisabled\b/);
  f.click('example');
  assert.match(f.app.innerHTML,/FAST RÄKNEEXEMPEL – INTE AI/);
  assert.equal(f.calls,0);
});
test('the customer browser never contains Cloudflare token or admin secret usage',()=>{
  assert.doesNotMatch(script,/CLOUDFLARE_AI_TOKEN|CLOUDFLARE_ACCOUNT_ID|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script,/journal_entries|postJournalEntry|customer_payment_executions/);
  assert.doesNotMatch(script,/document\.createElement\(['"]script/);
  assert.match(script,/ai-bookkeeping-pilot/);
  assert.match(script,/posted!==false/);
});
