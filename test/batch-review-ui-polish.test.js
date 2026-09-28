'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('batch review workspace emphasizes selection and control state without glass data areas',()=>{
  const css=read('apps/portal/batches.css');
  const marker='LT Studio UI 2.0 — batch review workspace';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'batch review polish marker is missing');
  const stage=css.slice(start);
  assert.match(stage,/\.batch-card\.active/);
  assert.match(stage,/box-shadow:3px 0 0 var\(--brand-forest\) inset/);
  assert.match(stage,/\.summary-pill\.control-pill\.ok/);
  assert.match(stage,/\.summary-pill\.control-pill\.err/);
  assert.doesNotMatch(stage,/backdrop-filter/i,'batch data area must remain solid');
});

test('batch debit and credit totals retain tabular numeric scanning',()=>{
  const css=read('apps/portal/batches.css');
  const js=read('apps/portal/batches.js');
  const stage=css.slice(css.indexOf('LT Studio UI 2.0 — batch review workspace'));
  assert.match(stage,/font-variant-numeric:tabular-nums/);
  assert.match(stage,/input\[data-f="debit"\]/);
  assert.match(stage,/input\[data-f="credit"\]/);
  assert.match(js,/summary-pill money-pill debit/);
  assert.match(js,/summary-pill money-pill credit/);
  assert.match(js,/aria-label="Buntsammanfattning"/);
});

test('batch review polish keeps dark mode and reduced motion support',()=>{
  const css=read('apps/portal/batches.css');
  const stage=css.slice(css.indexOf('LT Studio UI 2.0 — batch review workspace'));
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stage,/transition:none!important/);
});

test('batch approval remains a separate explicit action',()=>{
  const js=read('apps/portal/batches.js');
  assert.match(js,/data-action="approve">Godkänn bunt/);
  assert.match(js,/control_state==='balanced'/);
  assert.match(js,/total_debit_ore/);
  assert.match(js,/total_credit_ore/);
});
