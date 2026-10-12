'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('bokföringsordlistan förklarar grundbegrepp utan att dölja originalposterna',()=>{
  const js=read('apps/portal/accounting.js');
  assert.match(js,/function beginnerGuide\(\)/);
  for(const word of ['Verifikation','Debet och kredit','Bunt','Periodlås'])assert.ok(js.includes(word),word);
  assert.match(js,/\$\{beginnerGuide\(\)\}<section class="accounting-grid"/);
  assert.match(js,/ändrar inga verifikationer eller perioder/);
  assert.match(js,/function entryTable\(\)/);
  assert.match(js,/function entryDetail\(\)/);
  assert.match(js,/function periodControls\(current\)/);
});
test('hjälpen är valfri, tangentbordsvänlig och responsiv',()=>{
  const js=read('apps/portal/accounting.js');
  const css=read('apps/portal/accounting.css');
  assert.match(js,/<details class="accounting-help"><summary>/);
  assert.match(css,/\.accounting-help summary:focus-visible/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.accounting-help/);
  assert.match(css,/@media\(max-width:700px\)/);
});