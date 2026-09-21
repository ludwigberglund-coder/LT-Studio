'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Overview=require('../apps/api/payment-overview.js');

function source(name){
  return fs.readFileSync(path.join(__dirname,'..','apps','portal',name),'utf8');
}

test('betalningsstatus skiljer förberedd, frisläppt och betald från bokförd',()=>{
  assert.equal(Overview.paymentStatusLabel('in','posted'),'Bokförd inbetalning');
  assert.equal(Overview.paymentStatusLabel('out','prepared'),'Förberedd – ej frisläppt');
  assert.equal(Overview.paymentStatusLabel('out','released'),'Frisläppt – väntar bankbekräftelse');
  assert.equal(Overview.paymentStatusLabel('out','paid'),'Betald & bokförd');
});

test('leverantörsfakturor skiljer attest från bokförd skuld och betald faktura',()=>{
  const text=source('payables.js');
  assert.match(text,/approved:'Attesterad'/);
  assert.match(text,/Attesterad – skuld ej bokförd/);
  assert.match(text,/Betald & bokförd/);
  assert.match(text,/Bokför leverantörsskuld/);
  assert.doesNotMatch(text,/approved:'Bokförd'/);
});

test('automationskö säger uttryckligen att godkännande inte är genomförande',()=>{
  const text=source('automation.js');
  assert.match(text,/Godkänt – ej genomfört/);
  assert.match(text,/Godkännande är inte samma sak som genomförande/);
  assert.match(text,/Betalningen är bokförd/);
});

test('bank och lön använder bokförd endast när bokföring faktiskt skett',()=>{
  const bank=source('bank.js');
  const payroll=source('payroll.js');
  assert.match(bank,/posted:'Bokförd inbetalning'/);
  assert.match(payroll,/v==='posted'\?'Bokförd'/);
  assert.match(payroll,/v==='validated'\?'Validerad'/);
});
