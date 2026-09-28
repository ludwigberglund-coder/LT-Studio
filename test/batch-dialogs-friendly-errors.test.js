'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/portal/batches.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/batches.css'),'utf8');

test('batch approval and approval errors stay inside LT Studio UI',()=>{
  assert.match(js,/function confirmBatchApproval\(\)/);
  assert.match(js,/await confirmBatchApproval\(\)/);
  assert.match(js,/function showBatchError\(error\)/);
  assert.match(js,/await showBatchError\(err\)/);
  assert.doesNotMatch(js,/confirm\('Godkänna bunten\?/);
  assert.doesNotMatch(js,/catch\(err\)\{alert\(/);
});

test('batch errors translate backend codes into useful Swedish copy',()=>{
  assert.match(js,/BATCH_NOT_BALANCED:\{title:'Bunten är inte balanserad'/);
  assert.match(js,/TRANSACTION_NOT_BALANCED:/);
  assert.match(js,/EXTERNAL_TOTAL_MISMATCH:/);
  assert.match(js,/PERIOD_LOCKED:/);
  assert.match(js,/Teknisk information/);
});

test('batch approval checks visible balance state before RPC',()=>{
  assert.match(js,/function batchLooksBalanced\(\)/);
  assert.match(js,/if\(!batchLooksBalanced\(\)\)\{await showBatchError\(new Error\('BATCH_NOT_BALANCED'\)\);return\}/);
});

test('batch dialogs support accessibility, dark mode and reduced motion',()=>{
  assert.match(js,/role="dialog"/);
  assert.match(js,/aria-modal="true"/);
  assert.match(js,/if\(e\.key==='Escape'\)/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.batch-confirm-modal/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
