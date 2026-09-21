'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','customers.js'),'utf8');

test('ny kund behåller samma requestId under hela skapandeförsöket',()=>{
  assert.match(source,/createRequestId=''/);
  assert.match(source,/createRequestId=crypto\.randomUUID\(\)/);
  assert.match(source,/if\(!updating&&!createRequestId\)createRequestId=crypto\.randomUUID\(\)/);
  assert.match(source,/body=updating\?payload:\{\.\.\.payload,requestId:createRequestId\}/);
});

test('kundens create-requestId nollställs efter avslut men används inte för PUT-redigering',()=>{
  assert.match(source,/editing=null;createRequestId=''/);
  assert.match(source,/method:updating\?'PUT':'POST'/);
  assert.match(source,/endpoint=updating\?'\/api\/v1\/customers\/'/);
});
