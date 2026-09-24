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
    'apps/portal/payables.js',
    'apps/portal/payments.js',
    'apps/portal/reports.js',
    'apps/portal/bank.js',
    'apps/portal/documents.js'
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
  const confirmIndex=customerDelete.indexOf("const confirmDelete=event.target.closest('[data-customer-delete-confirm]')");
  const cancelIndex=customerDelete.indexOf("const cancelDelete=event.target.closest('button[data-customer-delete-cancel]')");
  assert.ok(confirmIndex>=0&&cancelIndex>confirmIndex,'Bekräfta måste hanteras före avbryt');
  assert.match(customerDelete,/event\.target\.matches\?\.\('\.modal-backdrop\[data-customer-delete-cancel\]'\)/);
  assert.doesNotMatch(customerDelete,/event\.target\.closest\('\[data-customer-delete-cancel\]'\)/);
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
  assert.match(payables,/scrollIntoView/);
  assert.match(styles,/\.sidebar\{[^}]*z-index:20/);
  assert.match(styles,/\.topbar\{[^}]*z-index:10/);
  assert.match(styles,/\.receivable-search\{position:relative;z-index:5/);
  assert.match(styles,/@media\(max-width:720px\)\{\s*\.receivable-search\{display:grid/);
});


test('supplier register offers prefix-search dropdown, save toast and customer-style layout',()=>{
  const source=read('apps/portal/suppliers.js');
  const css=read('apps/portal/suppliers.css');
  assert.match(source,/function supplierMatchesPrefix/);
  assert.match(source,/\.startsWith\(q\)/);
  assert.match(source,/role="combobox"/);
  assert.match(source,/role="listbox"/);
  assert.match(source,/data-supplier-suggestion/);
  assert.match(source,/ArrowDown/);
  assert.match(source,/ArrowUp/);
  assert.match(source,/supplier-toast/);
  assert.match(source,/Sparad/);
  assert.match(source,/supplier-page-head/);
  assert.match(source,/Leverantörsregister & betalningsuppgifter/);
  assert.match(css,/\.supplier-search-results/);
  assert.match(css,/@keyframes supplier-search-open/);
  assert.match(css,/\.supplier-toast/);
  assert.match(css,/@keyframes supplier-toast-in/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});


test('every portal search box exposes an interactive dropdown contract',()=>{
  const portalDir=path.join(root,'apps','portal');
  const files=fs.readdirSync(portalDir).filter(name=>/\.(?:js|html)$/.test(name));
  const searchFiles=[];
  for(const name of files){
    const relative=path.join('apps','portal',name);
    const source=read(relative);
    if(!/type=["']search["']/i.test(source))continue;
    searchFiles.push(name);
    assert.match(source,/role=["']combobox["']/i,`${name} search must expose a combobox`);
    assert.match(source,/role=["']listbox["']/i,`${name} search must expose a dropdown listbox`);
    assert.match(source,/aria-controls=/i,`${name} search must connect input and dropdown`);
  }
  assert.deepEqual(searchFiles.sort(),['app.js','documents.js','invoices.js','payables.js','payments.js','suppliers.js']);
});

test('payables UI blocks unbalanced coding and visibly confirms approval',()=>{
  const source=read('apps/portal/payables.js');
  const css=read('apps/portal/payables.css');
  assert.match(source,/function codingBalance/);
  assert.match(source,/function assertBalancedCoding/);
  assert.match(source,/Måste balansera före attest/);
  assert.match(source,/data-balance-debit/);
  assert.match(source,/data-balance-credit/);
  assert.match(source,/coding-action-blocked/);
  assert.match(source,/aria-disabled/);
  assert.match(source,/Konteringen måste balansera före/);
  assert.match(source,/Fakturan är attesterad och konteringen är låst/);
  assert.match(source,/payables-action-toast/);
  assert.match(css,/\.coding-balance\.balanced/);
  assert.match(css,/\.coding-balance\.unbalanced/);
  assert.match(css,/\.payables-action-toast/);
  assert.match(css,/\.coding-action-blocked/);
  assert.match(css,/\.payables-action-toast\.is-error/);
});

test('supplier invoice workspace offers separate safe open-PDF and download actions',()=>{
  const source=read('apps/portal/payables.js');
  const router=read('apps/api/payables-router.js');
  assert.match(source,/Öppna PDF/);
  assert.match(source,/\?view=inline/);
  assert.match(source,/Ladda ner original-PDF/);
  assert.match(router,/inline=url\.searchParams\.get\('view'\)==='inline'/);
  assert.match(router,/inline\?'inline':'attachment'/);
});


test('payments live search, refresh feedback and financial table alignment are enforced',()=>{
  const payments=read('apps/portal/payments.js');
  const reports=read('apps/portal/reports.js');
  const design=read('apps/portal/design-system.css');
  assert.match(payments,/id="payments-search-results"/);
  assert.match(payments,/function paymentSearchSuggestions/);
  assert.match(payments,/function updateSearchUi/);
  assert.match(payments,/Uppdaterar…/);
  assert.match(payments,/Betalningarna är uppdaterade/);
  assert.match(reports,/Uppdaterar…/);
  assert.match(reports,/Rapporten är uppdaterad/);
  assert.match(design,/Financial tables: center headers and numeric values/);
  assert.match(design,/\.report-table th[\s\S]*text-align:\s*center/);
  assert.match(design,/\.report-table \.money[\s\S]*text-align:\s*center !important/);
  assert.match(design,/font-variant-numeric:\s*tabular-nums/);
});

test('supplier payment bank reference uses LT Studio modal instead of browser prompt',()=>{
  const source=read('apps/portal/payables.js');
  const start=source.indexOf('async function confirmPayment');
  const end=source.indexOf("document.addEventListener('input'",start);
  const paymentFlow=source.slice(start,end);
  assert.match(source,/function paymentConfirmationModal/);
  assert.match(source,/id="payment-confirm-form"/);
  assert.match(source,/Bankens betalningsreferens/);
  assert.doesNotMatch(paymentFlow,/\bprompt\s*\(/);
});

test('bank page has an explicit working refresh action for UAT data',()=>{
  const source=read('apps/portal/bank.js');
  assert.match(source,/data-action="refresh-bank"/);
  assert.match(source,/async function refreshPayments/);
  assert.match(source,/Bankhändelserna är uppdaterade/);
  assert.match(source,/cache:'no-store'/);
});
