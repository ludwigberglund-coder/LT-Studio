'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function stage(file,marker){
  const source=read(file);
  const index=source.indexOf(marker);
  assert.ok(index>=0,`missing visual stage: ${marker}`);
  return source.slice(index);
}

test('Apple HIG visual pass uses system typography and visible material chrome',()=>{
  const css=stage('apps/portal/design-system.css','LT Studio UI 2.1 — Apple HIG visual pass');
  assert.match(css,/--font-geist:-apple-system,BlinkMacSystemFont/);
  assert.match(css,/\.sidebar\.shared-sidebar\{[\s\S]*backdrop-filter:blur\(30px\) saturate\(165%\)/);
  assert.match(css,/\.topbar\{[\s\S]*position:sticky!important/);
  assert.match(css,/\.topbar\{[\s\S]*backdrop-filter:blur\(30px\) saturate\(170%\)/);
  assert.match(css,/--lt-apple-selection:color-mix\(in srgb,var\(--brand-sky\) 72%,var\(--surface-card\)\)/);
});

test('primary controls and navigation have a visibly different Apple-style treatment',()=>{
  const css=stage('apps/portal/design-system.css','LT Studio UI 2.1 — Apple HIG visual pass');
  assert.match(css,/\.button\{[\s\S]*border-radius:999px!important/);
  assert.match(css,/\.button\{[\s\S]*background:var\(--brand-forest\)!important/);
  assert.match(css,/\.shared-menu-toggle,[\s\S]*\.shared-user-trigger\{[\s\S]*border:1px solid var\(--lt-apple-glass-border\)!important/);
  assert.match(css,/\.shared-navigation \.shared-links a\[aria-current="page"\]\{[\s\S]*background:var\(--lt-apple-selection\)!important/);
});

test('financial content remains solid while navigation and master list may use material',()=>{
  const css=stage('apps/portal/design-system.css','LT Studio UI 2.1 — Apple HIG visual pass');
  assert.match(css,/\.batch-list\{[\s\S]*background:var\(--lt-apple-glass\)!important/);
  assert.match(css,/\.batch-editor\{[\s\S]*background:var\(--surface-card\)!important/);
  assert.match(css,/thead th\{[\s\S]*background:color-mix/);
  assert.doesNotMatch(css,/thead th\{[^}]*backdrop-filter/s);
});

test('dashboard visual hierarchy is intentionally obvious',()=>{
  const css=stage('apps/portal/dashboard.css','LT Studio UI 2.1 — Apple HIG dashboard pass');
  assert.match(css,/min-height:260px!important/);
  assert.match(css,/font-size:clamp\(40px,4\.6vw,58px\)!important/);
  assert.match(css,/\.today-work\{[\s\S]*background:transparent!important/);
  assert.match(css,/\.task-card>strong\{[\s\S]*height:58px/);
  assert.match(css,/\.task-card\.tone-peach,[\s\S]*background:var\(--surface-card\)!important/);
});

test('Apple visual pass retains dark mode and accessibility fallbacks',()=>{
  const css=stage('apps/portal/design-system.css','LT Studio UI 2.1 — Apple HIG visual pass');
  const dash=stage('apps/portal/dashboard.css','LT Studio UI 2.1 — Apple HIG dashboard pass');
  assert.match(css,/html\[data-lt-theme="dark"\]/);
  assert.match(css,/@supports not \(\(-webkit-backdrop-filter:blur\(1px\)\) or \(backdrop-filter:blur\(1px\)\)\)/);
  assert.match(css,/@media\(prefers-reduced-transparency:reduce\)/);
  assert.match(dash,/@media\(prefers-reduced-transparency:reduce\)/);
});
