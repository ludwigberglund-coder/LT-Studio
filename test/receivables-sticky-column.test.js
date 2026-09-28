'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','styles.css'),'utf8');
const appSource=fs.readFileSync(path.join(__dirname,'..','apps','portal','app.js'),'utf8');
const htmlSource=fs.readFileSync(path.join(__dirname,'..','apps','portal','index.html'),'utf8');

test('kundreskontrans fasta kundkolumn täcker scrollat innehåll utan överlapp',()=>{
  assert.match(source,/\.customer-cell\{position:sticky;left:0;z-index:3;min-width:190px;width:190px;max-width:190px;white-space:normal;background:#fff;/);
  assert.match(source,/\.res-table th\.customer-cell\{z-index:5;background:#f5f7f4\}/);
  assert.match(source,/\.res-table tr\.transaction-row>\.customer-cell\{background:#fbfcfb\}/);
  assert.doesNotMatch(source,/\.customer-cell\{[^}]*background:inherit/);
});


test('kundreskontran använder hela tillgängliga bredden på stora skärmar',()=>{
  assert.match(source,/\.receivables-content\{width:100%;max-width:none;/);
  assert.match(source,/@media\(min-width:1500px\)[\s\S]*\.receivables-content \.res-table\{width:100%;min-width:100%;font-size:11px\}/);
});

test('varje fakturarad har en direkt PDF-knapp med LT Studio-renderaren',()=>{
  assert.match(appSource,/data-action="open-invoice-pdf"/);
  assert.match(appSource,/async function openInvoicePdf\(invoiceId\)/);
  assert.match(appSource,/Pdf\.createInvoicePdf\(documentData,\{record:invoice\}\)/);
  assert.match(appSource,/customer_invoice_documents/);
  assert.match(htmlSource,/shared\/vendor\/pdf-lib\.min\.js/);
  assert.match(htmlSource,/shared\/invoicing\/pdf\.js/);
  assert.match(source,/\.invoice-pdf-button\{/);
});
