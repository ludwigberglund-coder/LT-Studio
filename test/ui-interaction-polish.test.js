'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Iconoir och tactile UI-polish finns i alla gemensamma arbetsytor',()=>{
  const nav=read('apps/portal/portal-nav.js');
  const portalCss=read('apps/portal/styles.css');
  const sharedCss=read('apps/portal/shared-nav.css');
  const operator=read('apps/operator/app.js');
  const operatorCss=read('apps/operator/styles.css');

  assert.match(nav,/const ICONOIR=Object\.freeze/);
  assert.match(nav,/semanticButtonIcon/);
  assert.match(nav,/animateTap/);
  assert.match(nav,/prefers-reduced-motion/);
  assert.match(nav,/chat:/);
  assert.match(nav,/openWindow:/);

  assert.match(portalCss,/Global LT Studio surface polish/);
  assert.match(portalCss,/\.button:active/);
  assert.match(sharedCss,/Shared tactile design for portal/);
  assert.match(sharedCss,/\.shared-navigation \.shared-links a:hover/);

  assert.match(operator,/const OPERATOR_ICONOIR=Object\.freeze/);
  assert.match(operator,/decorateOperatorUi/);
  assert.match(operator,/operatorTap/);
  assert.match(operatorCss,/Iconoir-only interaction layer/);
  assert.match(operatorCss,/prefers-reduced-motion/);
});

test('interaktiva etiketter använder text medan Iconoir står för symbolerna',()=>{
  const operatorTest=read('test/operator-admin-browser.cjs');
  const invoiceTest=read('test/menu-invoice-browser.cjs');
  const privateBrowser=read('test/private-workflows-browser.cjs');

  assert.doesNotMatch(operatorTest,/← Alla företag/);
  assert.match(operatorTest,/name:'Alla företag'/);
  assert.doesNotMatch(invoiceTest,/\+ Ny kundfaktura/);
  assert.match(invoiceTest,/name:'Ny kundfaktura'/);
  assert.doesNotMatch(privateBrowser,/\+ Ny kundfaktura/);
});
