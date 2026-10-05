'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('workspace chrome uses LT Studio branding and icon-only appearance control',()=>{
  const nav=read('apps/portal/portal-nav.js');
  const theme=read('packages/shared/browser/theme.css');
  assert.match(nav,/brandName\.textContent='LT Studio'/);
  assert.match(nav,/brandPlatform\.textContent='Ekonomisystem'/);
  assert.doesNotMatch(nav,/brandName\.textContent=companyName/);
  assert.match(theme,/\.lt-theme-toggle-topbar \.lt-theme-toggle-label\{\s*display:none;/);
});

test('customer invoice register has a phone card layout',()=>{
  const invoices=read('apps/portal/invoices.js');
  const sales=read('apps/portal/sales.css');
  assert.match(invoices,/data-label="Faktura \/ OCR"/);
  assert.match(invoices,/class="sales-panel invoice-list-panel"/);
  assert.match(sales,/@media\(max-width:640px\)/);
  assert.match(sales,/\.invoice-list-panel \.sales-table td::before/);
});

test('admin entry routes to LT Studio Driftadmin instead of legacy Projektadmin',()=>{
  const html=read('apps/admin/index.html');
  const operatorHtml=read('apps/operator/index.html');
  const operatorApp=read('apps/operator/app.js');
  assert.doesNotMatch(html,/Rollands Projektadmin|LT Studio Projektadmin/);
  assert.match(html,/LT Studio · Adminportal/);
  assert.match(html,/url=\.\.\/operator\//);
  assert.match(html,/location\.replace\(target\)/);
  assert.match(operatorHtml,/LT Studio · Driftadmin/);
  assert.match(operatorApp,/ADMIN CONTROL CENTER/);
  assert.match(operatorApp,/LT Studio-inloggning/);
});

test('legacy demo no longer covers the viewport or shows old product branding',()=>{
  const legacy=read('public/app.js');
  const workspace=read('public/workspace.js');
  const assistant=read('public/assistant.js');
  const accountPlan=read('public/account-plan.js');
  assert.doesNotMatch(legacy,/render\(\); toast\('Demoläge: ändringar sparas i denna webbläsare\.'/);
  assert.match(workspace,/>LT Studio<small>EKONOMI & VERKSAMHET<\/small>/);
  assert.doesNotMatch(assistant,/Rollands assistent/);
  assert.match(assistant,/LT Studio-assistent/);
  assert.doesNotMatch(accountPlan,/Rollands intern kontolista/);
});
