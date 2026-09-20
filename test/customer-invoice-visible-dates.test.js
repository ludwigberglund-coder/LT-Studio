'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const invoiceUi=fs.readFileSync(path.join(__dirname,'..','apps','portal','invoices.js'),'utf8');
const pdf=fs.readFileSync(path.join(__dirname,'..','packages','invoicing','pdf.js'),'utf8');

test('kundfakturaformuläret visar inte manuellt bokföringsdatum',()=>{
  assert.match(invoiceUi,/Fakturadatum/);
  assert.match(invoiceUi,/Förfallodatum/);
  assert.doesNotMatch(invoiceUi,/field\('Bokföringsdatum','postingDate'/);
  assert.match(invoiceUi,/draft\.postingDate=draft\.invoiceDate/);
});

test('kundens PDF-faktaruta använder fakturadatum och förfallodatum',()=>{
  assert.match(pdf,/\['Fakturadatum',data\.invoiceDate\]/);
  assert.match(pdf,/\['Förfallodatum',data\.dueDate\]/);
  const publicPart=pdf.split('if(options.internal)')[0];
  assert.doesNotMatch(publicPart,/Bokföringsdatum/);
});
