'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const payablesPath=path.join(root,'apps','portal','payables.js');
const htmlPath=path.join(root,'apps','portal','payables.html');
const legacyFlowPath=path.join(root,'apps','portal','payables-accounting-flow.js');

test('leverantörsbetalningsportalen använder confirm-post direkt utan fetch-omskrivning',()=>{
  const source=fs.readFileSync(payablesPath,'utf8');
  const html=fs.readFileSync(htmlPath,'utf8');
  assert.match(source,/\/payables\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/confirm-post/);
  assert.doesNotMatch(source,/globalThis\.fetch\s*=/);
  assert.doesNotMatch(source,/\/payables\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/confirm(?:[`'"?\s,)])/);
  assert.doesNotMatch(html,/payables-accounting-flow\.js/);
  assert.equal(fs.existsSync(legacyFlowPath),false);
});

test('payables.js använder gemensamma demo-workflows för leverantörsbetalning',()=>{
  const source=fs.readFileSync(payablesPath,'utf8');
  assert.match(source,/Workflows\.postSupplierInvoice\(selected\.id\)/);
  assert.match(source,/Workflows\.prepareSupplierPayment\(selected\.id\)/);
  assert.match(source,/Workflows\.releaseSupplierPayment\(paymentId\)/);
  assert.match(source,/Workflows\.confirmSupplierPayment\(paymentId,safeReference\)/);
  assert.match(source,/function paymentConfirmationModal/);
});

test('leverantörsfakturans detaljvy visar både fakturadatum och förfallodatum',()=>{
  const source=fs.readFileSync(payablesPath,'utf8');
  assert.match(source,/<span>Fakturadatum<\/span><strong>\$\{esc\(selected\.invoiceDate\)\}<\/strong>/);
  assert.match(source,/<span>Förfallodatum<\/span><strong>\$\{esc\(selected\.dueDate\)\}<\/strong>/);
});

test('leverantörsfakturasidan versionsmärker huvudskriptet för att undvika gammal cache',()=>{
  const html=fs.readFileSync(htmlPath,'utf8');
  assert.match(html,/src="\.\/payables\.js\?v=20260924-1"/);
});

test('leverantörsfakturalistan visar fakturadatum och förfallodatum sida vid sida',()=>{
  const source=fs.readFileSync(payablesPath,'utf8');
  assert.match(source,/<th>Fakturadatum<\/th><th>Förfallodatum<\/th>/);
  assert.match(source,/\$\{esc\(invoice\.invoiceDate\)\}<\/td><td>\$\{esc\(invoice\.dueDate\)\}/);
  assert.match(source,/colspan="6" class="empty">Inga fakturor matchar filtret\./);
});
