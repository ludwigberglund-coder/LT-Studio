'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','documents.js'),'utf8');

test('dokumentdialogen skapar requestId en gång och återanvänder det vid upload-retry',()=>{
  assert.match(source,/function modal\(\)\{const requestId=crypto\.randomUUID\(\)/);
  assert.match(source,/data-request-id="\$\{esc\(requestId\)\}"/);
  assert.match(source,/requestId:String\(form\.dataset\.requestId\|\|''\)/);
});

test('ny dokumentdialog får ny requestId först när användaren öppnar en ny uppladdning',()=>{
  assert.equal((source.match(/crypto\.randomUUID\(\)/g)||[]).length>=1,true);
  assert.match(source,/data-action="upload"/);
});
