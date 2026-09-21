'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Invoice=require('../packages/invoicing/invoice.js');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.js'),'utf8');
const customersSource=fs.readFileSync(path.join(__dirname,'..','apps','portal','customers.js'),'utf8');

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
  const issueStart=source.indexOf('async function issueInvoice()');
  const issueEnd=source.indexOf('function refreshAccounts',issueStart);
  const issueSource=source.slice(issueStart,issueEnd);
  assert.match(issueSource,/if\(!issueReady\)throw new Error/);
  assert.doesNotMatch(issueSource,/requireSellerBankgiro:false/);
});

test('kundfaktura kan bara ställas ut med uttryckligt knappklick, aldrig via Enter eller form-submit',()=>{
  assert.match(source,/type="button" data-action="issue-invoice"/);
  assert.match(source,/if\(action==='issue-invoice'\)\{await issueInvoice\(\);return;\}/);
  assert.match(source,/event\.key!=='Enter'/);
  assert.match(source,/Enter ställer inte ut fakturan/);
  const submitStart=source.indexOf("document.addEventListener('submit'");
  const submitEnd=source.indexOf('async function refreshPrivateCustomers',submitStart);
  const submitSource=source.slice(submitStart,submitEnd);
  assert.match(submitSource,/event\.preventDefault\(\)/);
  assert.doesNotMatch(submitSource,/api\('\/customer-invoices'/);
});

test('kreditknappen beskriver att originalfakturan både krediteras och kvittas',()=>{
  assert.match(source,/Kreditera & kvitta/);
});


test('privat utkast sparas via API i stället för endast i webbläsarsessionen',()=>{
  assert.match(source,/api\('\/customer-invoices\/draft'\)/);
  assert.match(source,/api\('\/customer-invoices\/draft',\{method:'PUT'/);
  assert.match(source,/privateDraftRecord/);
  assert.match(source,/Utkastet är sparat i företagets privata databas/);
  assert.doesNotMatch(source,/sessionStorage\.setItem\(LEGACY_PRIVATE_DRAFT_KEY/);
  assert.match(source,/readLegacyPrivateDraft/);
});


test('kunduppgifter på fakturan är låsta till kundregistret',()=>{
  assert.match(source,/buyerFromCustomer\(number\)/);
  assert.match(source,/value\.buyer=buyerFromCustomer\(value\.customerNumber\)/);
  assert.match(source,/syncDraftBuyer\(\)/);
  assert.match(source,/readonlyField\('Företagsnamn - kund',draft\.buyer\.name\)/);
  assert.match(source,/readonlyField\('Organisationsnummer - kund',draft\.buyer\.orgNumber\)/);
  assert.match(source,/readonlyField\('Fakturaadress, postnummer och ort - kund',draft\.buyer\.address,true,true\)/);
  assert.match(source,/readonlyField\('Mottagarens e-post - kund',draft\.buyer\.email\)/);
  assert.match(source,/customers\.html\?customer=/);
  assert.doesNotMatch(source,/field\('Företagsnamn - kund','buyer\.name'/);
  assert.doesNotMatch(source,/field\('Fakturaadress, postnummer och ort - kund','buyer\.address'/);
  assert.match(source,/refreshPrivateCustomers\(\)/);
});

test('kundregistret kan öppna och uppdatera befintlig kund',()=>{
  assert.match(customersSource,/data-edit-customer=/);
  assert.match(customersSource,/method:updating\?'PUT':'POST'/);
  assert.match(customersSource,/requestedCustomer\(\)/);
  assert.match(customersSource,/new URLSearchParams\(location\.search\)\.get\('customer'\)/);
  assert.match(customersSource,/updating\?'uppdaterad':'sparad'/);
  assert.match(customersSource,/i den privata databasen/);
});


test('ändra kund från faktura stannar i samma webbläsarsession och bevarar utkastet',()=>{
  assert.match(source,/data-action="edit-customer-register"/);
  assert.doesNotMatch(source,/customers\.html\?customer=[\s\S]{0,200}target="_blank"/);
  const start=source.indexOf("if(action==='edit-customer-register')");
  const end=source.indexOf("if(action==='save-draft')",start);
  const flow=source.slice(start,end);
  assert.match(flow,/readForm\(\)/);
  assert.match(flow,/api\('\/customer-invoices\/draft',\{method:'PUT'/);
  assert.match(flow,/dirty=false/);
  assert.match(flow,/location\.href=url\('\.\/customers\.html\?customer='/);
  assert.match(flow,/return=invoice/);
  assert.match(source,/get\('resume'\)==='1'/);
  assert.match(source,/if\(resume\)\{draft=freshDraft\(\);view='edit';\}/);

  assert.match(customersSource,/function returnToInvoice\(\)/);
  assert.match(customersSource,/function resumeInvoice\(\)/);
  assert.match(customersSource,/invoices\.html\?resume=1/);
  assert.match(customersSource,/if\(updating&&returnToInvoice\(\)\)\{resumeInvoice\(\);return;\}/);
});
