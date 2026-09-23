'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('UAT portal scripts remain syntactically valid',()=>{
  for(const relative of [
    'apps/portal/app.js',
    'apps/portal/customers.js',
    'apps/portal/invoices.js',
    'apps/portal/suppliers.js',
    'apps/portal/payables.js'
  ]){
    assert.doesNotThrow(()=>new vm.Script(read(relative),{filename:relative}),relative);
  }
});

test('reminder preview only sends client-controlled reminder choices',()=>{
  const source=read('apps/portal/app.js');
  assert.match(source,/const requestOptions=\{sentDate:formValues\.sentDate,includeInterest:formValues\.includeInterest,includeReminderFee:formValues\.includeReminderFee,includeBusinessLatePaymentCompensation:formValues\.includeBusinessLatePaymentCompensation\}/);
  assert.match(source,/reminders\/preview'.*body:requestOptions/s);
  const apiPreview=source.slice(source.indexOf('async function previewReminder'),source.indexOf('function accessRecoveryView'));
  assert.doesNotMatch(apiPreview,/body:options/);
});

test('customer delete and invoice credit use LT Studio modal flows instead of browser dialogs',()=>{
  const customers=read('apps/portal/customers.js');
  const invoices=read('apps/portal/invoices.js');
  const customerDelete=customers.slice(customers.indexOf("const remove=event.target.closest('[data-delete-customer]')"),customers.indexOf("const restore=event.target.closest('[data-restore-customer]')"));
  const creditStart=invoices.indexOf("if(action==='credit-invoice')");
  const creditEnd=invoices.indexOf("if(action==='register-refund')",creditStart);
  const creditFlow=invoices.slice(creditStart,creditEnd);
  assert.match(customers,/function customerDeleteModal\(\)/);
  assert.doesNotMatch(customerDelete,/\bconfirm\s*\(/);
  assert.match(invoices,/function creditInvoiceModal\(\)/);
  assert.match(invoices,/id="credit-invoice-form"/);
  assert.doesNotMatch(creditFlow,/\b(?:confirm|prompt)\s*\(/);
});

test('supplier register exposes a real create flow and payment fields',()=>{
  const source=read('apps/portal/suppliers.js');
  assert.match(source,/data-new-supplier/);
  assert.match(source,/data-form="create"/);
  assert.match(source,/name="bankgiro"/);
  assert.match(source,/name="plusgiro"/);
  assert.match(source,/api\('\/payables\/suppliers',\{method:'POST'/);
});

test('payables actions give visible feedback and receivables search stays below navigation layers',()=>{
  const payables=read('apps/portal/payables.js');
  const styles=read('apps/portal/styles.css');
  assert.match(payables,/Konteringen har sparats\. Fakturan väntar nu på attest\./);
  assert.match(payables,/coding-feedback/);
  assert.match(styles,/\.sidebar\{[^}]*z-index:20/);
  assert.match(styles,/\.topbar\{[^}]*z-index:10/);
  assert.match(styles,/\.receivable-search\{position:relative;z-index:5/);
  assert.match(styles,/@media\(max-width:720px\)\{\s*\.receivable-search\{display:grid/);
});
