'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const engine=require('../apps/portal/ai-posted-history.js');

const COMPANY='tenant-a',SUPPLIER='supplier-1';
const sha=n=>n.toString(16).padStart(64,'0');
const source=overrides=>({
  id:'invoice-new',company_id:COMPANY,supplier_id:SUPPLIER,
  supplier_invoice_number:'INV-NEW-01',invoice_date:'2026-10-15',
  due_date:'2026-11-15',status:'registered',currency:'SEK',
  vat_treatment:'se-domestic-full-input-vat',
  total_ore:12500,vat_ore:2500,coding_json:[],
  pdf_sha256:sha(10),approved_at:null,approved_by:null,
  liability_accounting_entry_id:null,liability_posted_at:null,...overrides
});
const document=overrides=>({
  id:'document-new',company_id:COMPANY,source_id:'invoice-new',
  source_type:'supplier-invoice',mime_type:'application/pdf',
  sha256:sha(10),object_path:'tenant-a/invoice-new.pdf',size_bytes:300,...overrides
});
const history=(n,overrides={})=>({
  id:'invoice-old-'+n,company_id:COMPANY,supplier_id:SUPPLIER,
  supplier_invoice_number:'INV-OLD-'+n,
  status:'approved',currency:'SEK',vat_treatment:'se-domestic-full-input-vat',
  total_ore:12500,vat_ore:2500,coding_json:[
    {account:'6540',debitOre:10000,creditOre:0},
    {account:'2641',debitOre:2500,creditOre:0},
    {account:'2440',debitOre:0,creditOre:12500}
  ],
  pdf_sha256:sha(n),coding_sha256:sha(n+50),
  approved_at:'2026-10-01T12:00:00Z',approved_by:'reviewer-a',
  liability_accounting_entry_id:'journal-'+n,liability_posted_at:'2026-10-02T12:00:00Z',
  ...overrides
});
const list=()=>[source(),history(1),history(2),history(3)];
const args=(changes={})=>({companyId:COMPANY,source:source(),document:document(),invoices:list(),...changes});
const suggest=changes=>engine.recommendStoredInvoice(args(changes));
const draft=(account='6540',changes={})=>engine.buildStoredReview({...args(changes),expenseAccount:account});
const no=kind=>assert.equal(kind.status,'no-suggestion');

test('only three uniquely hashed attested and posted originals create a suggestion for same supplier and tax rate',()=>{
  const result=suggest();
  assert.equal(result.status,'suggested');assert.equal(result.account,'6540');assert.equal(result.sampleCount,3);
  assert.equal(result.requiresHumanApproval,true);assert.equal(result.saved,false);
  assert.equal(result.posted,false);assert.equal(result.aiGenerated,false);
  const review=draft(result.account);
  assert.equal(review.status,'manual-review');
  assert.deepEqual(review.lines.map(row=>[row.account,row.debitOre,row.creditOre]),[
    ['6540',10000,0],['2641',2500,0],['2440',0,12500]
  ]);
  assert.equal(review.lines.reduce((sum,row)=>sum+row.debitOre-row.creditOre,0),0);
  assert.ok(Object.isFrozen(review.lines));
});

test('tenant crossings and mixed snapshots are blocked before a history suggestion',()=>{
  const wrongInvoice=history(2,{company_id:'tenant-b'});
  no(suggest({invoices:[source(),history(1),wrongInvoice,history(3)]}));
  no(suggest({companyId:'tenant-b'}));no(suggest({document:document({company_id:'tenant-b'})}));
  no(draft('6540',{invoices:[source(),history(1),wrongInvoice,history(3)]}));
});

test('duplicate supplier invoice reference or same original SHA always blocks preview',()=>{
  no(suggest({invoices:[...list(),history(4,{supplier_invoice_number:'inv-new-01'})]}));
  no(draft('6540',{invoices:[...list(),history(4,{supplier_invoice_number:' inv-new-01 '})]}));
  no(suggest({invoices:[...list(),history(4,{supplier_id:'supplier-other',pdf_sha256:sha(10)})]}));
  no(draft('6540',{invoices:[...list(),history(4,{supplier_id:'supplier-other',pdf_sha256:sha(10)})]}));
  assert.equal(suggest({invoices:list()}).status,'suggested','the same source row must not count as a duplicate');
});

