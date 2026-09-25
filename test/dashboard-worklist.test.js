'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','dashboard.js'),'utf8');

test('dashboarden använder de viktigaste privata arbetsköerna',()=>{
  assert.match(source,/api\('\/receivables'\)/);
  for(const route of ['/bank/payments','/automation/proposals','/inventory/adjustments?status=pending','/accounting/unlock-requests?status=pending'])assert.ok(source.includes(route),route);
  assert.match(source,/\/payables\/invoices/);
});

test('dashboarden visar mjuk varning om någon viktig kö inte kan läsas',()=>{
  assert.match(source,/loadErrors/);
  assert.match(source,/Några köer kunde inte läsas just nu/);
  assert.match(source,/Övriga poster visas som vanligt/);
});

test('dashboarden är gles och visar högst sex konkreta uppgifter',()=>{
  assert.match(source,/return tasks\.slice\(0,6\)/);
  assert.match(source,/Följ upp förfallna kundfakturor/);
  assert.match(source,/Matcha bankhändelser/);
  assert.match(source,/Granska automationsförslag/);
  assert.doesNotMatch(source,/Alla områden/);
  assert.doesNotMatch(source,/Starta testguiden/);
  assert.doesNotMatch(source,/Öppet kundsaldo/);
});

test('dashboarden har hälsning för arbetsdagen och Supabase UAT-stöd',()=>{
  assert.match(source,/God morgon/);
  assert.match(source,/God eftermiddag/);
  assert.match(source,/God kväll/);
  assert.match(source,/LTSupabaseUat\.context/);
  assert.match(source,/supplier_invoices/);
  assert.match(source,/bank_payments/);
  assert.match(source,/automation_proposals/);
});
