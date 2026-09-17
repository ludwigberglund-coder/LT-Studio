'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Demo v1 exposes customer register, invoicing and shared receivables pages',()=>{
  for(const file of ['apps/portal/customers.html','apps/portal/customers.js','apps/portal/invoices.html','apps/portal/invoices.js','apps/portal/receivables.html','apps/portal/receivables.js','apps/portal/sales.css']) assert.equal(fs.existsSync(path.join(root,file)),true,`${file} ska finnas`);
  const nav=read('apps/portal/portal-nav.js');
  assert.match(nav,/invoices\.html/);
  assert.match(nav,/customers\.html/);
  assert.match(nav,/receivables\.html/);
});

test('Customer invoice creation writes both receivable and balanced accounting source',()=>{
  const source=read('apps/portal/invoices.js');
  assert.match(source,/state\.customerInvoices/);
  assert.match(source,/state\.accountingEntries/);
  assert.match(source,/account:'1510'/);
  assert.match(source,/account:'3010'/);
  assert.match(source,/account:'2611'/);
  assert.match(source,/debitOre:totalOre/);
  assert.match(source,/creditOre:netOre/);
  assert.match(source,/creditOre:vatOre/);
});

test('Public website has a direct Demo v1 portal entry',()=>{
  const site=JSON.parse(read('content/site.json'));
  assert.equal(site.hero.secondaryCta.href,'./portal/dashboard.html?demo=1');
  assert.ok(site.navigation.some(item=>item.href==='./portal/dashboard.html?demo=1'));
});

test('Static build treats sales flow as required output',()=>{
  const build=read('scripts/build-static.js');
  for(const file of ['portal/customers.html','portal/invoices.html','portal/receivables.html','portal/sales.css']) assert.match(build,new RegExp(file.replace('.','\\.')));
});
