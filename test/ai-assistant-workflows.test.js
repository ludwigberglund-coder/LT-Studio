'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const catalog=require('../apps/portal/ai-process-guides.js');
const navigation=require('../apps/portal/portal-nav.js');
const policy=require('../config/access-control.json');
const html=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.html'),'utf8');
const script=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.js'),'utf8');
const navSource=fs.readFileSync(path.join(root,'apps/portal/portal-nav.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.css'),'utf8');
const sharedCss=fs.readFileSync(path.join(root,'apps/portal/shared-nav.css'),'utf8');

function fixture({demo=true,from='bank.html',role='accountant',authenticated=true}={}){
  const callbacks={};
  const app={innerHTML:''},results={innerHTML:''},status={textContent:''};
  const buttons=[];
  let externalCalls=0,redirect='';
  const context={authenticated,company:{id:'company-synthetic-a',name:'Fiktivt Företag AB'},
    user:{displayName:'Testperson'},membership:{role},accessToken:'fake-token'};
  const sandbox={
    window:{LTStudioAiProcessGuides:catalog,LTSupabaseUat:{context:async()=>{externalCalls++;return context}},
      LTSupabase:{}},
    location:{search:'?from='+encodeURIComponent(from)+(demo?'&demo=1':''),hostname:'ludwigberglund-coder.github.io',
      replace:value=>{redirect=value}},
    document:{
      getElementById:id=>id==='ai-assistant-app'?app:id==='ai-assistant-results'?results:id==='ai-assistant-results-status'?status:null,
      addEventListener:(event,handler)=>{callbacks[event]=handler},
      querySelectorAll:()=>buttons
    },
    URLSearchParams,String,Set,Object,Array
  };
  vm.runInNewContext(script,sandbox,{filename:'ai-assistant.js'});
  return {
    app,results,status,callbacks,buttons,
    get externalCalls(){return externalCalls},
    get redirect(){return redirect}
  };
}
function settle(){return new Promise(resolve=>setImmediate(resolve))}

test('safe guidance covers all finance domains with routes that exist',()=>{
  const ids=new Set(catalog.processes.map(item=>item.id));
  assert.deepEqual([...ids],['all','invoices','purchases','bank','accounting','automation','reports','closing','payroll','inventory']);
  assert.equal(catalog.guides.length>=15,true);
  const seen=new Set();
  for(const guide of catalog.guides){
    assert.ok(!seen.has(guide.id),guide.id);
    seen.add(guide.id);
    assert.ok(ids.has(guide.process),guide.process);
    assert.match(guide.route,/^[a-z-]+\.html$/);
    assert.ok(fs.existsSync(path.join(root,'apps/portal',guide.route)),guide.route);
    assert.equal(guide.steps.length,3);
    assert.ok(guide.keywords.length>8);
  }
  for(const process of ids)if(process!=='all')assert.ok(catalog.guides.some(guide=>guide.process===process));
});

test('Swedish questions give deterministic useful process-specific results',()=>{
  assert.equal(catalog.search('Jag har en oplacerad betalning')[0].id,'unplaced-payments');
  assert.equal(catalog.search('Kan jag förbereda bokslut?')[0].id,'close-year');
  assert.equal(catalog.search('Jag vill lämna kvitto')[0].id,'receipts');
  assert.equal(catalog.search('Vad händer med momsen?').some(item=>item.id==='vat'),true);
  assert.equal(catalog.search('Löneunderlag','payroll')[0].id,'payroll');
  assert.deepEqual(catalog.search('zzzuniquewordzzz'),[]);
  assert.equal(catalog.scope('../../other.html'),'all');
  assert.equal(catalog.contextForPage('https://not-our-domain.example/other.html'),'all');
  assert.equal(catalog.contextForPage('bokslut.html'),'closing');
  assert.equal(catalog.contextForPage('/portal/unplaced-payments.html?demo=1'),'bank');
  assert.equal(catalog.contextForPage('bank.html'),'bank');
});