test('reference variants matching the database unique key block unsafe historical previews',()=>{
 for(const [reference,oldReference] of [
   ['INV 1001','inv1001'],[' ＩＮＶ１００１ ','INV1001'],
   ['INV\u00a01001','inv 1001']
 ]){
   const incoming=source({supplier_invoice_number:reference});
   const existing=history(4,{supplier_invoice_number:oldReference});
   no(suggest({source:incoming,invoices:[incoming,history(1),history(2),history(3),existing]}));
   no(draft('6540',{source:incoming,invoices:[incoming,history(1),history(2),history(3),existing]}));
 }
 // Different supplier references do not collide on reference alone.
 assert.equal(suggest({invoices:[...list(),history(4,{supplier_id:'unrelated',supplier_invoice_number:'INV-NEW-01'})]}).status,'suggested');
});
test('weak, contradictory or duplicated history yields no automatic account',()=>{
  no(suggest({invoices:list().slice(0,3)}));
  no(suggest({invoices:[...list().slice(0,3),history(3,{coding_json:[
    {account:'6110',debitOre:10000,creditOre:0},{account:'2641',debitOre:2500,creditOre:0},
    {account:'2440',debitOre:0,creditOre:12500}
  ]})]}));
  no(suggest({invoices:[source(),history(1),history(2),history(3,{pdf_sha256:sha(2)})]}));
  no(suggest({invoices:[source(),history(1),history(2),history(3,{approved_by:null})]}));
});

test('unsafe PDF metadata, already coded and posted invoices or invalid VAT fail closed',()=>{
  for(const row of [
    {status:'approved'},{status:'coded'},{currency:'EUR'},
    {vat_treatment:'reverse-charge'},{pdf_sha256:'bad'},
    {coding_json:[{account:'4010',debitOre:10000,creditOre:0}]},
    {approved_at:'2026-10-15T12:00:00Z'},{liability_posted_at:'2026-10-15T12:00:00Z'},
    {invoice_date:'2026-02-30'},{vat_ore:1700},{total_ore:-1}
  ]){no(suggest({source:source(row)}));no(draft('6540',{source:source(row)}));}
  for(const doc of [
    {sha256:sha(11)},{source_id:'other'},{company_id:'tenant-b'},
    {source_type:'receipt'},{mime_type:'image/png'},{object_path:''},{size_bytes:10485761}
  ]){no(suggest({document:document(doc)}));no(draft('6540',{document:document(doc)}));}
});

test('manual review only accepts listed BAS accounts and requires source/tenant checks',()=>{
  for(const account of ['4010','6110','5460','6540']){
    const item=draft(account);assert.equal(item.status,'manual-review');
    assert.equal(item.lines[0].account,account);assert.equal(item.requiresHumanApproval,true);
    assert.equal(item.saved,false);assert.equal(item.posted,false);
  }
  for(const account of ['1930','2440','2641','9999','__proto__',''])no(draft(account));
  no(draft('4010',{invoices:new Array(200).fill(source())}));
});

test('live payables page loads shared history and never grants AI direct posting',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.js'),'utf8');
  assert.match(html,/ai-posted-history\.js/);
  assert.ok(html.indexOf('ai-posted-history.js')<html.indexOf('payables.js'));
  assert.match(js,/recommendStoredInvoice/);assert.match(js,/buildStoredReview/);
  assert.match(js,/data-action="manual-coding"/);assert.doesNotMatch(js,/confidence:\.94/);
  assert.match(js,/save_supplier_invoice_coding/);assert.match(js,/approve_supplier_invoice/);
  assert.match(js,/post_supplier_invoice_liability/);
  assert.doesNotMatch(js,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
});

