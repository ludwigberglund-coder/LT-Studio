'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const reader=require('../apps/portal/ai-document-reader.js');
const review=require('../apps/portal/ai-document-review.js');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'apps/portal/documents.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/portal/documents.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/documents.css'),'utf8');
function pdf(body){
  // PDF text operands need Td moves between rows; otherwise the reader sees one long line.
  const bytes=Buffer.from('BT /F1 12 Tf\n'+body.replace(/\) Tj\n/g,') Tj 0 -18 Td\n')+'\nET','latin1');
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+bytes.length+' >>\nstream\n','latin1'),
    bytes,Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
  ]);
}
const invoice=pdf([
  '(Butik: Testkontor AB) Tj',
  '(Fakturanummer: INV-55) Tj',
  '(Fakturadatum: 2026-10-15) Tj',
  '(Betalas senast: 2026-11-15) Tj',
  '(Netto: 100,00 kr) Tj',
  '(Moms: 25,00 kr) Tj',
  '(Totalt: 125,00 kr) Tj'
].join('\n'));
const receipt=pdf([
  '(Butik: Testbutiken AB) Tj',
  '(Kvittonummer: KV-4) Tj',
  '(Datum: 2026-10-15) Tj',
  '(Totalt: 125,00 kr) Tj',
  '(Varav moms: 25,00 kr) Tj'
].join('\n'));
function fixture({category='supplier-invoice',data=invoice}={}){
  const handlers={};
  const sha256=createHash('sha256').update(data).digest('hex');
  const company='tenant-a-001';
  const path=company+'/documents/doc-a/invoice.pdf';
  const row={id:'doc-a',company_id:company,title:'Underlag A',file_name:'invoice.pdf',
    mime_type:'application/pdf',size_bytes:data.length,sha256,
    category,object_path:path,created_at:'2026-10-15T09:00:00Z'};
  let currentCompany=company,downloads=0,mutations=0,modalOpen=false,modalHtml='';
  const resultNode={_html:'',_text:'',
    get innerHTML(){return this._html},set innerHTML(value){this._html=value;this._text=''},
    get textContent(){return this._text},set textContent(value){this._text=value;this._html=''}
  };
  const expense={value:''},payment={value:''};
  const backdrop={remove:()=>{modalOpen=false},querySelector:s=>s==='.documents-pdf-preview'&&modalOpen?modal:null};
  const modal={dataset:{documentId:'doc-a'},querySelector:s=>({
    '[data-document-expense]':expense,
    '[data-document-payment]':payment,
    '[data-document-review-result]':resultNode
  })[s]||null,closest:s=>s==='.documents-modal-backdrop'?backdrop:null};
  const app={innerHTML:''};
  const doc={
    getElementById:id=>id==='documents-app'?app:null,
    addEventListener:(type,fn)=>{handlers[type]=fn},
    querySelector:s=>s==='.documents-pdf-preview'&&modalOpen?modal:
      s==='.documents-modal-backdrop'&&modalOpen?backdrop:null,
    body:{insertAdjacentHTML:(position,markup)=>{assert.equal(position,'beforeend');modalHtml=markup;modalOpen=true}}
  };
  const ctx=()=>({authenticated:true,company:{id:currentCompany,name:'Test AB'},
    user:{displayName:'Testperson'},authUser:{id:'person-a'},accessToken:'fake-token'});
  const storage={download:async(bucket,objectPath,token)=>{
    assert.equal(bucket,'lt-documents');assert.equal(objectPath,path);assert.equal(token,'fake-token');
    downloads++;return new Blob([data],{type:'application/pdf'});
  },upload:async()=>{mutations++;throw Error('unexpected upload')},
    remove:async()=>{mutations++;throw Error('unexpected delete')}};
  const sandbox={document:doc,window:{LTSupabaseUat:{context:async()=>ctx()},
    LTSupabase:{from:(table,token)=>{
      assert.equal(table,'documents');assert.equal(token,'fake-token');
      return {select:async()=>[row],insert:async()=>{mutations++;throw Error('unexpected insert')},
        update:async()=>{mutations++;throw Error('unexpected update')}};
    },storage},LTStudioDocumentReader:reader,LTStudioDocumentReview:review},
    location:{search:'',hostname:'ludwigberglund-coder.github.io',href:''},
    sessionStorage:{getItem:()=>''},
    URLSearchParams,URL,Blob,File:class extends Blob{
      constructor(parts,name,options){super(parts,options);this.name=name;}
    },crypto:webcrypto,Intl,Date,Number,Object,String,Array,Set,
    fetch:()=>{mutations++;throw Error('unexpected network fetch')},
    requestAnimationFrame:()=>{},setTimeout:()=>{}};
  vm.createContext(sandbox);
  vm.runInContext(script,sandbox,{filename:'documents.js'});
  const click=async(kind)=>{
    const dataKey={'read':'readDocument','preview':'previewDocument','close':'close'}[kind];
    const target={dataset:{[dataKey]:'doc-a'},closest:s=>
      s===(kind==='read'?'[data-read-document]':kind==='preview'?'[data-preview-document]':'button[data-close]')?target:null};
    await handlers.click({target});
  };
  const change=()=>{
    const target={dataset:{},matches:s=>s==='[data-document-expense],[data-document-payment]',
      closest:s=>s==='.documents-pdf-preview'?modal:null};
    handlers.change({target});
  };
  return {click,change,expense,payment,resultNode,row,app,handlers,get modalHtml(){return modalHtml},
    get modalOpen(){return modalOpen},get downloads(){return downloads},get mutations(){return mutations},
    setCompany:id=>{currentCompany=id},
    changeLoadedHash:()=>{vm.runInContext("documents[0].sha256='"+'f'.repeat(64)+"'",sandbox)}};
}
function settle(){return new Promise(resolve=>setImmediate(resolve));}
test('archive includes the same local PDF review module as the AI tab',()=>{
  assert.match(html,/ai-document-reader\.js/);
  assert.match(html,/ai-document-review\.js/);
  assert.match(script,/LTStudioDocumentReview\.buildReview/);
  assert.match(script,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
  assert.match(script,/doc\.objectPath\.startsWith\(String\(ctx\.company\.id\)\+'\/documents\/'\)/);
  assert.match(css,/\.documents-pdf-choices/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.documents-pdf-preview/);
  assert.doesNotMatch(script,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script,/\.functions\.invoke\s*\(/);
});
test('verified archived invoice can show local balanced draft without storing or posting',async()=>{
  const f=fixture();await settle();
  assert.match(f.app.innerHTML,/Läs PDF lokalt/);
  await f.click('read');
  assert.match(f.modalHtml,/data-document-expense/);
  assert.match(f.modalHtml,/data-preview-document="doc-a"/);
  assert.match(f.modalHtml,/Ej bokfört|utan att skickas till AI/);
  assert.equal(f.downloads,1);
  f.expense.value='5460';
  await f.click('preview');
  assert.match(f.resultNode.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(f.resultNode.innerHTML,/5460/);
  assert.match(f.resultNode.innerHTML,/2641/);
  assert.match(f.resultNode.innerHTML,/2440/);
  assert.match(f.resultNode.innerHTML,/125,00/);
  assert.match(f.resultNode.innerHTML,/Ej bokfört · ej sparat/);
  assert.doesNotMatch(f.resultNode.innerHTML,/data-(?:save|post|approve)-document/);
  assert.equal(f.downloads,1);
  assert.equal(f.mutations,0);
  f.expense.value='6540';
  f.change();
  assert.match(f.resultNode.textContent,/Valet har ändrats/);
  assert.doesNotMatch(f.resultNode.innerHTML,/5460/);
  await f.click('preview');
  assert.match(f.resultNode.innerHTML,/6540/);
  assert.doesNotMatch(f.resultNode.innerHTML,/5460/);
  await f.click('close');
  assert.equal(f.modalOpen,false);
});
test('receipt requires explicit account and payment before showing a draft',async()=>{
  const f=fixture({category:'receipt',data:receipt});await settle();
  await f.click('read');
  assert.match(f.modalHtml,/Välj betalningssätt/);
  await f.click('preview');
  assert.match(f.resultNode.textContent,/Välj inköpstyp och hur kvittot betalades/);
  f.expense.value='6110';
  await f.click('preview');
  assert.match(f.resultNode.textContent,/hur kvittot betalades/);
  f.payment.value='1910';
  await f.click('preview');
  assert.match(f.resultNode.innerHTML,/Granskningsutkast – inte AI/);
  assert.match(f.resultNode.innerHTML,/1910/);
  assert.match(f.resultNode.innerHTML,/Netto är beräknat/);
  assert.equal(f.mutations,0);
});
test('changed tenant or altered original hash invalidates existing local review',async()=>{
  const f=fixture();await settle();
  await f.click('read');
  f.expense.value='6110';
  f.setCompany('tenant-b-002');
  await f.click('preview');
  assert.equal(f.modalOpen,false);
  assert.doesNotMatch(f.resultNode.innerHTML,/Granskningsutkast/);
  assert.match(f.app.innerHTML,/Granskningen avbröts/);
  assert.equal(f.mutations,0);
  const g=fixture();await settle();await g.click('read');
  g.expense.value='6110';
  g.changeLoadedHash();
  await g.click('preview');
  assert.equal(g.modalOpen,false);
  assert.equal(g.mutations,0);
});
test('untrusted PDF text is escaped in original fields and never trusted as HTML',async()=>{
  const malicious=pdf([
    '(Butik: <img src=x onerror=alert>) Tj',
    '(Fakturanummer: INV-55) Tj',
    '(Fakturadatum: 2026-10-15) Tj',
    '(Netto: 100,00 kr) Tj',
    '(Moms: 25,00 kr) Tj',
    '(Totalt: 125,00 kr) Tj'
  ].join('\n'));
  const f=fixture({data:malicious});await settle();await f.click('read');
  assert.match(f.modalHtml,/&lt;img src=x onerror=alert&gt;/);
  assert.doesNotMatch(f.modalHtml,/<img src=x onerror/);
  f.expense.value='6110';
  await f.click('preview');
  assert.equal(f.mutations,0);
});
