'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function boundedStage(content,startMarker,endMarker){
  const start=content.indexOf(startMarker);
  assert.ok(start>=0,`missing UI marker: ${startMarker}`);
  const end=endMarker?content.indexOf(endMarker,start+startMarker.length):-1;
  return content.slice(start,end>start?end:content.length);
}

test('summary cards and workbars stay solid, scan-friendly and shared across modules',()=>{
  const css=read('apps/portal/design-system.css');
  const stage=boundedStage(css,'LT Studio UI 2.0 — summary surfaces and workbars','/* LT Studio UI 2.0 — financial table polish');
  for(const selector of [
    '.report-summary>article',
    '.inventory-summary>article',
    '.bank-summary>article',
    '.payroll-summary>article',
    '.payment-summary>article',
    '.automation-summary>.automation-card',
    '.uat-summary>article'
  ]) assert.ok(stage.includes(selector),`summary stage must cover ${selector}`);
  assert.match(stage,/font-variant-numeric:tabular-nums/);
  assert.match(stage,/\.report-toolbar/);
  assert.match(stage,/\.documents-toolbar/);
  assert.match(stage,/\.payments-toolbar/);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.doesNotMatch(stage,/backdrop-filter/i,'financial summary cards must remain opaque');
});

test('financial tables use sticky headers and stable tabular numeric scanning',()=>{
  const css=read('apps/portal/design-system.css');
  const stage=boundedStage(css,'LT Studio UI 2.0 — financial table polish','/* LT Studio UI 2.0 — segmented controls');
  for(const selector of ['.table-scroll','.queue-table-wrap','.report-table-wrap','.documents-table-wrap','.accounting-table-scroll']){
    assert.ok(stage.includes(selector),`table stage must cover ${selector}`);
  }
  assert.match(stage,/position:sticky/);
  assert.match(stage,/text-align:center!important/);
  assert.match(stage,/font-variant-numeric:tabular-nums/);
  assert.match(stage,/--lt-table-selected/);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(stage,/backdrop-filter/i,'financial tables must never use glass blur');
});

test('segmented workflow filters share one accessible control family',()=>{
  const css=read('apps/portal/design-system.css');
  const stage=boundedStage(css,'LT Studio UI 2.0 — segmented controls',null);
  assert.match(stage,/\.queue-tabs/);
  assert.match(stage,/\.report-tabs/);
  assert.match(stage,/\.automation-filter/);
  assert.match(stage,/:focus-visible/);
  assert.match(stage,/overflow-x:auto/);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
});

test('batch review workspace emphasizes totals and control state without glass data areas',()=>{
  const css=read('apps/portal/batches.css');
  const js=read('apps/portal/batches.js');
  const stage=boundedStage(css,'LT Studio UI 2.0 — batch review workspace',null);
  assert.match(stage,/\.batch-card\.active/);
  assert.match(stage,/box-shadow:3px 0 0 var\(--brand-forest\) inset/);
  assert.match(stage,/\.summary-pill\.control-pill\.ok/);
  assert.match(stage,/\.summary-pill\.control-pill\.err/);
  assert.match(stage,/font-variant-numeric:tabular-nums/);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.doesNotMatch(stage,/backdrop-filter/i,'batch data area must remain solid');
  assert.match(js,/aria-label="Buntsammanfattning"/);
  assert.match(js,/summary-pill money-pill debit/);
  assert.match(js,/summary-pill money-pill credit/);
  assert.match(js,/data-action="approve">Godkänn bunt/);
  assert.match(js,/control_state==='balanced'/);
});

test('workspace polish does not replace the underlying data-first module semantics',()=>{
  const payments=read('apps/portal/payments.js');
  const reports=read('apps/portal/reports.js');
  const receivables=read('apps/portal/app.js');
  const accounting=read('apps/portal/accounting.js');
  const automation=read('apps/portal/automation.js');

  assert.match(payments,/class="report-summary payments-summary"/);
  assert.match(payments,/Inbetalningar/);
  assert.match(payments,/Utbetalningar/);
  assert.match(reports,/report-summary/);
  assert.match(receivables,/class="res-table"/);
  assert.match(receivables,/class="money"/);
  assert.match(accounting,/class="accounting-table"/);
  assert.match(accounting,/class="money"/);
  assert.match(automation,/automation-filter/);
});
