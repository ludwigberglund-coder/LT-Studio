'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Apple-inspired UI foundation stays limited to workspace chrome and overview',()=>{
  const design=read('apps/portal/design-system.css');
  const dashboard=read('apps/portal/dashboard.css');
  assert.match(design,/LT Studio UI 2\.0 — Apple-inspired workspace foundation/);
  assert.match(design,/backdrop-filter:blur\(22px\) saturate\(145%\)/);
  assert.match(design,/prefers-reduced-transparency:reduce/);
  assert.match(design,/html\[data-lt-theme="dark"\]/);
  assert.match(dashboard,/LT Studio UI 2\.0 — overview pilot/);
  assert.match(dashboard,/Content cards stay opaque for accounting clarity/);
});

test('design roadmap explicitly keeps dense accounting data solid',()=>{
  const roadmap=read('docs/ui-apple-inspired-roadmap.md');
  assert.match(roadmap,/Tabeller, reskontra och bokföring/);
  assert.match(roadmap,/Dessa ska INTE göras glasiga/);
  assert.match(roadmap,/solida bakgrunder/);
  assert.match(roadmap,/PR #585 hanterar buntdialoger/);
});
