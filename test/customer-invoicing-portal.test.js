'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

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
