'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function stage(){
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — summary surfaces and workbars';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'summary surface marker is missing');
  return css.slice(start);
}

test('financial summary cards share a solid scan-friendly treatment',()=>{
  const css=stage();
  for(const selector of [
    '.report-summary>article',
    '.inventory-summary>article',
    '.bank-summary>article',
    '.payroll-summary>article',
    '.payment-summary>article',
    '.uat-summary>article'
  ])assert.ok(css.includes(selector),`summary stage must cover ${selector}`);
  assert.match(css,/background:var\(--surface-card\)!important/);
  assert.match(css,/font-variant-numeric:tabular-nums/);
  assert.doesNotMatch(css,/backdrop-filter/i,'summary cards must remain opaque');
});

test('workbars are grouped without changing their controls',()=>{
  const css=stage();
  assert.match(css,/\.report-toolbar/);
  assert.match(css,/\.documents-toolbar/);
  assert.match(css,/\.payments-toolbar/);
  assert.match(css,/--lt-workbar-bg/);
});

test('summary surfaces retain dark mode and mobile density',()=>{
  const css=stage();
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/min-height:88px/);
});

test('module summary markup remains data-first',()=>{
  const payments=read('apps/portal/payments.js');
  const reports=read('apps/portal/reports.js');
  assert.match(payments,/class="report-summary payments-summary"/);
  assert.match(payments,/Inbetalningar/);
  assert.match(payments,/Utbetalningar/);
  assert.match(reports,/report-summary/);
});
