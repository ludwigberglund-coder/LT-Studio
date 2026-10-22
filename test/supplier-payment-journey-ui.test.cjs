'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../apps/portal/payables.js'),'utf8');

test('invoice approval points to planning without initiating payment',()=>{
  assert.match(html,/Godkänd – planera betalning/);
  assert.match(html,/Gå till betalningsplanering/);
  assert.match(html,/\.\/supplier-ledger\.html/);
});
test('supplier UI does not claim a prepared payment was executed',()=>{
  assert.match(html,/Betalning förberedd – inte bankbekräftad/);
  assert.match(html,/Fakturaattest och betalningsförberedelse skickar inte pengar till banken/);
});
test('legacy paid record is presented as system status rather than verified bank settlement',()=>{
  assert.match(html,/Registrerad som betald/);
  assert.match(html,/Det är inte i sig bevis på att banken har genomfört och stämt av betalningen/);
});
