'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('kundreskontrans sökning filtrerar befintlig DOM utan helomrendering per tecken',()=>{
  const app=read('apps/portal/app.js');
  const start=app.indexOf("document.addEventListener('input'");
  const end=app.indexOf("document.addEventListener('change'",start);
  assert.ok(start>=0&&end>start,'input-handlern ska finnas');
  const inputHandler=app.slice(start,end);

  assert.match(inputHandler,/receivable-search-input/);
  assert.match(inputHandler,/applyReceivableFilterDom\(\)/);
  assert.doesNotMatch(inputHandler,/renderReceivableResults\(\)/);
});

test('fakturakommentar behåller utkast medan användaren skriver',()=>{
  const app=read('apps/portal/app.js');

  assert.match(app,/invoice-comment-draft/);
  assert.match(app,/modal\.draftText=event\.target\.value/);
});

test('stora kundreskontrapaneller lyfts inte på hover',()=>{
  const css=read('apps/portal/design-system.css');

  assert.match(css,/\.receivable-search\.panel:hover,[\s\S]*?\.receivable-overview\.panel:hover,[\s\S]*?\.content > \.panel:hover\s*\{[\s\S]*?transform:\s*none/);
  assert.match(css,/\.receivable-customer-card:active\s*\{[\s\S]*?scale\(\.985\)/);
  assert.match(css,/prefers-reduced-motion/);
});