// Executes the actual portal script with synthetic, independently cloned reads.
// Every write/network escape is counted BEFORE throwing, even if UI code catches
// the error. These tests do not claim to verify hosted Auth, RLS or MFA.
function liveUi(rows=list(),docs=[document()],opts={}){
  const script=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.js'),'utf8');
  const handlers={},attempts=[],reads=[],heldContexts=[],heldReads=[];
  const app={innerHTML:'',insertAdjacentHTML(position,html){this.innerHTML+=html;}};
  let account='4010',contextCalls=0,editorLines=[];
  let ctx={authenticated:true,company:{id:COMPANY,name:'Testforetaget AB'},
    authUser:{id:'synthetic-user-a'},user:{displayName:'Synthetic reviewer'},
    membership:{role:'accountant'},accessToken:'synthetic-token',...opts.ctx};
  const available={suppliers:[{id:SUPPLIER,company_id:COMPANY,name:'Synthetic supplier'}],
    supplier_invoices:rows,documents:docs,supplier_payments:[],financial_batches:[],...opts.tables};
  const deny=kind=>(...values)=>{attempts.push({kind,values});throw new Error('Unexpected mutation: '+kind);};
  const query=(table,token)=>{
    assert.ok(Object.hasOwn(available,table),table);
    return{insert:deny('insert'),update:deny('update'),delete:deny('delete'),upsert:deny('upsert'),
      select:async(cols,filters)=>{
        assert.equal(token,'synthetic-token');assert.match(filters,/^company_id=eq\.tenant-[ab](?:&|$)/);
        reads.push({table,filters});
        const result=structuredClone(available[table]);
        const index=heldReads.findIndex(item=>item.table===table);
        if(index!==-1){const held=heldReads.splice(index,1)[0];await held.promise;}
        return result;
      }};
  };
  const Queue={filterInvoices:items=>items,
    summarizeInvoices:items=>({overdueCount:0,overdueOre:0,
      counts:{open:items.length,coding:0,approval:0,all:items.length}}),daysPastDue:()=>0};
  const doc={getElementById:id=>id==='payables-app'?app:
      id==='payables-manual-cost-account'?{value:account}:null,
    querySelector:selector=>{
      const match=/^\[data-line="(\d+)"\]\[data-field="(\w+)"\]$/.exec(selector);
      if(!match)return null;
      const value=editorLines[Number(match[1])]?.[match[2]];
      return {value:match[2].endsWith('Ore')?String(Number(value||0)/100):String(value||'')};
    },
    querySelectorAll:selector=>selector==='[data-line][data-field="account"]'?editorLines.map(()=>({})):[],
    addEventListener:(name,callback)=>{handlers[name]=callback}};
  const storage={getItem:()=>null,setItem:deny('storage.setItem'),removeItem:deny('storage.removeItem')};
  const sandbox=vm.createContext({document:doc,
    window:{LTSupabaseUat:{context:async()=>{
      const number=++contextCalls;
      const result=structuredClone(opts.contextTransform?opts.contextTransform(ctx,number):ctx);
      const held=heldContexts.shift();if(held)await held.promise;
      return result;
    }},LTSupabase:{from:query,rpc:deny('rpc'),functions:{invoke:deny('edge')},
      storage:{download:deny('download'),upload:deny('upload')}},LTStudioPostedHistory:engine},
    globalThis:{RollandsPayablesQueue:Queue},sessionStorage:storage,localStorage:storage,
    fetch:deny('fetch'),location:{hostname:'ludwigberglund-coder.github.io',search:'',
      pathname:opts.ledger?'/portal/supplier-ledger.html':'/portal/payables.html',href:''},
    URLSearchParams,Intl,Map,Set,Number,Boolean,JSON,Object,Error,String,Array,
    console:{error:()=>{}},structuredClone,requestAnimationFrame:callback=>callback(),
    setTimeout:()=>1,clearTimeout:()=>{}});
  vm.runInContext(script,sandbox,{filename:'payables.js'});
  const run=code=>vm.runInContext(code,sandbox);
  const hold=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
  const click=async action=>handlers.click({target:{matches:()=>false,
    closest:selector=>selector==='[data-action]'?{dataset:{action}}:null}});
  return {app,click,reads,attempts,available,
    settle:async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));},
    choose:id=>{sandbox.wantedId=id;return run('chooseInvoice(wantedId)');},
    reload:()=>run('loadSupabasePayables(selected?.id||"")'),
    state:()=>JSON.parse(run('JSON.stringify({selected,invoices,supplierSourceRows,codingDirty,suggestionMeta,session,draftCount:supplierReviewDrafts.size})')),
    setAccount:value=>{account=value;},setContext:changes=>{ctx={...ctx,...changes};},
    holdContext:()=>{const held=hold();heldContexts.push(held);return held.release;},
    holdRead:table=>{const held=hold();heldReads.push({...held,table});return held.release;},
    edit:lines=>{editorLines=structuredClone(lines);
      handlers.input({target:{matches:selector=>selector==='[data-line][data-field]'}});run('render()');},
    get writes(){return attempts.length;}
  };
}
const secondSource=()=>source({id:'invoice-second',supplier_invoice_number:'INV-NEW-02',pdf_sha256:sha(20)});
const secondDocument=()=>document({id:'document-second',source_id:'invoice-second',sha256:sha(20),object_path:'tenant-a/second.pdf'});
const twoInvoices=()=>[source(),secondSource(),history(1),history(2),history(3)];
const twoDocuments=()=>[document(),secondDocument()];
const editedLines=()=>[{account:'6110',text:'Manual review',debitOre:10000,creditOre:0},
  {account:'2641',text:'VAT',debitOre:2500,creditOre:0},
  {account:'2440',text:'Liability',debitOre:0,creditOre:12500}];
