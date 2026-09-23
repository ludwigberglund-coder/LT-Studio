'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'apps/website/design-system.css'),'utf8');

test('publika hemsidan har levande LT Studio-palett',()=>{
  assert.match(css,/--brand-forest:#173f32/);
  assert.match(css,/--brand-peach:#f2b18e/);
  assert.match(css,/--brand-lime:#dfe9ad/);
  assert.match(css,/linear-gradient/);
  assert.match(css,/\.service-card:nth-child\(3n\+1\)/);
  assert.match(css,/\.produce-orange\{background:#f0a05d\}/);
});

test('färglagret behåller tillgänglig reduced-motion fallback',()=>{
  assert.match(css,/prefers-reduced-motion/);
});
