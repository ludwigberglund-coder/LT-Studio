'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const invoiceUi=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.js'),'utf8');

test('kundfakturaformuläret visar bara kundrelevanta datumfält',()=>{
  assert.match(invoiceUi,/Fakturadatum/);
  assert.match(invoiceUi,/Förfallodatum/);
  assert.doesNotMatch(invoiceUi,/field\('Bokföringsdatum','postingDate'/);
});

test('bokföringsdatum följer fakturadatum internt och skickas fortsatt till backend',()=>{
  assert.match(invoiceUi,/draft\.postingDate=draft\.invoiceDate/);
  assert.match(invoiceUi,/postingDate:value\.postingDate/);
});