const assertNoDraft=u=>{assert.equal(u.state().selected?.coding?.length||0,0);assert.equal(u.writes,0);};

test('opening a safe invoice automatically prepares an unsaved history draft without mutating source snapshots',async()=>{
  const rows=list(),before=structuredClone(rows),u=liveUi(rows);await u.settle();
  assert.match(u.app.innerHTML,/Stöd från 3 tidigare bokförda original/);
  assert.match(u.app.innerHTML,/Historikbaserat granskningsutkast är förberett automatiskt/);
  assert.match(u.app.innerHTML,/Ej sparat eller bokfört/);
  assert.equal(u.state().selected.coding[0].account,'6540');
  assert.equal(u.state().codingDirty,true);
  assert.equal(u.state().invoices[0].coding.length,0);
  assert.deepEqual(u.state().supplierSourceRows,before);assert.deepEqual(rows,before);
  assert.equal(u.reads.length,5);assert.equal(u.writes,0);
});

test('invoice selection automatically prepares the next safe draft and preserves edited drafts on return',async()=>{
  const u=liveUi(twoInvoices(),twoDocuments());await u.settle();
  u.edit(editedLines());await u.choose('invoice-second');
  assert.equal(u.state().selected.id,'invoice-second');assert.equal(u.state().selected.coding[0].account,'6540');
  await u.choose('invoice-new');
  assert.equal(u.state().selected.coding[0].account,'6110');
  assert.equal(u.state().selected.coding[0].text,'Manual review');
  await u.click('suggest-coding');await u.click('manual-coding');
  assert.equal(u.state().selected.coding[0].account,'6110');
  assert.equal(u.writes,0);assert.equal(u.reads.length,5);
});

test('existing saved coding is never replaced by automatic or explicit suggestions',async()=>{
  const saved=editedLines();
  const u=liveUi([source({status:'coded',coding_json:saved}),...list().slice(1)]);await u.settle();
  await u.click('suggest-coding');await u.click('manual-coding');
  assert.deepEqual(u.state().selected.coding,saved);assert.equal(u.state().codingDirty,false);assert.equal(u.writes,0);
});

