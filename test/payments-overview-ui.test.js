'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','bank.js'),'utf8');

test('bankvyn använder den privata betalningsöversikten',()=>{
  assert.match(source,/\/bank\/overview\?date=/);
  for(const id of ['day','week','month','quarter'])assert.match(source,new RegExp("data-period=.*"+id));
  assert.match(source,/In- och utbetalningar/);
  assert.match(source,/incomingOre/);
  assert.match(source,/outgoingOre/);
  assert.match(source,/netOre/);
});
