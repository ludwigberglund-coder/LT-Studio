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
  liability_accounting_entry_id:null,liability_posted_at:null,
  ...overrides
});
const document=overrides=>({
  id:'document-new',company_id:COMPANY,source_id:'invoice-new',
  source_type:'supplier-invoice',mime_type:'application/pdf',
  sha256:sha(10),object_path:'tenant-a/invoice-new.pdf',size_bytes:300,
  ...overrides
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
const args=(changes={})=>({
  companyId:COMPANY,source:source(),document:document(),invoices:list(),
  ...changes
});
const suggest=changes=>engine.recommendStoredInvoice(args(changes));
const draft=(account='6540',changes={})=>engine.buildStoredReview({...args(changes),expenseAccount:account});
const no=kind=>assert.equal(kind.status,'no-suggestion');

test('only three uniquely hashed attested and posted originals create a suggestion for same supplier and tax rate',()=>{
  const result=suggest();
  assert.equal(result.status,'suggested');
  assert.equal(result.account,'6540');
  assert.equal(result.sampleCount,3);
  assert.equal(result.requiresHumanApproval,true);
  assert.equal(result.saved,false);
  assert.equal(result.posted,false);
  assert.equal(result.aiGenerated,false);
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
  no(suggest({companyId:'tenant-b'}));
  no(suggest({document:document({company_id:'tenant-b'})}));
  no(draft('6540',{invoices:[source(),history(1),wrongInvoice,history(3)]}));
});

test('duplicate supplier invoice reference or same original SHA always blocks preview',()=>{
  no(suggest({invoices:[...list(),history(4,{supplier_invoice_number:'inv-new-01'})]}));
  no(draft('6540',{invoices:[...list(),history(4,{supplier_invoice_number:' inv-new-01 '})]}));
  // Same PDF from another supplier is still a possible duplicate.
  no(suggest({invoices:[...list(),history(4,{supplier_id:'supplier-other',pdf_sha256:sha(10)})]}));
  no(draft('6540',{invoices:[...list(),history(4,{supplier_id:'supplier-other',pdf_sha256:sha(10)})]}));
  assert.equal(suggest({invoices:list()}).status,'suggested','the same source row must not count as a duplicate');
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
  ]){
    no(suggest({source:source(row)}));
    no(draft('6540',{source:source(row)}));
  }
  for(const doc of [
    {sha256:sha(11)},{source_id:'other'},{company_id:'tenant-b'},
    {source_type:'receipt'},{mime_type:'image/png'},{object_path:''},
    {size_bytes:10485761}
  ]){
    no(suggest({document:document(doc)}));
    no(draft('6540',{document:document(doc)}));
  }
});

test('manual review only accepts listed BAS accounts and requires source/tenant checks',()=>{
  for(const account of ['4010','6110','5460','6540']){
    const item=draft(account);
    assert.equal(item.status,'manual-review');
    assert.equal(item.lines[0].account,account);
    assert.equal(item.requiresHumanApproval,true);
    assert.equal(item.saved,false);
    assert.equal(item.posted,false);
  }
  for(const account of ['1930','2440','2641','9999','__proto__','']){
    no(draft(account));
  }
  no(draft('4010',{invoices:new Array(200).fill(source())}));
});

test('live payables page loads shared history and never grants AI direct posting',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.js'),'utf8');
  assert.match(html,/ai-posted-history\.js/);
  assert.ok(html.indexOf('ai-posted-history.js')<html.indexOf('payables.js'));
  assert.match(js,/recommendStoredInvoice/);
  assert.match(js,/buildStoredReview/);
  assert.match(js,/data-action="manual-coding"/);
  assert.doesNotMatch(js,/confidence:\.94/);
  assert.match(js,/save_supplier_invoice_coding/);
  assert.match(js,/approve_supplier_invoice/);
  assert.match(js,/post_supplier_invoice_liability/);
  assert.doesNotMatch(js,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
});

