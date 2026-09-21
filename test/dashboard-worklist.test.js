'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','dashboard.js'),'utf8');

test('dashboarden använder riktiga privata arbetsköer',()=>{
  assert.match(source,/api\('\/receivables'\)/);
  assert.doesNotMatch(source,/receivables\/invoices/);
  for(const route of ['/bank/payments','/automation/proposals','/suppliers/pending-changes','/inventory/adjustments?status=pending','/accounting/unlock-requests?status=pending'])assert.ok(source.includes(route),route);
});

test('dashboarden visar fel som ofullständig arbetslista i stället för falska nollor',()=>{
  assert.match(source,/loadErrors/);
  assert.match(source,/Arbetslistan är ofullständig/);
  assert.match(source,/Nollvärden från dessa områden betyder inte att arbetet är klart/);
});

test('dashboarden prioriterar konkreta uppgifter före modulkatalogen',()=>{
  assert.match(source,/Vad behöver göras nu\?/);
  assert.match(source,/Förfallna kundfakturor/);
  assert.match(source,/Bankhändelser behöver matchas/);
  assert.match(source,/Förslag väntar på granskning/);
  assert.match(source,/Alla områden/);
});
