'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps/portal/batches.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/batches.css'),'utf8');

test('batch approval uses LT Studio modal instead of browser confirm',()=>{
  assert.match(js,/async function confirmBatchApproval\(\)/);
  assert.match(js,/await confirmBatchApproval\(\)/);
  assert.doesNotMatch(js,/confirm\('Godkänna bunten\?/);
});

test('batch approval modal has accessible dialog semantics and keyboard escape',()=>{
  assert.match(js,/role="dialog"/);
  assert.match(js,/aria-modal="true"/);
  assert.match(js,/aria-labelledby="batch-confirm-title"/);
  assert.match(js,/if\(e\.key==='Escape'\)close\(false\)/);
});

test('batch approval modal includes light and dark theme styling',()=>{
  assert.match(css,/\.batch-confirm-modal\{/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.batch-confirm-modal/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.batch-confirm-actions \.button\.ghost/);
});
