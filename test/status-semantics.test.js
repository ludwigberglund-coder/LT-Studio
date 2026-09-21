'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function source(file){
  return fs.readFileSync(path.join(__dirname,'..',file),'utf8');
}

test('leverantörsfakturor skiljer attest från bokföring och betalning',()=>{
  const s=source('apps/portal/payables.js');
  assert.match(s,/approved:'Attesterad'/);
  assert.match(s,/Attesterad – skuld ej bokförd/);
  assert.match(s,/Bokför leverantörsskuld/);
  assert.match(s,/payment-prepared':'Betalning förberedd'/);
  assert.match(s,/released:'Frisläppt – väntar bankbekräftelse'/);
  assert.match(s,/paid:'Betald & bokförd'/);
  assert.doesNotMatch(s,/approved:'Bokförd'/);
  assert.doesNotMatch(s,/payment-prepared':'Betald/);
});

test('automationskön skiljer godkännande från genomförande och bokföring',()=>{
  const s=source('apps/portal/automation.js');
  assert.match(s,/'approved':'Godkänt – ej genomfört'/);
  assert.match(s,/Godkänd av människa men ännu inte bokförd/);
  assert.match(s,/Godkännande är inte samma sak som genomförande/);
  assert.match(s,/Bokför kundbetalning/);
  assert.match(s,/executionStatus==='executed'.*return'Bokförd'/);
  assert.doesNotMatch(s,/'approved':'Bokförd'/);
});

test('betalningsöversikten skiljer förberedd, frisläppt och betald',()=>{
  const s=source('apps/portal/payments.js');
  assert.match(s,/'out:prepared':'Förberedd – ej frisläppt'/);
  assert.match(s,/'out:released':'Frisläppt – väntar bankbekräftelse'/);
  assert.match(s,/'out:paid':'Betald & bokförd'/);
  assert.match(s,/'in:posted':'Bokförd inbetalning'/);
  assert.doesNotMatch(s,/'out:prepared':'Betald/);
  assert.doesNotMatch(s,/'out:released':'Betald/);
});

test('bankvyn kallar granskning granskning och bokförd betalning först posted',()=>{
  const s=source('apps/portal/bank.js');
  assert.match(s,/reviewed:'Granskad'/);
  assert.match(s,/posted:'Bokförd inbetalning'/);
  assert.match(s,/Ingen rad bokförs automatiskt från denna vy/);
  assert.doesNotMatch(s,/reviewed:'Bokförd/);
});

test('kundfakturautkast beskriver sparat som inte bokfört',()=>{
  const s=source('apps/portal/invoices.js');
  assert.match(s,/Utkastet är sparat i företagets privata databas\. Det är inte bokfört/);
  assert.match(s,/Skapa och bokför faktura/);
  assert.match(s,/Inget skickas till kund eller bank/);
});
