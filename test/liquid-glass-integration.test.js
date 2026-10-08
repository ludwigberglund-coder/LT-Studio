'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildStatic}=require('../scripts/build-static.js');
const root=path.resolve(__dirname,'..');

test('Liquid Glass installs on all UI routes, but never on redirect pages',()=>{
  const dist=buildStatic();
  const css=fs.readFileSync(path.join(dist,'shared','liquid-glass.css'),'utf8');
  assert.match(css,/prefers-reduced-transparency/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/forced-colors/);
  assert.match(css,/@supports not/);
  assert.match(css,/\.company-toolbar/);
  assert.match(css,/\.shared-navigation/);
  assert.match(css,/\.site-header/);
  assert.match(css,/\.modal-card/);
  assert.match(css,/table, td, th/);
  /* Glass must show actual chromatic refraction, not just nearly-white blur. */
  assert.match(css,/--lt-glass-aurora-blue:/);
  assert.match(css,/--lt-glass-aurora-violet:/);
  assert.match(css,/--lt-liquid-pane:[\s\S]*?radial-gradient/);
  assert.match(css,/--lt-liquid-control:[\s\S]*?radial-gradient/);
  assert.match(css,/@keyframes ltLiquidDrift/);
  assert.match(css,/html\[data-lt-theme="dark"\]\[data-lt-glass-surface\]/);
  assert.match(css,/prefers-reduced-transparency:\s*reduce/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);

  for(const [route,surface] of [
    ['index.html','website'],
    ['portal/dashboard.html','portal'],
    ['portal/invoices.html','portal'],
    ['portal/payments.html','portal'],
    ['portal/batches.html','portal'],
    ['operator/index.html','operator'],
    ['legacy/index.html','legacy']
  ]){
    const html=fs.readFileSync(path.join(dist,route),'utf8');
    assert.match(html,new RegExp('data-lt-glass-surface="'+surface+'"'),route+' lacks its material scope');
    assert.match(html,/shared\/liquid-glass\.css\?v=/,route+' lacks the versioned material layer');
    const material=html.lastIndexOf('liquid-glass.css');
    assert.ok(material>html.lastIndexOf('design-system.css'),route+' must load the glass layer after its design system');
  }
  for(const route of ['admin/index.html','uat/index.html']){
    const html=fs.readFileSync(path.join(dist,route),'utf8');
    assert.doesNotMatch(html,/data-lt-glass-surface/,route+' redirect must be untouched');
  }
});
