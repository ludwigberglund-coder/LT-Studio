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
  assert.match(source,/Workflows\.confirmSupplierPayment\(paymentId,reference\)/);
});
