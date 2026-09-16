'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

function memoryStorage(){const data=new Map();return{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}}
global.localStorage=memoryStorage();
delete global.RollandsDemoScenario;
require('../apps/portal/demo-scenario.js');
const Demo=global.RollandsDemoScenario;

test('gemensamt demoscenario laddas och kan återställas',()=>{
  assert.ok(Demo);
  const state=Demo.state();
  assert.equal(state.version,Demo.VERSION);
  Demo.patch(next=>{next.bankPayments[0].status='proposal-created'});
  assert.equal(Demo.state().bankPayments[0].status,'proposal-created');
  assert.equal(Demo.reset().bankPayments[0].status,'unmatched');
});

test('bankmatchning 310002 använder samma restbelopp och faktura i alla lager',()=>{
  const state=Demo.reset();
  const payment=state.bankPayments.find(row=>row.reference==='310002');
  const invoice=state.customerInvoices.find(row=>row.invoiceNumber==='310002');
  const proposal=state.automationProposals.find(row=>row.type==='bank-payment-match'&&row.suggestion.invoiceNumber==='310002');
  assert.ok(payment&&invoice&&proposal);
  assert.equal(payment.amountOre,392500);
  assert.equal(invoice.remainingOre,payment.amountOre);
  assert.equal(proposal.review.amountOre,payment.amountOre);
  assert.equal(proposal.suggestion.invoiceId,invoice.id);
  assert.deepEqual(proposal.review.accountingLines.map(row=>[row.account,row.debitOre,row.creditOre]),[['1930',392500,0],['1510',0,392500]]);
});

test('automationsförslag för leverantörsfaktura pekar på verklig demofaktura och leverantör',()=>{
  const state=Demo.reset();
  const proposal=state.automationProposals.find(row=>row.type==='supplier-invoice-coding');
  const invoice=state.supplierInvoices.find(row=>row.id===proposal.sourceId);
  const supplier=state.suppliers.find(row=>row.id===invoice.supplierId);
  assert.equal(invoice.supplierInvoiceNumber,'KE-2088');
  assert.equal(supplier.name,'Kustens Emballage AB');
  assert.equal(proposal.context.supplierName,supplier.name);
  assert.equal(proposal.review.amountOre,invoice.totalOre);
});

test('dokumentkopplingar till leverantörsfaktura pekar på befintliga fakturor',()=>{
  const state=Demo.reset();
  const ids=new Set(state.supplierInvoices.map(row=>row.id));
  const links=state.documents.flatMap(document=>(document.links||[]).filter(link=>link.entityType==='supplier-invoice'));
  assert.ok(links.length>=2);
  for(const link of links)assert.ok(ids.has(link.entityId),`Saknad leverantörsfaktura för dokumentlänk ${link.entityId}`);
});

test('bokförd leverantörsbetalning GF-8821 har motsvarande betalning och balanserad verifikation',()=>{
  const state=Demo.reset();
  const payment=state.supplierPayments.find(row=>row.supplierInvoiceNumber==='GF-8821');
  const entry=state.accountingEntries.find(row=>row.sourceId===payment.id);
  assert.ok(entry);
  const debit=entry.lines.reduce((sum,row)=>sum+row.debitOre,0);
  const credit=entry.lines.reduce((sum,row)=>sum+row.creditOre,0);
  assert.equal(debit,payment.amountOre);
  assert.equal(debit,credit);
  assert.deepEqual(entry.lines.map(row=>row.account),['2440','1930']);
});
