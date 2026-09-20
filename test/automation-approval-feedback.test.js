'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','automation.js'),'utf8');

test('godkännande visar sann återkoppling innan nästa förslag',()=>{
  assert.match(source,/executionStatus==='not-executed'/);
  assert.match(source,/Förslaget har godkänts/);
  assert.match(source,/Ingen bokföring eller betalning genomfördes/);
  assert.doesNotMatch(source,/godkänts och bokförts/i);
  assert.match(source,/approval-confirmation/);
});
