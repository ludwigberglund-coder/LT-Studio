'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const catalog=require('../apps/portal/ai-process-guides.js');
const source=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/ai-assistant.css'),'utf8');
const nav=fs.readFileSync(path.join(root,'apps/portal/portal-nav.js'),'utf8');
function fixture({demo=false,role='accountant',rows=[],fail=false,authenticated=true}={}){
  let sessions=0,reads=0;
  const queries=[],callbacks={};
  const app={innerHTML:''},result={innerHTML:''},status={textContent:''},queue={textContent:''};
  const counters={open:{textContent:'–'},ready:{textContent:'–'},review:{textContent:'–'}};
  const refresh={disabled:false,setAttribute(name){if(name==='disabled')this.disabled=true;},removeAttribute(name){if(name==='disabled')this.disabled=false;}};
  const context={authenticated,company:{id:'tenant-a-001',name:'Exempelföretag A'},
    membership:{role},user:{displayName:'Fiktiv användare'},accessToken:'not-a-real-token'};
  const sandbox={
    location:{search:demo?'?demo=1':'',hostname:'ludwigberglund-coder.github.io',replace:()=>{}},
    window:{
      LTStudioAiProcessGuides:catalog,
      LTSupabaseUat:{context:async()=>{sessions++;return context}},
      LTSupabase:{from:(table,token)=>{reads++;queries.push({table,token});
        return {select:async(fields,filter)=>{
          queries.push({fields,filter});
          if(fail)throw new Error('hidden database details');
          return typeof rows==='function'?rows():rows;
        }};
      }}
    },
    document:{
      getElementById:id=>({
        'ai-assistant-app':app,'ai-assistant-results':result,
        'ai-assistant-results-status':status,'ai-bookkeeper-queue-status':queue,
        'ai-bookkeeper-open-count':counters.open,'ai-bookkeeper-ready-count':counters.ready,
        'ai-bookkeeper-review-count':counters.review,'ai-bookkeeper-refresh':refresh
      })[id]||null,
      addEventListener:(event,handler)=>{callbacks[event]=handler},
      querySelectorAll:()=>[]
    },
    URLSearchParams,String,Set,Object,Array
  };
  vm.runInNewContext(source,sandbox,{filename:'ai-assistant.js'});
  return {app,result,queue,counters,refresh,context,callbacks,queries,
    clickRefresh(){callbacks.click({target:{closest:selector=>
      selector==='[data-ai-action="refresh-queue"]'?{dataset:{aiAction:'refresh-queue'}}:null}});},
    get sessions(){return sessions},get reads(){return reads}};
}
function settle(){return new Promise(resolve=>setImmediate(resolve))}
test('AI tab prioritizes automated bookkeeping over guides and marks actual readiness honestly',()=>{
  const f=fixture({demo:true});
  assert.match(f.app.innerHTML,/Din bokföring, automatiserad/);
  assert.match(f.app.innerHTML,/Från underlag till färdig bokföring/);
  assert.match(f.app.innerHTML,/Säker pilot · ingen automatbokföring/);
  assert.match(f.app.innerHTML,/AI har ännu inte åtkomst till dina riktiga underlag/);
  assert.match(f.app.innerHTML,/<details class="ai-assistant-guides"/);
  assert.match(f.app.innerHTML,/Guider tillgängliga · AI avstängd/);
  assert.match(f.app.innerHTML,/inte ett AI-svar/);
  assert.equal(f.sessions,0);
  assert.equal(f.reads,0);
});
test('active authorized company sees only its existing read-only automation counts',async()=>{
  const f=fixture({rows:[
    {id:'p1',company_id:'tenant-a-001',status:'ready-for-approval'},
    {id:'p2',company_id:'tenant-a-001',status:'manual-review'},
    {id:'p3',company_id:'tenant-a-001',status:'approved'}
  ]});
  await settle();
  assert.equal(f.sessions,1);
  assert.equal(f.reads,1);
  assert.equal(f.queries[0].table,'automation_proposals');
  assert.equal(f.queries[0].token,'not-a-real-token');
  assert.equal(f.queries[1].fields,'id,company_id,status');
  assert.match(f.queries[1].filter,/^company_id=eq\.tenant-a-001&order=created_at\.desc&limit=500$/);
  assert.match(f.queue.textContent,/2 öppna förslag, varav 1 kräver extra granskning/);
  assert.equal(f.counters.open.textContent,'2');
  assert.equal(f.counters.ready.textContent,'1');
  assert.equal(f.counters.review.textContent,'1');
  assert.equal(f.refresh.disabled,false);
  assert.match(f.app.innerHTML,/Uppdatera köstatus/);
  assert.match(f.queue.textContent,/inte verifierade som AI-genererade eller bokförda/);
  assert.doesNotMatch(f.app.innerHTML,/p1|p2|p3/);
});
test('cross-tenant rows never leak into the summary even if an upstream layer errs',async()=>{
  const f=fixture({rows:[{id:'secret',company_id:'tenant-b-002',status:'ready-for-approval'}]});
  await settle();
  assert.equal(f.reads,1);
  assert.match(f.queue.textContent,/Kunde inte läsa automationskön/);
  assert.equal(f.counters.open.textContent,'–');
  assert.doesNotMatch(f.queue.textContent,/secret|tenant-b-002/);
});
test('readonly users never load the queue or see protected review action',async()=>{
  const f=fixture({role:'readonly'});
  await settle();
  assert.equal(f.sessions,1);
  assert.equal(f.reads,0);
  assert.match(f.app.innerHTML,/Förslagskö kräver bokförings- eller granskningsbehörighet/);
  assert.doesNotMatch(f.app.innerHTML,/data-ai-action="refresh-queue"/);
  assert.doesNotMatch(f.app.innerHTML,/href="\.\/automation\.html"/);
  assert.doesNotMatch(f.app.innerHTML,/ai-bookkeeping\.html/);
});
test('failed database query is shown without private error or fake figures',async()=>{
  const f=fixture({fail:true});
  await settle();
  assert.match(f.queue.textContent,/Kunde inte läsa automationskön/);
  assert.doesNotMatch(f.queue.textContent,/hidden database details/);
});
test('the workspace is read-only and does not release AI posting',()=>{
  assert.match(html,/AI-bokförare/);
  assert.match(nav,/\['ai-assistant','AI-bokförare'/);
  assert.match(source,/loadExistingProposalSummary/);
  assert.doesNotMatch(source,/\bfetch\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.functions\.invoke\s*\(/);
  assert.doesNotMatch(source,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);
  assert.match(css,/\.ai-bookkeeper-workspace/);
  assert.match(css,/@media\(max-width:780px\)/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.ai-bookkeeper-workspace/);
});

test('collapsed guide filters are hidden and have accessible labels',()=>{
  assert.match(css,/\.ai-assistant-guides:not\(\[open\]\)>section\{display:none!important\}/);
  assert.match(source,/aria-label=\"Visa guider för /);
});
