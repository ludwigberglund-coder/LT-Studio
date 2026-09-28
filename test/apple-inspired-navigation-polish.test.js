'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('shared navigation has a compact laptop treatment without hiding links',()=>{
  const css=read('apps/portal/shared-nav.css');
  const marker='LT Studio UI 2.0 — navigation polish';
  const start=css.indexOf(marker);
  assert.ok(start>=0,'navigation polish marker is missing');
  const stage=css.slice(start);
  assert.match(stage,/@media\(min-width:761px\) and \(max-width:1180px\)/);
  assert.match(stage,/grid-template-columns:276px minmax\(0,1fr\)!important/);
  assert.match(stage,/width:276px!important/);
  assert.doesNotMatch(stage,/display:none[^;]*!important[^}]*shared-links/i);
});

test('navigation keeps a stable icon column and accessible touch targets',()=>{
  const css=read('apps/portal/shared-nav.css');
  const stage=css.slice(css.indexOf('LT Studio UI 2.0 — navigation polish'));
  assert.match(stage,/grid-template-columns:19px minmax\(0,1fr\)/);
  assert.match(stage,/min-height:42px/);
  assert.match(stage,/min-height:44px/);
  assert.match(stage,/\.shared-navigation \.shared-links a>\.ui-icon/);
});

test('mobile navigation remains one-column and reduced motion is respected',()=>{
  const css=read('apps/portal/shared-nav.css');
  const stage=css.slice(css.indexOf('LT Studio UI 2.0 — navigation polish'));
  assert.match(stage,/@media\(max-width:760px\)/);
  assert.match(stage,/grid-template-columns:1fr!important/);
  assert.match(stage,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stage,/transition:none!important/);
});

test('portal navigation still owns collapse and drawer behavior',()=>{
  const nav=read('apps/portal/portal-nav.js');
  assert.match(nav,/shared-sidebar-collapsed/);
  assert.match(nav,/shared-mobile-menu-open/);
  assert.match(nav,/aria-expanded/);
  assert.match(nav,/topbar\.prepend\(button\)/);
});
