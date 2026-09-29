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

test('project admin keeps LT Studio naming and high contrast live status',()=>{
  const html=read('apps/admin/index.html');
  const app=read('apps/admin/app.js');
  const status=read('apps/admin/system-status.css');
  const design=read('apps/admin/design-system.css');
  assert.doesNotMatch(html,/Rollands Projektadmin/);
  assert.match(html,/LT Studio Projektadmin/);
  assert.match(app,/LT Studio \/ \$\{escapeHtml\(title\)\}/);
  assert.match(status,/system-status-heading h2,[\s\S]*color:#fff!important/);
  assert.match(design,/project-admin mobile toolbar compact/);
});

test('legacy demo no longer covers the viewport with an initial toast',()=>{
  const legacy=read('public/app.js');
  const workspace=read('public/workspace.js');
  assert.doesNotMatch(legacy,/render\(\); toast\('Demoläge: ändringar sparas i denna webbläsare\.'/);
  assert.match(workspace,/>LT Studio<small>EKONOMI & VERKSAMHET<\/small>/);
});
