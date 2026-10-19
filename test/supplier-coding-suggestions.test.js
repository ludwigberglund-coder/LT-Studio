'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Engine=require('../packages/automation/supplier-coding.js');

const sha=n=>n.toString(16).padStart(64,'0');
const invoice=changes=>({
  id:'new-invoice',companyId:'company-a',supplierId:'supplier-a',
  supplierInvoiceNumber:'NEW-1',currency:'SEK',vatTreatment:'se-domestic-full-input-vat',
  totalOre:125000,vatOre:25000,...changes
});
const posted=(n,changes={})=>({
  id:'old-'+n,companyId:'company-a',supplierId:'supplier-a',
  status:'approved',approvedBy:'human-reviewer',approvedAt:'2026-10-01T12:00:00Z',
  liabilityAccountingEntryId:'journal-'+n,liabilityPostedAt:'2026-10-02T12:00:00Z',
  documentSha256:sha(n),currency:'SEK',vatTreatment:'se-domestic-full-input-vat',
  totalOre:100000,vatOre:20000,
  coding:[
    {account:'4010',debitOre:80000,creditOre:0},
    {account:'2641',debitOre:20000,creditOre:0},
    {account:'2440',debitOre:0,creditOre:100000}
  ],...changes
});
const suggest=(history=[],changes={})=>Engine.suggestSupplierCoding(invoice(changes),{
  supplier:{companyId:'company-a',defaultCostAccount:'5460'},history
});
const manual=result=>{
  assert.equal(result.deterministic,false);
  assert.ok(result.confidence<.9);
  assert.equal(result.coding.reduce((total,line)=>total+line.debitOre-line.creditOre,0),0);
};

test('three independent, approved and posted originals support a traceable high-confidence human review',()=>{
  const result=suggest([posted(1),posted(2),posted(3)]);
  assert.equal(result.coding[0].account,'4010');
  assert.equal(result.deterministic,true);
  assert.equal(result.ambiguous,false);
  assert.ok(result.confidence>=.9);
  assert.match(result.reason,/personlig granskning/);
  assert.ok(result.evidence.some(e=>e.kind==='supplier-history'&&e.value.includes('3 av 3')));
});

test('one previously approved or posted invoice is never 96% confident',()=>{
  for(const example of [posted(1),posted(1,{liabilityAccountingEntryId:null}),posted(1,{liabilityPostedAt:null}),
    posted(1,{documentSha256:null}),posted(1,{approvedBy:null})]){
    const result=suggest([example]);
    manual(result);
    assert.equal(result.coding[0].account,'5460');
    assert.ok(!result.evidence.some(e=>e.kind==='supplier-history'));
  }
});

test('three copies of the same original or invoice are not independent evidence',()=>{
  for(const collection of [
    [posted(1),posted(1),posted(1)],
    [posted(1),posted(2,{documentSha256:sha(1)}),posted(3,{documentSha256:sha(1)})],
    [posted(1),posted(2,{id:'old-1'}),posted(3,{id:'old-1'})]
  ]){
    const result=suggest(collection);
    manual(result);assert.equal(result.coding[0].account,'5460');
  }
});

test('different reviewed accounts or conflicting duplicate originals require manual consideration',()=>{
  const item=(n,account)=>posted(n,{coding:[
    {account,debitOre:80000,creditOre:0},{account:'2641',debitOre:20000,creditOre:0},
    {account:'2440',debitOre:0,creditOre:100000}
  ]});
  const mixed=suggest([item(1,'4010'),item(2,'5460'),item(3,'6110')]);
  manual(mixed);assert.equal(mixed.ambiguous,true);
  const collision=suggest([posted(1),item(2,'5460'),posted(3),posted(4,{documentSha256:sha(2)})]);
  manual(collision);assert.equal(collision.ambiguous,true);
});

test('wrong company, supplier, VAT, accounting rows or foreign currency cannot teach an account',()=>{
  const variants=[
    {companyId:'company-b'},{supplierId:'supplier-b'}, {currency:'EUR'},
    {vatTreatment:'reverse-charge'},{vatOre:10000},{status:'registered'},
    {coding:[{account:'1930',debitOre:80000,creditOre:0},
      {account:'2641',debitOre:20000,creditOre:0},{account:'2440',debitOre:0,creditOre:100000}]},
    {coding:[{account:'4010',debitOre:70000,creditOre:0},
      {account:'2641',debitOre:20000,creditOre:0},{account:'2440',debitOre:0,creditOre:100000}]}
  ];
  for(const variant of variants){
    const result=suggest([posted(1,variant),posted(2,variant),posted(3,variant)]);
    manual(result);assert.equal(result.coding[0].account,'5460');
  }
  assert.throws(()=>Engine.suggestSupplierCoding(invoice(),{
    supplier:{companyId:'company-b',defaultCostAccount:'4010'},history:[posted(1)]
  }),/annat företag/);
});

test('without qualifying history fallback is low confidence and never automatic',()=>{
  const result=suggest([]);
  manual(result);
  assert.equal(result.coding[0].account,'5460');
  assert.equal(result.ambiguous,false);
  const noSupplier=Engine.suggestSupplierCoding(invoice(),{supplier:null,history:[]});
  manual(noSupplier);assert.equal(noSupplier.coding[0].account,'4010');
  const prohibited=Engine.suggestSupplierCoding(invoice(),{
    supplier:{companyId:'company-a',defaultCostAccount:'2440'},history:[]});
  manual(prohibited);assert.equal(prohibited.coding[0].account,'4010');
});

test('legacy tenant-scoped history SQL fetches posted and PDF provenance rather than only status',()=>{
  const sql=fs.readFileSync(require.resolve('../apps/api/payables.js'),'utf8');
  const query=sql.slice(sql.indexOf('function supplierHistory('),sql.indexOf('function storeDocument('));
  assert.ok(query);
  for(const name of ['company_id AS companyId','supplier_id AS supplierId',
    'approved_by AS approvedBy','liability_accounting_entry_id AS liabilityAccountingEntryId',
    'liability_posted_at AS liabilityPostedAt','document_sha256 AS documentSha256',
    'vat_treatment AS vatTreatment'])
    assert.ok(query.includes(name),name);
  assert.match(query,/WHERE company_id=\? AND supplier_id=\?/);
});