test('unknown supplier coding never guesses 94 percent and supports explicit manual review',async()=>{
  const u=liveUi([source(),history(1),history(2)]);await u.settle();assertNoDraft(u);
  await u.click('suggest-coding');
  assert.match(u.app.innerHTML,/Behöver din hjälp/);assert.match(u.app.innerHTML,/data-manual-review/);
  assert.doesNotMatch(u.app.innerHTML,/94 % säkerhet/);
  u.setAccount('4010');await u.click('manual-coding');
  assert.equal(u.state().selected.coding[0].account,'4010');
  assert.match(u.app.innerHTML,/Manuellt konteringsutkast/);assert.equal(u.writes,0);
});

test('duplicates, unsafe PDF metadata, unsupported VAT and ambiguous originals never prefill the live UI',async()=>{
  const cases=[
    {rows:[...list(),history(4,{supplier_invoice_number:'INV-NEW-01'})]},
    {rows:[...list(),history(4,{supplier_id:'supplier-other',pdf_sha256:sha(10)})]},
    {rows:[source({vat_ore:1700}),...list().slice(1)]},
    {rows:[source({vat_treatment:'reverse-charge'}),...list().slice(1)]},
    {docs:[document({sha256:sha(99)})]},
    {docs:[document({source_id:'wrong-invoice'})]},
    {docs:[document({mime_type:'image/png'})]},
    {docs:[]},
    {docs:[document(),document({id:'another-record',object_path:'tenant-a/copy.pdf'})]}
  ];
  for(const item of cases){
    const u=liveUi(item.rows||list(),item.docs||[document()]);await u.settle();assertNoDraft(u);
    await u.click('suggest-coding');await u.click('manual-coding');assertNoDraft(u);
  }
});

test('all five table results must belong to the selected company before any UI state is published',async()=>{
  for(const table of ['suppliers','supplier_invoices','documents','supplier_payments','financial_batches']){
    const u=liveUi(list(),[document()],{tables:{[table]:[{company_id:'tenant-b',id:'foreign'}]}});
    await u.settle();
    assert.equal(u.state().selected,null);assert.deepEqual(u.state().invoices,[]);
    assert.deepEqual(u.state().supplierSourceRows,[]);assert.equal(u.writes,0);
    assert.doesNotMatch(u.app.innerHTML,/INV-NEW-01/);
  }
});

test('session, token, identity or role changing during load leaves no published invoice snapshot',async()=>{
  for(const changed of [{company:{id:'tenant-b'}},{authenticated:false},
    {authUser:{id:'synthetic-user-b'}},{accessToken:'rotated-token'},{membership:{role:'readonly'}}]){
    const u=liveUi(list(),[document()],{contextTransform:(ctx,n)=>n>1?{...ctx,...changed}:ctx});
    await u.settle();assert.equal(u.state().selected,null);
    assert.deepEqual(u.state().supplierSourceRows,[]);assert.equal(u.writes,0);
    assert.doesNotMatch(u.app.innerHTML,/INV-NEW-01/);
  }
});

test('readonly and approver users receive no draft and missing verified identity stops loading',async()=>{
  for(const role of ['readonly','approver']){
    const u=liveUi(list(),[document()],{ctx:{membership:{role}}});await u.settle();
    await u.click('suggest-coding');await u.click('manual-coding');assertNoDraft(u);
  }
  const u=liveUi(list(),[document()],{ctx:{authUser:null}});await u.settle();
  assert.equal(u.state().selected,null);assert.equal(u.reads.length,0);assert.equal(u.writes,0);
});

test('switching company or personal identity clears all remembered drafts before showing any other invoice',async()=>{
  for(const changed of [{company:{id:'tenant-b'}},{authUser:{id:'synthetic-user-b'}},
    {authenticated:false},{membership:{role:'readonly'}}]){
    const u=liveUi(twoInvoices(),twoDocuments());await u.settle();
    u.edit(editedLines());await u.choose('invoice-second');assert.equal(u.state().draftCount,1);
    u.setContext(changed);await u.choose('invoice-new');
    assert.equal(u.state().selected,null);assert.equal(u.state().draftCount,0);
    assert.deepEqual(u.state().supplierSourceRows,[]);assert.equal(u.writes,0);
  }
});