test('assistant entry point is permission-filtered and available in simple and advanced menu',()=>{
  for(const role of ['admin','accountant','approver','readonly']){
    const permissions=policy.roles.find(item=>item.id===role).permissions;
    const groups=navigation.visibleGroups({authenticated:true,permissions});
    assert.ok(groups.flatMap(group=>group.items).some(item=>item[0]==='ai-assistant'),role);
    assert.ok(navigation.simpleGroups(groups).flatMap(group=>group.items).some(item=>item[0]==='ai-assistant'),role);
  }
  assert.equal(navigation.visibleGroups().length,0);
  assert.match(navSource,/'ai-assistant':'reports\.view'/);
  assert.match(navSource,/assistantHrefForCurrentPage/);
  assert.match(navSource,/shared-ai-trigger/);
  assert.match(navSource,/context\.groups\.some/);
  assert.match(sharedCss,/\.shared-ai-trigger:focus-visible/);
  assert.match(sharedCss,/max-width:760px/);
});

test('demo reads no session or customer information; opens bank-context help',()=>{
  const f=fixture({from:'unplaced-payments.html'});
  assert.equal(f.externalCalls,0);
  assert.match(f.app.innerHTML,/AI-hjälp/);
  assert.match(f.app.innerHTML,/Guidad hjälp aktiv/);
  assert.match(f.app.innerHTML,/inte ett AI-svar/);
  assert.match(f.app.innerHTML,/data-ai-scope="bank" aria-pressed="true"/);
  assert.match(f.results.innerHTML,/Hitta en betalning utan koppling/);
  assert.doesNotMatch(f.results.innerHTML,/Förbered lönerna/);
  assert.match(f.app.innerHTML,/ai-bookkeeping\.html\?demo=1/);
});

test('local query updates the guide cards without ever calling any model',()=>{
  const f=fixture({from:'bokslut.html'});
  f.callbacks.input({target:{id:'ai-assistant-query',value:'Jag behöver hjälp med årsbokslut'}});
  assert.match(f.results.innerHTML,/Förbered företagets bokslut/);
  assert.doesNotMatch(f.results.innerHTML,/Skapa och skicka en kundfaktura/);
  assert.equal(f.externalCalls,0);
  f.callbacks.input({target:{id:'ai-assistant-query',value:'<img src=x onerror=alert(1)>'}});
  assert.doesNotMatch(f.results.innerHTML,/<img/);
  assert.equal(f.externalCalls,0);
});

test('readonly can read appropriate local guidance but never sees restricted work',async()=>{
  const f=fixture({demo:false,role:'readonly'});
  await settle();
  assert.equal(f.externalCalls,1);
  assert.match(f.app.innerHTML,/data-ai-scope="all"/);
  assert.doesNotMatch(f.app.innerHTML,/data-ai-scope="payroll"/);
  assert.doesNotMatch(f.app.innerHTML,/ai-bookkeeping\.html/);
  assert.doesNotMatch(f.results.innerHTML,/Förbered lönerna/);
  assert.doesNotMatch(f.results.innerHTML,/Stäm av banken/);
  f.callbacks.input({target:{id:'ai-assistant-query',value:'kvitto'}});
  assert.match(f.results.innerHTML,/Lämna in kvitton/);
});

test('invalid session cannot render protected assistant and redirects to login',async()=>{
  const f=fixture({demo:false,authenticated:false});
  await settle();
  assert.equal(f.redirect,'./index.html');
  assert.doesNotMatch(f.app.innerHTML,/ai-assistant-card/);
});

test('guidance search stays offline while optional synthetic pilot is strictly scoped',()=>{
  assert.match(html,/ai-process-guides\.js/);
  assert.match(html,/supabase-session\.js/);
  assert.match(html,/portal-nav\.js/);
  assert.match(html,/ai-assistant\.js/);
  assert.doesNotMatch(script,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(script,/\bfetch\s*\(|\.rpc\s*\(/);
  assert.match(script,/\.functions\.invoke\('ai-bookkeeping-pilot'/);
  assert.match(script,/const requestId='ai-finance-'\+crypto\.randomUUID\(\)/);
  assert.match(script,/validatedPilotResult\(response,requestId/);
  assert.doesNotMatch(script,/localStorage|sessionStorage/);
  assert.match(script,/inte ett AI-svar/);
  assert.match(css,/@media\(max-width:780px\)/);
  assert.match(css,/:focus-visible/);
});
