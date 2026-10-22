'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const reader=require('../apps/portal/ai-document-reader.js');
const {buildReview,rateFor}=require('../apps/portal/ai-document-review.js');
const root=path.join(__dirname,'..');
const appJs=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.js'),'utf8');
const appHtml=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.html'),'utf8');

const source=(rate,kind='supplier-invoice')=>{
  const net=10000,vat=net*rate/100,gross=net+vat;
  const lines=[
    'Leverantör: Test Leverantör AB',
    'Fakturanummer: INV-2026-17',
    'Datum: 2026-10-15',
    'Förfallodatum: 2026-11-15',
    'Netto: '+(net/100).toFixed(2).replace('.',',')+' kr',
    'Moms: '+(vat/100).toFixed(2).replace('.',',')+' kr',
    'Totalt: '+(gross/100).toFixed(2).replace('.',',')+' kr'
  ];
  if(kind==='receipt')lines.splice(4,1);
  return reader.parseFacts(lines.join('\n'),kind);
};

test('creates balanced local preview for 0/6/12/25 percent without posting or model calls',()=>{
  for(const rate of [0,6,12,25]){
    const proposal=buildReview(source(rate),{expenseAccount:'6110'});
    assert.equal(proposal.status,'manual-review');
    assert.equal(proposal.aiGenerated,false);
    assert.equal(proposal.posted,false);
    assert.equal(proposal.saved,false);
    assert.equal(proposal.requiresHumanApproval,true);
    assert.equal(proposal.checks.vatRate,rate);
    assert.equal(proposal.rows.at(-1).account,'2440');
    assert.equal(proposal.rows[0].account,'6110');
    assert.equal(proposal.rows.reduce((s,r)=>s+r.debitOre-r.creditOre,0),0);
    assert.equal(proposal.rows.length,rate===0?2:3);
    assert.ok(Object.isFrozen(proposal.rows));
  }
});
test('receipt needs explicitly selected payment account; derives missing net with warning',()=>{
  const receipt=source(25,'receipt');
  assert.equal(receipt.fields.netOre,null);
  assert.throws(()=>buildReview(receipt,{expenseAccount:'5460'}),{code:'INVALID_PAYMENT_SELECTION'});
  const proposal=buildReview(receipt,{expenseAccount:'5460',paymentAccount:'1930'});
  assert.equal(proposal.status,'manual-review');
  assert.equal(proposal.rows[0].debitOre,10000);
  assert.equal(proposal.rows.at(-1).account,'1930');
  assert.ok(proposal.warnings.some(w=>w.includes('beräknat')));
  assert.ok(proposal.warnings.some(w=>w.includes('inte verifierat')));
  const cash=buildReview(receipt,{expenseAccount:'6540',paymentAccount:'1910'});
  assert.equal(cash.rows.at(-1).account,'1910');
});
test('blocks mismatch, unknown VAT rates, foreign currency, absent source fields and credit',()=>{
  const mismatch=reader.parseFacts('Leverantör: Test AB\nFakturanummer: 12\nDatum: 2026-10-15\nNetto: 100,00 kr\nMoms: 25,00 kr\nTotalt: 140,00 kr','supplier-invoice');
  const a=buildReview(mismatch,{expenseAccount:'6110'});
  assert.equal(a.status,'blocked');assert.equal(a.rows.length,0);
  const unknown=reader.parseFacts('Leverantör: Test AB\nFakturanummer: 12\nDatum: 2026-10-15\nNetto: 100,00 kr\nMoms: 17,00 kr\nTotalt: 117,00 kr','supplier-invoice');
  assert.equal(buildReview(unknown,{expenseAccount:'6110'}).status,'blocked');
  const foreign=reader.parseFacts('Leverantör: Test AB\nFakturanummer: 12\nDatum: 2026-10-15\nNetto: 100,00 kr\nMoms: 25,00 kr\nTotalt: 125,00 kr\nValuta EUR','supplier-invoice');
  assert.equal(buildReview(foreign,{expenseAccount:'6110'}).status,'blocked');
  const missing=reader.parseFacts('Netto: 100,00 kr\nMoms: 25,00 kr\nTotalt: 125,00 kr','supplier-invoice');
  assert.equal(buildReview(missing,{expenseAccount:'6110'}).status,'blocked');
  const credit=reader.parseFacts('Leverantör: Test AB\nDatum: 2026-10-15\nKreditfaktura -125,00 kr','supplier-invoice');
  assert.equal(buildReview(credit,{expenseAccount:'6110'}).status,'blocked');
});
test('does not trust arbitrary client-provided fields, account codes or fake verified status',()=>{
  assert.throws(()=>buildReview({source:'cloudflare',status:'needs-review',posted:false,documentType:'receipt',fields:{},checks:{amountBalance:null},warnings:[]},{expenseAccount:'6110',paymentAccount:'1930'}),{code:'UNTRUSTED_PDF_RESULT'});
  assert.throws(()=>buildReview(source(25),{expenseAccount:'9999'}),{code:'INVALID_ACCOUNT_SELECTION'});
  assert.throws(()=>buildReview(source(25),{expenseAccount:'6110',paymentAccount:'1930'}),{code:'INVALID_PAYMENT_SELECTION'});
  const forged=source(25);
  forged.fields.netOre.verified=true;
  assert.throws(()=>buildReview(forged,{expenseAccount:'6110'}),{code:'UNTRUSTED_PDF_FACT'});
  assert.equal(rateFor(10000,2500),25);
  assert.equal(rateFor(10000,1800),null);
  assert.equal(rateFor(1,0),null); // fail closed on ambiguous rounding
});
test('UI loads preview engine but keeps model disabled, no save/approve button',()=>{
  assert.match(appHtml,/ai-document-reader\.js/);
  assert.match(appHtml,/ai-document-review\.js/);
  assert.match(appJs,/const AI_PILOT_RELEASED = false;/);
  assert.match(appJs,/data-ai-action="preview-pdf"/);
  assert.match(appJs,/Granskningsutkast/);
  assert.doesNotMatch(appJs,/data-ai-action="(?:post-pdf|approve-pdf|save-pdf)"/);
  const engine=fs.readFileSync(path.join(root,'apps/portal/ai-document-review.js'),'utf8');
  assert.doesNotMatch(engine,/\bfetch\s*\(|\.functions\.invoke\s*\(|\.storage\.upload\s*\(|localStorage|sessionStorage/);
});
test('real browser UI flow displays balanced review preview with local PDF facts',async()=>{
  const handlers={};
  const app={innerHTML:''};
  const sandbox={
    document:{getElementById:id=>id==='ai-bookkeeping-app'?app:null,
      addEventListener:(event,fn)=>{handlers[event]=fn}},
    window:{LTStudioDocumentReader:reader,LTStudioDocumentReview:require('../apps/portal/ai-document-review.js')},
    location:{search:'?demo=1',hostname:'ludwigberglund-coder.github.io'},
    URLSearchParams,Intl,Set,Number,Object,Error,String,Array,
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
  };
  vm.runInNewContext(appJs,sandbox);
  const choose=(id,value)=>handlers.change({target:{id,value}});
  const click=action=>handlers.click({target:{closest:selector=>selector==='[data-ai-action]'?
    {disabled:false,dataset:{aiAction:action}}:null}});
  // Use the actual reader in the simulated window to create extracted fields.
  // The file input is supplied as a synthetic file rather than stored anywhere.
  const pdfSource=source(25);
  sandbox.window.LTStudioDocumentReader={readPdf:async()=>pdfSource};
  sandbox.document.getElementById=id=>id==='ai-bookkeeping-app'?app:
    id==='ai-pdf-file'?{files:[{name:'test.pdf',size:128,type:'application/pdf'}]}:null;
  click('read-pdf');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(app.innerHTML,/Visa granskningsutkast/);
  choose('ai-pdf-account','5460');
  click('preview-pdf');
  assert.match(app.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(app.innerHTML,/Förbrukningsmaterial/);
  assert.match(app.innerHTML,/Leverantörsskulder/);
  assert.match(app.innerHTML,/Ej bokfört/);
  assert.doesNotMatch(app.innerHTML,/Godkänn för bokföring/);
});