test('late invoice selection responses cannot replace a newer invoice or erase its edits',async()=>{
  const u=liveUi(twoInvoices(),twoDocuments());await u.settle();
  const release=u.holdContext(),slow=u.choose('invoice-second');
  await u.choose('invoice-old-1');
  assert.equal(u.state().selected.id,'invoice-old-1');
  release();await slow;
  assert.equal(u.state().selected.id,'invoice-old-1');assert.equal(u.writes,0);
});

test('late manual and history responses cannot overwrite a selected invoice or edits made during the request',async()=>{
  for(const action of ['manual-coding','suggest-coding']){
    const u=liveUi(twoInvoices().slice(0,4),twoDocuments());await u.settle();assertNoDraft(u);
    const release=u.holdContext(),slow=u.click(action);
    await u.choose('invoice-second');u.edit(editedLines());release();await slow;
    assert.equal(u.state().selected.id,'invoice-second');assert.equal(u.state().selected.coding[0].account,'6110');
    assert.equal(u.writes,0);
    const v=liveUi(list().slice(0,3));await v.settle();
    const releaseEdit=v.holdContext(),editing=v.click(action);
    v.edit(editedLines());releaseEdit();await editing;
    assert.equal(v.state().selected.coding[0].account,'6110');assert.equal(v.writes,0);
  }
});

test('last explicit manual request wins while an older request remains pending',async()=>{
  const u=liveUi(list().slice(0,3));await u.settle();
  u.setAccount('4010');const release=u.holdContext(),slow=u.click('manual-coding');
  u.setAccount('6110');await u.click('manual-coding');release();await slow;
  assert.equal(u.state().selected.coding[0].account,'6110');assert.equal(u.writes,0);
});

test('a pending reload cannot overwrite manual edits made while database reads are in flight',async()=>{
  const u=liveUi(list().slice(0,3));await u.settle();
  const release=u.holdRead('supplier_invoices'),loading=u.reload();await u.settle();
  u.edit(editedLines());release();await loading;
  assert.equal(u.state().selected.coding[0].account,'6110');assert.equal(u.state().codingDirty,true);
  assert.equal(u.writes,0);
});

test('a slower old load cannot replace a newer verified invoice snapshot',async()=>{
  const u=liveUi(list().slice(0,3));await u.settle();
  const release=u.holdRead('supplier_invoices'),oldLoad=u.reload();await u.settle();
  u.available.supplier_invoices[0]=source({supplier_invoice_number:'NEWER-SNAPSHOT'});
  await u.reload();release();await oldLoad;
  assert.equal(u.state().selected.supplierInvoiceNumber,'NEWER-SNAPSHOT');assert.equal(u.writes,0);
});

test('remembered drafts are invalidated when the source invoice or PDF version changes',async()=>{
  const u=liveUi(twoInvoices(),twoDocuments());await u.settle();
  u.edit(editedLines());await u.choose('invoice-old-1');
  u.available.supplier_invoices[0]=source({pdf_sha256:sha(30)});
  u.available.documents[0]=document({sha256:sha(30)});
  await u.reload();await u.choose('invoice-new');
  assert.equal(u.state().selected.coding[0].account,'6540');
  assert.equal(u.state().selected.documentSha256,sha(30));assert.equal(u.writes,0);
});

test('supplier ledger does not prepare review drafts',async()=>{
  const u=liveUi(twoInvoices(),twoDocuments(),{ledger:true});await u.settle();
  await u.choose('invoice-new');assertNoDraft(u);assert.equal(u.state().codingDirty,false);
});

test('automatic drafts cannot be attested before explicit save and all mutation spies remain silent',async()=>{
  const u=liveUi();await u.settle();
  // Populate the synthetic DOM so this exercises the dirty-draft guard, not
  // merely an empty/unbalanced table. Editing is still entirely local.
  u.edit(u.state().selected.coding);await u.click('approve');
  assert.match(u.app.innerHTML,/Spara konteringen innan fakturan attesteras/);
  assert.equal(u.state().selected.status,'registered');assert.equal(u.writes,0);
});
