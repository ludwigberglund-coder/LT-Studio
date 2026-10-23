'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const reader=require('../apps/portal/ai-document-reader.js');
const review=require('../apps/portal/ai-document-review.js');
const learning=require('../apps/portal/ai-posted-history.js');
const root=path.join(__dirname,'..');
const appJs=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.js'),'utf8');
const appHtml=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.html'),'utf8');
const company='tenant-a';
const supplier='s1';
const lines=[
  'Leverantör: Exempel Kontor AB',
  'Fakturanummer: INV-400',
  'Fakturadatum: 2026-10-15',
  'Förfallodatum: 2026-11-15',
  'Netto: 100,00 kr',
  'Moms 25%: 25,00 kr',
  'Totalt: 125,00 kr'
];
const facts=(rows=lines)=>reader.parseFacts(rows.join('\n'),'supplier-invoice');
const suppliers=[{id:supplier,company_id:company,name:'Exempel Kontor AB'}];
function historical(n,overrides={}){
  const cost=overrides.account||'6540';
  const account=overrides.account;
  const row={
    id:'invoice-'+n,company_id:company,supplier_id:supplier,status:'approved',
    approved_by:'actor-a',approved_at:'2026-10-01T12:00:00Z',
    liability_accounting_entry_id:'journal-'+n,liability_posted_at:'2026-10-02T12:00:00Z',
    pdf_sha256:n.toString(16).padStart(64,'0'),
    coding_sha256:(n+50).toString(16).padStart(64,'0'),
    currency:'SEK',vat_treatment:'se-domestic-full-input-vat',
    total_ore:12500,vat_ore:2500,
    coding_json:[
      {account:cost,debitOre:10000,creditOre:0},
      {account:'2641',debitOre:2500,creditOre:0},
      {account:'2440',debitOre:0,creditOre:12500}
    ]
  };
  delete overrides.account;
  return {...row,...overrides};
}
const history=()=>[historical(1),historical(2),historical(3)];
const suggest=(opts={})=>learning.recommend({companyId:company,extraction:facts(),suppliers,invoices:history(),...opts});
test('read-only learning suggests only from 3 independent human-approved posted originals',()=>{
  const answer=suggest();
  assert.equal(answer.status,'suggested');
  assert.equal(answer.account,'6540');
  assert.equal(answer.sampleCount,3);
  assert.equal(answer.vatRate,25);
  assert.equal(answer.posted,false);
  assert.equal(answer.saved,false);
  assert.equal(answer.aiGenerated,false);
  assert.equal(answer.requiresHumanApproval,true);
  assert.ok(Object.isFrozen(answer));
  assert.match(answer.reason,/attesterade och bokförda/);
});
test('same supplier name in another company never leaks training evidence',()=>{
  const other=history().map(x=>({...x,company_id:'tenant-b',supplier_id:'s-other'}));
  assert.equal(suggest({invoices:other}).status,'no-suggestion');
  assert.equal(suggest({companyId:'tenant-b'}).status,'no-suggestion');
  assert.equal(suggest({suppliers:[...suppliers,{id:'s-other',company_id:'tenant-b',name:'Exempel Kontor AB'}],invoices:other}).status,'no-suggestion');
  const combined=suggest({invoices:[...history().slice(0,2),...other]});
  assert.equal(combined.status,'no-suggestion');
});
test('no fuzzy matching and duplicate supplier names never create a recommendation',()=>{
  assert.equal(suggest({suppliers:[{...suppliers[0],name:'Exempel-Kontor AB'}]}).status,'no-suggestion');
  assert.equal(suggest({suppliers:[...suppliers,{id:'s2',company_id:company,name:'Exempel Kontor AB'}]}).reason,'supplier-not-unique');
  assert.equal(learning.normalizeName('  EXEMPEL  KONTOR AB  '),'exempel kontor ab');
});
test('unapproved, unposted, missing PDF and missing coding hash are excluded',()=>{
  for(const changes of [
    {approved_by:null},{approved_at:null},{liability_accounting_entry_id:null},
    {liability_posted_at:null},{pdf_sha256:null},{coding_sha256:null},
    {currency:'EUR'},{vat_treatment:'reverse-charge'},{status:'registered'}
  ]){
    const rows=history();rows[2]={...rows[2],...changes};
    assert.equal(suggest({invoices:rows}).status,'no-suggestion',JSON.stringify(changes));
  }
});
test('duplicate source PDFs do not count twice; conflicting coding blocks suggestion',()=>{
  const rows=history();rows[2].pdf_sha256=rows[1].pdf_sha256;
  assert.equal(suggest({invoices:rows}).status,'no-suggestion');
  const conflicting=history();conflicting[2]=historical(3,{account:'6110'});
  assert.equal(suggest({invoices:conflicting}).reason,'conflicting-history');
  const samePdfConflict=history();
  samePdfConflict[2]=historical(3,{account:'6110',pdf_sha256:samePdfConflict[1].pdf_sha256});
  assert.equal(suggest({invoices:samePdfConflict}).reason,'conflicting-history');
});
test('invalid and complex ledger rows never count as examples',()=>{
  const rows=history();
  for(const coding of [
    [{account:'6540',debitOre:10000,creditOre:0},{account:'2440',debitOre:0,creditOre:12500}],
    [{account:'6540',debitOre:10000,creditOre:0},{account:'2641',debitOre:2500,creditOre:0},{account:'2990',debitOre:0,creditOre:12500}],
    [{account:'4010',debitOre:10000,creditOre:0},{account:'2641',debitOre:2500,creditOre:0},{account:'2440',debitOre:0,creditOre:12500}],
    [{account:'6540',debitOre:10000,creditOre:0},{account:'2641',debitOre:2500,creditOre:0},{account:'2440',debitOre:0,creditOre:12500},{account:'6110',debitOre:0,creditOre:0}]
  ]){
    rows[2]={...history()[2],coding_json:coding};
    assert.equal(suggest({invoices:rows}).status,'no-suggestion');
  }
});
test('only matching VAT rate counts; unsafe PDFs and credit notes cannot learn',()=>{
  const vat12=historical(4,{total_ore:11200,vat_ore:1200,
    coding_json:[{account:'6540',debitOre:10000,creditOre:0},{account:'2641',debitOre:1200,creditOre:0},{account:'2440',debitOre:0,creditOre:11200}]});
  assert.equal(suggest({invoices:[...history().slice(0,2),vat12]}).status,'no-suggestion');
  const credit=facts(['KREDITFAKTURA',...lines]);
  assert.equal(suggest({extraction:credit}).reason,'unsafe-document');
  const mismatch=facts(lines.map(x=>x.startsWith('Totalt:')?'Totalt: 130,00 kr':x));
  assert.equal(suggest({extraction:mismatch}).reason,'unsafe-document');
  const mixed=facts([...lines,'Momssats: 12%']);
  assert.equal(suggest({extraction:mixed}).reason,'unsafe-document');
  const foreign=facts([...lines,'Valuta: EUR']);
  assert.equal(suggest({extraction:foreign}).reason,'unsafe-document');
  const receipt=reader.parseFacts(lines.join('\n'),'receipt');
  assert.equal(suggest({extraction:receipt}).reason,'unsafe-document');
});
test('a posted invoice with different expense/VAT split cannot be training data',()=>{
  const rows=history();rows[2]={...rows[2],coding_json:[
    {account:'6540',debitOre:11000,creditOre:0},
    {account:'2641',debitOre:1500,creditOre:0},
    {account:'2440',debitOre:0,creditOre:12500}
  ]};
  assert.equal(suggest({invoices:rows}).status,'no-suggestion');
});
test('portal loads learning script and never exposes posting controls or model calls',()=>{
  assert.match(appHtml,/ai-posted-history\.js/);
  assert.match(appJs,/data-ai-action="learn-pdf"/);
  assert.match(appJs,/data-ai-action="use-learned-account"/);
  assert.match(appJs,/liability_posted_at=not\.is\.null/);
  assert.match(appJs,/company_id=eq\./);
  assert.match(appJs,/const AI_PILOT_RELEASED = false;/);
  assert.doesNotMatch(appJs,/data-ai-action="(?:post-pdf|approve-pdf|save-pdf)"/);
  const source=fs.readFileSync(path.join(root,'apps/portal/ai-posted-history.js'),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.functions\.invoke\s*\(|localStorage|sessionStorage/);
});
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
function uiFixture({switchTenant=false,extract=facts(),invoiceHistory=history(),deferInvoice=null}={}){
  const handlers={},app={innerHTML:''};
  const selected={name:'test.pdf',type:'application/pdf',size:300};
  let contexts=0,reads=0,writes=0,readCalls=0;
  const ctx={authenticated:true,company:{id:company,name:'Exempel AB'},membership:{role:'admin'},
    authUser:{id:'actor-a'},accessToken:'synthetic-token',user:{displayName:'Testperson'}};
  const sandbox={
    document:{getElementById:id=>id==='ai-bookkeeping-app'?app:
      id==='ai-pdf-file'?{files:[selected]}:null,
      addEventListener:(name,fn)=>{handlers[name]=fn}},
    window:{
      LTStudioDocumentReader:{readPdf:async()=>{reads++;return typeof extract==='function'?extract(reads):extract;}},
      LTStudioDocumentReview:review,LTStudioPostedHistory:learning,
      LTSupabaseUat:{context:async()=>{contexts++;return switchTenant&&contexts>=3?
        {...ctx,company:{id:'tenant-b',name:'Annat AB'}}:ctx;}},
      LTSupabase:{
        from:(table,token)=>{assert.equal(token,'synthetic-token');assert.ok(['suppliers','supplier_invoices'].includes(table));return {
          select:async(columns,filter)=>{
            readCalls++;assert.match(filter,/company_id=eq\.tenant-a/);
            assert.match(filter,/limit=200/);
            return table==='suppliers'?suppliers:(typeof invoiceHistory==='function'?invoiceHistory():(deferInvoice||invoiceHistory));
          },
          insert:()=>{writes++;throw Error('unexpected insert')},
          update:()=>{writes++;throw Error('unexpected update')}
        }},
        rpc:()=>{writes++;throw Error('unexpected rpc')},
        functions:{invoke:()=>{writes++;throw Error('unexpected model')}
      }}
    },
    location:{search:'',hostname:'ludwigberglund-coder.github.io'},
    URLSearchParams,Intl,Set,Number,Object,Error,String,Array,
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
  };
  vm.runInNewContext(appJs,sandbox);
  const click=action=>handlers.click({target:{closest:selector=>selector==='[data-ai-action]'?
    {disabled:false,dataset:{aiAction:action}}:null}});
  return {app,click,choose:(id,value)=>handlers.change({target:{id,value}}),
    get reads(){return reads},get readCalls(){return readCalls},
    get writes(){return writes},get contexts(){return contexts}};
}
test('after PDF reading, authenticated tenant history automatically prepares a non-postable review',async()=>{
  const u=uiFixture();await settle();
  u.click('read-pdf');await settle();
  assert.equal(u.readCalls,2);
  assert.equal(u.reads,1);
  assert.equal(u.writes,0);
  assert.match(u.app.innerHTML,/Förslag: 6540/);
  assert.match(u.app.innerHTML,/Antal jämförda original: 3/);
  assert.match(u.app.innerHTML,/Utkastet är förberett automatiskt/);
  assert.match(u.app.innerHTML,/<option value="6540" selected>/);
  assert.match(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(u.app.innerHTML,/Ej bokfört · ej sparat/);
  assert.doesNotMatch(u.app.innerHTML,/data-ai-action="(?:post-pdf|approve-pdf|save-pdf)"/);
  assert.doesNotMatch(u.app.innerHTML,/Bokför nu/);
});

test('tenant switch during automatic history fetch fails closed without a draft',async()=>{
  const u=uiFixture({switchTenant:true});await settle();
  u.click('read-pdf');await settle();
  assert.equal(u.readCalls,2);
  assert.equal(u.writes,0);
  assert.doesNotMatch(u.app.innerHTML,/Förslag: 6540/);
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(u.app.innerHTML,/Historiken kunde inte jämföras säkert/);
});

test('insufficient or conflicting posted history cannot create a draft',async()=>{
  for(const invoiceHistory of [
    history().slice(0,2),
    [historical(1),historical(2),historical(3,{account:'6110'})],
    history().map(row=>({...row,company_id:'tenant-b'}))
  ]){
    const u=uiFixture({invoiceHistory});await settle();
    u.click('read-pdf');await settle();
    assert.equal(u.readCalls,2);
    assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
    assert.match(u.app.innerHTML,/Välj vad som köptes/);
    assert.equal(u.writes,0);
  }
});

test('unsafe credits and receipts never cause automatic history requests or posting',async()=>{
  const credit=reader.parseFacts(['KREDITFAKTURA',...lines].join('\n'),'supplier-invoice');
  const a=uiFixture({extract:credit});await settle();
  a.click('read-pdf');await settle();
  assert.equal(a.readCalls,0);
  assert.doesNotMatch(a.app.innerHTML,/Granskningsutkast – inte AI/);
  const receipt=reader.parseFacts(lines.join('\n'),'receipt');
  const b=uiFixture({extract:receipt});await settle();
  b.choose('ai-pdf-type','receipt');
  b.click('read-pdf');await settle();
  assert.equal(b.readCalls,0);
  b.click('preview-pdf');
  assert.match(b.app.innerHTML,/Välj först vad som köptes/);
  assert.equal(a.writes+b.writes,0);
});

test('manual account choice during slow history read wins over later automation',async()=>{
  let release;
  const slow=new Promise(resolve=>{release=resolve;});
  const u=uiFixture({deferInvoice:slow});await settle();
  u.click('read-pdf');await settle();
  assert.match(u.app.innerHTML,/Söker endast bland tidigare/);
  u.choose('ai-pdf-account','6110');
  release(history());await settle();
  assert.match(u.app.innerHTML,/<option value="6110" selected>/);
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  u.choose('ai-pdf-invoice-payment','unpaid');
  u.click('preview-pdf');
  assert.match(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(u.app.innerHTML,/Kontorsmateriel/);
  assert.doesNotMatch(u.app.innerHTML,/Utkastet är förberett automatiskt/);
  assert.equal(u.writes,0);
});

test('re-reading a different PDF suppresses a stale tenant history response',async()=>{
  let release,lookupCount=0;
  const slow=new Promise(resolve=>{release=resolve;});
  const different=reader.parseFacts(lines.map(row=>
    row.startsWith('Leverantör:')?'Leverantör: Ny Leverantör AB':row).join('\n'),'supplier-invoice');
  const u=uiFixture({
    extract:readCount=>readCount===1?facts():different,
    invoiceHistory:()=>++lookupCount===1?slow:history()
  });await settle();
  u.click('read-pdf');await settle();
  u.click('read-pdf');await settle();
  assert.equal(u.reads,2);
  assert.equal(u.readCalls,4);
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(u.app.innerHTML,/Välj vad som köptes/);
  release(history());await settle();
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.doesNotMatch(u.app.innerHTML,/Förslag: 6540/);
  assert.equal(u.writes,0);
});

test('switching PDF document type revokes prior automatic suggestion requests',async()=>{
  let release;
  const slow=new Promise(resolve=>{release=resolve;});
  const u=uiFixture({deferInvoice:slow});await settle();
  u.click('read-pdf');await settle();
  u.choose('ai-pdf-type','receipt');await settle();
  release(history());await settle();
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.doesNotMatch(u.app.innerHTML,/Förslag: 6540/);
  assert.equal(u.writes,0);
});


test('a later weaker history check removes an old automatic accounting preview',async()=>{
  let invoiceRows=history();
  const u=uiFixture({invoiceHistory:()=>invoiceRows});await settle();
  u.click('read-pdf');await settle();
  assert.match(u.app.innerHTML,/Granskningsutkast – inte AI/);
  invoiceRows=history().slice(0,2);
  u.click('learn-pdf');
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  await settle();
  assert.doesNotMatch(u.app.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(u.app.innerHTML,/Välj vad som köptes/);
  assert.equal(u.writes,0);
});
