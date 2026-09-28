'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function tableStage(){
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — financial table polish';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'financial table polish marker is missing');
  return css.slice(start);
}

test('financial tables stay solid and get sticky headers in scroll containers',()=>{
  const css=tableStage();
  for(const selector of ['.table-scroll','.queue-table-wrap','.report-table-wrap','.documents-table-wrap','.accounting-table-scroll']){
    assert.ok(css.includes(selector),`table stage must cover ${selector}`);
  }
  assert.match(css,/position:sticky/);
  assert.match(css,/top:0/);
  assert.doesNotMatch(css,/backdrop-filter/i,'financial tables must never use glass blur');
});

test('financial headers and numeric cells use stable centered scanning',()=>{
  const css=tableStage();
  assert.match(css,/text-align:center!important/);
  assert.match(css,/font-variant-numeric:tabular-nums/);
  assert.match(css,/white-space:nowrap/);
  assert.match(css,/\.res-table td\.money/);
  assert.match(css,/\.accounting-table td\.money/);
});

test('table hover and selection remain subtle and theme-safe',()=>{
  const css=tableStage();
  assert.match(css,/--lt-table-row-hover/);
  assert.match(css,/--lt-table-selected/);
  assert.match(css,/box-shadow:3px 0 0 var\(--brand-forest\) inset/);
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('customer receivables and accounting still expose money semantics',()=>{
  const receivables=read('apps/portal/app.js');
  const accounting=read('apps/portal/accounting.js');
  assert.match(receivables,/class="money"/);
  assert.match(receivables,/class="res-table"/);
  assert.match(accounting,/class="accounting-table"/);
  assert.match(accounting,/class="money"/);
});
