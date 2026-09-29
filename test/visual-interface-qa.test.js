'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('portal toolbar hides the visual theme label inside the circular control',()=>{
  const css=read('apps/portal/design-system.css');
  assert.match(css,/\.lt-theme-toggle-topbar \.lt-theme-toggle-label\{\s*display:none!important/);
  assert.match(css,/\.lt-theme-toggle-topbar\{[\s\S]*flex:0 0 44px!important/);
});

test('customer invoice list becomes labeled cards on narrow screens',()=>{
  const js=read('apps/portal/invoices.js');
  const css=read('apps/portal/sales.css');
  assert.match(js,/invoice-list-table/);
  assert.match(js,/data-label="Faktura \/ OCR"/);
  assert.match(js,/data-label="Förfallodatum"/);
  assert.match(css,/@media\(max-width:650px\)[\s\S]*\.invoice-list-table thead\{display:none\}/);
  assert.match(css,/\.invoice-list-table td::before\{[\s\S]*content:attr\(data-label\)/);
});

test('project admin keeps live status readable and mobile topbar compact',()=>{
  const admin=read('apps/admin/design-system.css');
  const status=read('apps/admin/system-status.css');
  assert.match(admin,/@media\(max-width:820px\)[\s\S]*grid-template-columns:minmax\(0,1fr\) auto auto!important/);
  assert.match(admin,/\.topbar>\.top-actions\{[\s\S]*grid-column:1\/-1/);
  assert.match(status,/\.system-status-heading h2,[\s\S]*color:#f8fbf9!important/);
  assert.match(status,/\.system-status \.system-row strong/);
});

test('legacy toast stays clear of the floating appearance control',()=>{
  const css=read('public/design-system.css');
  assert.match(css,/\.toast\{[\s\S]*left:274px!important;[\s\S]*right:auto!important/);
  assert.match(css,/@media\(max-width:650px\)[\s\S]*\.toast\{[\s\S]*right:72px!important;[\s\S]*bottom:18px!important/);
  assert.match(css,/\.admin-top :where\(\.menu-toggle,\.search-trigger,\.button\)[\s\S]*border-radius:999px!important/);
});

test('settlement modal is immediately opaque in visual captures',()=>{
  const app=read('apps/portal/app.js');
  const css=read('apps/portal/styles.css');
  assert.match(app,/modal-backdrop settlement-backdrop/);
  assert.match(css,/\.settlement-backdrop\{[\s\S]*animation:none!important;[\s\S]*opacity:1!important/);
  assert.match(css,/\.settlement-backdrop \.settlement-modal\{[\s\S]*opacity:1!important;[\s\S]*background:var\(--surface-card/);
});
