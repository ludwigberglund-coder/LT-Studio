'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Invoice=require('../packages/invoicing/invoice.js');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.js'),'utf8');

test('privat kundfakturaportal använder API och bevarar separat GitHub Pages-demo',()=>{
  assert.match(source,/if\(!isDemo\)return privateCustomers/);
  assert.match(source,/api\('\/customer-invoices'\)/);
  assert.match(source,/api\('\/customer-invoices\/config'\)/);
  assert.match(source,/method:'POST'/);
  assert.match(source,/sessionStorage\.getItem\('rollands-csrf'\)/);
  assert.match(source,/issueReady/);
  assert.match(source,/if\(isDemo\)\{/);
  assert.doesNotMatch(source,/Fakturaverktyget är en demo\. Skyddad fakturering kräver anslutning till företagets backend/);
});

test('privat utställning skickar idempotensnyckel och inte redigerbar köpare eller säljare till servern',()=>{
  assert.match(source,/requestId:issueRequestId/);
  assert.match(source,/customerNumber:value\.customerNumber/);
  const payloadSection=source.slice(source.indexOf("const payload={requestId:issueRequestId"),source.indexOf("const created=await api('/customer-invoices'",source.indexOf("const payload={requestId:issueRequestId")));
  assert.doesNotMatch(payloadSection,/buyer:/);
  assert.doesNotMatch(payloadSection,/seller:/);
});


test('kundfakturasidan laddar den gemensamma rollstyrda sidomenyn',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.html'),'utf8');
  assert.match(html,/<script src="\.\/portal-nav\.js"><\/script>/);
  assert.ok(html.indexOf('./portal-nav.js')<html.indexOf('./invoices.js'),'navigationen ska laddas före fakturagränssnittet');
});


test('PDF-utkast kan valideras utan bankgiro men skarp fakturavalidering kräver fortfarande bankgiro',()=>{
  const input={
    customerNumber:'K-1001',
    seller:{
      name:'Rolands Frukt o Grönt Aktiebolag',
      address:'Testgatan 1, 411 01 Göteborg',
      orgNumber:'556406-5059',
      vatNumber:'SE556406505901',
      bankgiro:'',
      taxStatus:''
    },
    buyer:{name:'UAT Testkund AB',address:'Testgatan 1, 411 01 Göteborg',orgNumber:'559999-0001',email:'faktura@uattest.se'},
    invoiceDate:'2026-09-19',
    postingDate:'2026-09-19',
    dueDate:'2026-10-19',
    paymentTermsDays:30,
    currency:'SEK',
    lines:[{description:'UAT fruktlåda',quantity:'1',unit:'st',unitPrice:'100,00',vatTreatment:'se-food',vatRate:'6',revenueAccount:'3053'}]
  };
  assert.throws(()=>Invoice.prepare(input,{requireVatTreatment:true}),/Bankgiro måste vara angivet/);
  const draft=Invoice.prepare(input,{requireVatTreatment:true,requireSellerBankgiro:false});
  assert.equal(draft.invoiceNumber,'UTKAST');
  assert.equal(draft.seller.bankgiro,'');
  assert.equal(draft.vatOre,600);
  assert.equal(draft.totalOre,10600);
});

test('portalen släpper bara bankgirokravet för PDF-utkast, inte för skapa och bokför',()=>{
  assert.match(source,/draftDocument\(\)[\s\S]*requireSellerBankgiro:false/);
  const submitStart=source.indexOf("document.addEventListener('submit'");
  const submitSource=source.slice(submitStart);
  assert.match(submitSource,/if\(!issueReady\)throw new Error/);
  assert.doesNotMatch(submitSource,/requireSellerBankgiro:false/);
});
