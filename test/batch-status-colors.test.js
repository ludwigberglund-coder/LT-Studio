'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'apps','portal','batches.css'),'utf8');
const js=fs.readFileSync(path.join(root,'apps','portal','batches.js'),'utf8');

test('buntstatus har tydlig färgkodning i både ljust och mörkt läge',()=>{
  assert.match(js,/ready:'Redo för godkännande'/);
  assert.match(js,/approved:'Godkänd'/);
  assert.match(js,/rejected:'Avvisad'/);
  assert.match(css,/\.status-badge\.status-approved\{[\s\S]*?background:#e5f4e7!important;[\s\S]*?color:#215c2b!important/);
  assert.match(css,/\.status-badge\.status-ready\{[\s\S]*?background:#fff4cf!important;[\s\S]*?color:#6c5300!important/);
  assert.match(css,/\.status-badge\.status-rejected\{[\s\S]*?background:#fdeae6!important;[\s\S]*?color:#873123!important/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.batch-workspace \.status-badge\.status-approved/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.batch-workspace \.status-badge\.status-ready/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.batch-workspace \.status-badge\.status-rejected/);
});

test('statusmarkeringen förblir en kompakt pill och fyller inte hela högerspalten',()=>{
  assert.match(css,/\.batch-workspace \.status-badge\{[\s\S]*?min-width:76px;[\s\S]*?width:auto;[\s\S]*?height:auto;/);
});
