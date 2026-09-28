'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('shared LT Studio dialog helper is accessible and keyboard aware',()=>{
  const nav=read('apps/portal/portal-nav.js');
  assert.match(nav,/root\.LTStudioDialog=LTStudioDialog/);
  assert.match(nav,/aria-modal/);
  assert.match(nav,/aria-labelledby/);
  assert.match(nav,/aria-describedby/);
  assert.match(nav,/event\.key==='Escape'/);
  assert.match(nav,/event\.key==='Tab'/);
  assert.match(nav,/previous\.focus/);
  assert.match(nav,/lt-dialog-field-error/);
});

test('portal modules do not use browser-native alert confirm or prompt',()=>{
  const dir=path.join(root,'apps/portal');
  const files=fs.readdirSync(dir).filter(name=>name.endsWith('.js')&&name!=='portal-nav.js');
  const windowNative=/\bwindow\.(?:alert|confirm|prompt)\s*\(/;
  const bareNative=/(^|[^.\w])(?:alert|confirm|prompt)\s*\(/m;
  const offenders=[];
  for(const name of files){
    const source=fs.readFileSync(path.join(dir,name),'utf8');
    if(windowNative.test(source)||bareNative.test(source))offenders.push(name);
  }
  assert.deepEqual(offenders,[],'portal modules must use LTStudioDialog instead of browser-native dialogs');
});

test('shared dialog styling covers both generic and existing portal modals',()=>{
  const css=read('apps/portal/design-system.css');
  const marker='LT Studio UI 2.0 — shared dialogs';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'shared dialog design marker is missing');
  const stage=css.slice(start);
  assert.match(stage,/\.lt-dialog-backdrop/);
  assert.match(stage,/\.lt-dialog\{/);
  assert.match(stage,/\.batch-confirm-modal/);
  assert.match(stage,/\.payment-confirm-modal/);
  assert.match(stage,/\.documents-modal/);
  assert.match(stage,/\.intake-modal/);
  assert.match(stage,/html\[data-lt-theme="dark"\]/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stage,/@media\(prefers-reduced-transparency:reduce\)/);
});

test('critical dialog migrations are present',()=>{
  const accounting=read('apps/portal/accounting.js');
  const batches=read('apps/portal/batches.js');
  const invoices=read('apps/portal/invoices.js');
  const payables=read('apps/portal/payables.js');
  const website=read('apps/portal/website.js');
  const uat=read('apps/portal/uat.js');

  for(const source of [accounting,batches,invoices,payables,website,uat]){
    assert.match(source,/window\.LTStudioDialog\.(?:alert|confirm|prompt)/);
  }
  assert.match(batches,/async function bulkRegister/);
  assert.match(payables,/title:'Rätta fakturadatum'/);
  assert.match(website,/title:'Hämta senaste utkast\?'/);
});
