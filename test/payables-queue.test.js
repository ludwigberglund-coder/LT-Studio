'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Queue=require('../apps/portal/payables-queue.js');

const invoices=[
  {id:'a',supplierName:'Zulu Grossist AB',supplierNumber:'L-3',supplierInvoiceNumber:'Z-9',dueDate:'2026-09-20',totalOre:10000,status:'registered'},
  {id:'b',supplierName:'Alpha Mat AB',supplierNumber:'L-1',supplierInvoiceNumber:'A-2',dueDate:'2026-09-18',totalOre:20000,status:'coded'},
  {id:'c',supplierName:'Beta Service AB',supplierNumber:'L-2',supplierInvoiceNumber:'B-7',dueDate:'2026-09-14',totalOre:30000,status:'approved'},
  {id:'d',supplierName:'Gamma AB',supplierNumber:'L-4',supplierInvoiceNumber:'G-1',dueDate:'2026-09-12',totalOre:40000,status:'paid'}
];

test('arbetskön grupperar fakturor efter arbetsläge',()=>{
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'coding'}).map(x=>x.id),['a']);
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'approval'}).map(x=>x.id),['b']);
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'payment'}).map(x=>x.id),['c']);
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'paid'}).map(x=>x.id),['d']);
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'open'}).map(x=>x.id),['a','b','c']);
});

test('sökning fungerar på leverantör och fakturanummer utan att påverka sorteringen',()=>{
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'all',query:'alpha'}).map(x=>x.id),['b']);
  assert.deepEqual(Queue.filterInvoices(invoices,{filter:'all',query:'B-7'}).map(x=>x.id),['c']);
});

test('öppna fakturor prioriteras efter arbetsläge och sedan förfallodatum',()=>{
  const sorted=Queue.filterInvoices([
    {...invoices[0],id:'x',supplierName:'X',dueDate:'2026-09-10'},
    {...invoices[0],id:'y',supplierName:'Y',dueDate:'2026-09-08'},
    invoices[1],invoices[2]
  ],{filter:'open'});
  assert.deepEqual(sorted.map(x=>x.id),['y','x','b','c']);
});

test('sammanställningen visar antal, belopp och verkligt förfallna öppna fakturor',()=>{
  const summary=Queue.summarizeInvoices(invoices,'2026-09-16');
  assert.equal(summary.counts.open,3);
  assert.equal(summary.amounts.open,60000);
  assert.equal(summary.overdueCount,1);
  assert.equal(summary.overdueOre,30000);
  assert.equal(Queue.daysPastDue('2026-09-14','2026-09-16'),2);
  assert.equal(Queue.daysPastDue('2026-09-18','2026-09-16'),0);
});
