'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('kundreskontrans sökning filtrerar befintlig DOM utan helomrendering per tecken',()=>{
  const app=read('apps/portal/app.js');
  const inputHandler=app.match(/document\.addEventListener\('input',event=>\{([\s\S]*?)\n\}\);/);

  assert.ok(inputHandler,'input-handlern ska finnas');
  assert.match(inputHandler[1],/if\(event\.target\.id==='receivable-search-input'\)\{[\s\S]*?applyReceivableFilterDom\(\);return;/);
  assert.doesNotMatch(inputHandler[1],/renderReceivableResults\(\)/);
});

test('fakturakommentar behåller utkast medan användaren skriver',()=>{
  const app=read('apps/portal/app.js');

  assert.match(app,/if\(event\.target\.id==='invoice-comment-draft'&&modal\?\.type==='comments'\)\{\s*modal\.draftText=event\.target\.value;return;/);
});

test('stora kundreskontrapaneller lyfts inte på hover',()=>{
  const css=read('apps/portal/design-system.css');

  assert.match(css,/\.receivable-search\.panel:hover,[\s\S]*?\.receivable-overview\.panel:hover,[\s\S]*?\.content > \.panel:hover\s*\{[\s\S]*?transform:\s*none/);
  assert.match(css,/\.receivable-customer-card:active\s*\{[\s\S]*?scale\(\.985\)/);
  assert.match(css,/prefers-reduced-motion/);
});
