'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('portal search surfaces share one opaque visual treatment',()=>{
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — search surfaces';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'shared search UI marker is missing');
  const end=css.indexOf('/* LT Studio UI 2.0 — form surfaces',start);
  const stage=css.slice(start,end>start?end:css.length);
  assert.match(stage,/\.shared-search-results/);
  assert.match(stage,/\.supplier-search-results/);
  assert.match(stage,/\.receivable-search-results/);
  assert.match(stage,/background:var\(--surface-card\)!important/);
  assert.match(stage,/--lt-search-popup-radius:18px/);
  assert.doesNotMatch(stage,/backdrop-filter/i,'search results must stay opaque instead of glassy');
});

test('search UI retains dark mode and reduced-motion support',()=>{
  const css=read('apps/portal/design-system.css');
  const start=css.indexOf('LT Studio UI 2.0 — search surfaces');
  const end=css.indexOf('/* LT Studio UI 2.0 — form surfaces',start);
  const stage=css.slice(start,end>start?end:css.length);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stage,/--lt-search-row-hover:color-mix/);
});

test('existing search accessibility and keyboard behavior remain in place',()=>{
  const payables=read('apps/portal/payables.js');
  const suppliers=read('apps/portal/suppliers.js');
  const receivables=read('apps/portal/app.js');
  for(const js of [payables,suppliers,receivables]){
    assert.match(js,/role="combobox"/);
    assert.match(js,/aria-autocomplete="list"/);
    assert.match(js,/role="listbox"/);
  }
  assert.match(payables,/e\.key==='ArrowDown'\|\|e\.key==='ArrowUp'/);
  assert.match(suppliers,/e\.key==='ArrowDown'\|\|e\.key==='ArrowUp'/);
  assert.match(receivables,/ArrowDown/);
  assert.match(receivables,/Enter/);
});

test('supplier search uses the approved Iconoir icon without observer churn',()=>{
  const suppliers=read('apps/portal/suppliers.js');
  assert.match(suppliers,/supplier-search-icon[^>]*aria-hidden="true"><span class="ui-icon"[^>]*><svg/);
  assert.match(suppliers,/M17 17L21 21M3 11C3 15\.4183/);
  assert.doesNotMatch(suppliers,/data-iconoir="search"/);
  assert.doesNotMatch(suppliers,/⌕/);
});