function liveUi(rows=list(),docs=[document()],opts={}){
  const script=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.js'),'utf8');
  const handlers={},app={innerHTML:''};
  let reads=0,writes=0,account='4010',contextCalls=0;
  const ctx={authenticated:true,company:{id:COMPANY,name:'Testföretaget AB'},
    user:{displayName:'Fiktiv testperson'},membership:{role:'accountant'},
    accessToken:'synthetic-token'};
  const available={
    suppliers:[{id:SUPPLIER,company_id:COMPANY,name:'Test Leverantör AB'}],
    supplier_invoices:rows,documents:docs,supplier_payments:[],financial_batches:[]
  };
  const query=(table,token)=>{
    assert.equal(token,'synthetic-token');
    assert.ok(Object.hasOwn(available,table),table);
    return{select:async(cols,filters)=>{
      reads++;
      assert.match(filters,/company_id=eq\.tenant-a/);
      return available[table];
    }};
  };
  const Queue={
    filterInvoices:items=>items,
    summarizeInvoices:items=>({overdueCount:0,overdueOre:0,
      counts:{open:items.length,coding:0,approval:0,all:items.length}}),
    daysPastDue:()=>0
  };
  const doc={
    getElementById:id=>id==='payables-app'?app:
      id==='payables-manual-cost-account'?{value:account}:null,
    querySelector:()=>null,
    addEventListener:(name,callback)=>{handlers[name]=callback}
  };
  const sandbox={
    document:doc,
    window:{
      LTSupabaseUat:{context:async()=>{contextCalls++;return opts.changedContext&&contextCalls>1?
        {...ctx,company:{id:'tenant-b',name:'Other tenant'}}:ctx;}},
      LTSupabase:{from:query},
      LTStudioPostedHistory:engine
    },
    globalThis:{RollandsPayablesQueue:Queue},
    sessionStorage:{getItem:()=>null},
    location:{hostname:'ludwigberglund-coder.github.io',search:'',
      pathname:'/portal/payables.html',href:''},
    URLSearchParams,Intl,Map,Set,Number,Boolean,JSON,Object,Error,String,Array,
    console:{error:()=>{}},structuredClone,requestAnimationFrame:callback=>callback()
  };
  vm.runInNewContext(script,sandbox,{filename:'payables.js'});
  const click=async action=>{
    const target={
      matches:()=>false,
      closest:selector=>selector==='[data-action]'?{dataset:{action}}:null
    };
    await handlers.click({target});
  };
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
  return {app,click,settle,setAccount:value=>{account=value},
    get reads(){return reads},get writes(){return writes}};
}

test('live payables UI picks the historically posted account without saving or posting',async()=>{
  const u=liveUi();await u.settle();
  assert.match(u.app.innerHTML,/Hämta konteringsförslag/);
  await u.click('suggest-coding');await u.settle();
  assert.match(u.app.innerHTML,/Stöd från 3 tidigare bokförda original/);
  assert.match(u.app.innerHTML,/value="6540"/);
  assert.match(u.app.innerHTML,/Historikbaserat utkast är förberett/);
  assert.equal(u.writes,0);
});

test('unknown supplier coding never guesses 94 percent, allows explicit manual selection',async()=>{
  const u=liveUi([source(),history(1),history(2)]);
  await u.settle();
  await u.click('suggest-coding');await u.settle();
  assert.match(u.app.innerHTML,/Behöver din hjälp/);
  assert.match(u.app.innerHTML,/data-manual-review/);
  assert.doesNotMatch(u.app.innerHTML,/94 % säkerhet/);
  u.setAccount('4010');await u.click('manual-coding');await u.settle();
  assert.match(u.app.innerHTML,/value="4010"/);
  assert.match(u.app.innerHTML,/Manuellt konteringsutkast/);
  assert.equal(u.writes,0);
});

test('wrong company session, possible duplicate and unsafe PDF never prefill live accounting',async()=>{
  for(const opts of [
    {rows:list(),docs:[document()],changedContext:true},
    {rows:[...list(),history(4,{supplier_invoice_number:'INV-NEW-01'})],docs:[document()]},
    {rows:list(),docs:[document({sha256:sha(99)})]}
  ]){
    const u=liveUi(opts.rows,opts.docs,opts);
    await u.settle();
    await u.click('suggest-coding');await u.settle();
    assert.doesNotMatch(u.app.innerHTML,/Historikbaserat utkast är förberett/);
    assert.equal(u.writes,0);
  }
});
