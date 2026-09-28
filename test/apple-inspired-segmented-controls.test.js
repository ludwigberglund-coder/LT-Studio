'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('workflow filters share one segmented control family',()=>{
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — segmented controls';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'segmented control marker is missing');
  const stage=css.slice(start);
  assert.match(stage,/\.queue-tabs/);
  assert.match(stage,/\.report-tabs/);
  assert.match(stage,/\.automation-filter/);
  assert.match(stage,/\.queue-tab\.active/);
  assert.match(stage,/\.report-tab\.active/);
  assert.match(stage,/automation-filter button\.active/);
});

test('segmented controls support keyboard, dark mode and reduced motion',()=>{
  const css=read('apps/portal/design-system.css');
  const stage=css.slice(css.indexOf('LT Studio UI 2.0 — segmented controls'));
  assert.match(stage,/:focus-visible/);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stage,/overflow-x:auto/);
});

test('filter modules keep their existing active-state semantics',()=>{
  const payables=read('apps/portal/payables.js');
  const reports=read('apps/portal/reports.js');
  const automation=read('apps/portal/automation.js');
  assert.match(payables,/queue-tab \$\{queueFilter===id\?'active':''\}/);
  assert.match(reports,/report-tab/);
  assert.match(automation,/automation-filter/);
});
