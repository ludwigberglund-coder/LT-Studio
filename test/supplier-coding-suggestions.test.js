'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Engine=require('../packages/automation/supplier-coding.js');

test('historik med samma konto ger starkt och förklarbart förslag',()=>{
  const invoice={id:'i-new',supplierId:'s1',supplierInvoiceNumber:'N-1',totalOre:125000,vatOre:25000};
  const history=[1,2,3].map(n=>({id:`i${n}`,status:'approved',coding:[{account:'4010',debitOre:80000,creditOre:0},{account:'2641',debitOre:20000,creditOre:0},{account:'2440',debitOre:0,creditOre:100000}]}));
  const suggestion=Engine.suggestSupplierCoding(invoice,{supplier:{defaultCostAccount:'5460'},history});
  assert.equal(suggestion.coding[0].account,'4010');
  assert.equal(suggestion.deterministic,true);
  assert.ok(suggestion.confidence>=.9);
  assert.match(suggestion.reason,/4010/);
  assert.ok(suggestion.evidence.some(row=>row.kind==='supplier-history'));
});

test('utan historik används leverantörens standardkonto men förslaget är redigerbart underlag',()=>{
  const suggestion=Engine.suggestSupplierCoding({id:'i1',supplierId:'s1',supplierInvoiceNumber:'A1',totalOre:100000,vatOre:20000},{supplier:{defaultCostAccount:'5460'},history:[]});
  assert.equal(suggestion.coding[0].account,'5460');
  assert.equal(suggestion.deterministic,false);
  assert.equal(suggestion.ambiguous,false);
  assert.equal(suggestion.coding.at(-1).account,'2440');
});

test('blandad historik sänker säkerheten och kan markeras tvetydig',()=>{
  const history=[
    {status:'approved',coding:[{account:'4010',debitOre:100,creditOre:0}]},
    {status:'approved',coding:[{account:'5460',debitOre:100,creditOre:0}]},
    {status:'approved',coding:[{account:'6110',debitOre:100,creditOre:0}]}
  ];
  const suggestion=Engine.suggestSupplierCoding({id:'i1',supplierId:'s1',supplierInvoiceNumber:'A1',totalOre:12500,vatOre:2500},{supplier:{defaultCostAccount:'4010'},history});
  assert.equal(suggestion.ambiguous,true);
  assert.ok(suggestion.confidence<.9);
});
