'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function stage(){
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — content surfaces';
  const index=css.indexOf(marker);
  assert.ok(index>=0,'content surfaces marker is missing');
  return css.slice(index);
}

test('summary cards use one solid visual hierarchy',()=>{
  const css=stage();
  for(const selector of [
    '.report-summary article',
    '.inventory-summary article',
    '.payroll-summary article',
    '.automation-summary .automation-card',
    '.payment-summary article',
    '.vat-grid article'
  ])assert.ok(css.includes(selector),`summary styling must cover ${selector}`);
  assert.match(css,/--lt-summary-radius:20px/);
  assert.match(css,/font-variant-numeric:tabular-nums/);
});

test('queue report and automation filters use one segmented-control pattern',()=>{
  const css=stage();
  assert.match(css,/\.queue-tabs,\.report-tabs,\.automation-filter/);
  assert.match(css,/border-radius:14px/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/\.queue-tab\.active,\.report-tab\.active,\.automation-filter button\.active/);
});

test('financial tables stay solid while headers remain visible',()=>{
  const css=stage();
  assert.match(css,/\.report-table,/);
  assert.match(css,/\.documents-table,/);
  assert.match(css,/\.accounting-table,/);
  assert.match(css,/thead th\{/);
  assert.match(css,/position:sticky/);
  assert.match(css,/background:var\(--surface-alt\)!important/);
  assert.match(css,/scrollbar-gutter:stable/);
  assert.doesNotMatch(css,/thead th\{[^}]*backdrop-filter/s);
});

test('batch workspace gains useful sticky surfaces without changing business logic',()=>{
  const css=stage();
  const js=read('apps/portal/batches.js');
  assert.match(css,/\.batch-list\{[\s\S]*position:sticky/);
  assert.match(css,/\.batch-editor>\.batch-actions\{[\s\S]*position:sticky/);
  assert.match(css,/\.batch-card\.active/);
  assert.match(css,/\.transaction\{/);
  assert.match(js,/save_financial_batch/);
  assert.match(js,/approve_financial_batch/);
});

test('content surfaces support dark mode, reduced motion and reduced transparency',()=>{
  const css=stage();
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/@media\(prefers-reduced-transparency:reduce\)/);
  assert.match(css,/backdrop-filter:none!important/);
});
