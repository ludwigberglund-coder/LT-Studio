const {test} = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/finance');
const R = require('../public/receivables-tools');
function fixture() {
  return F.normalize({settings: {}, journal: [{id:'j1', description:'Inbetalning 310001', number:'A1', batchNumber:'1000', date:'2026-01-03', rows:[{account:'1930',debit:100,credit:0},{account:'1510',debit:0,credit:100}]}], bankTransactions:[{id:'bank1',amount:100,date:'2026-01-03',invoiceId:'i1',status:'Matchad',journalNumber:'A1',batch:'1000'}], invoices:[
    {id:'i1',number:'310001',ocr:'310001',batchNumber:'1001',customer:'Kund A',customerNumber:'K-1',date:'2026-01-01',total:100,payments:[{id:'p1',amount:100,date:'2026-01-03',batch:'1000',journalNumber:'A1',bankId:'bank1'}]},
    {id:'i2',number:'310002',ocr:'310002',batchNumber:'1002',customer:'Kund A',customerNumber:'K-1',date:'2026-01-01',total:80,payments:[]},
    {id:'i3',number:'310003',ocr:'310003',batchNumber:'1003',customer:'Kund A',customerNumber:'K-1',date:'2026-01-01',credit:true,total:-30,payments:[]}
  ], supplierInvoices:[], activity:[]});
}
function execute(s, kind, p) {
  return R.execute(s,kind,p,entry=>{
    const j={...entry,id:'new'+s.journal.length,number:'A'+(s.journal.length+1),batchNumber:String(1100+s.journal.length)};
    assert.equal(F.sum(j.rows,'debit'), F.sum(j.rows,'credit'));
    s.journal.unshift(j); return j;
  },()=> 'new-payment');
}
test('Omföring har ny bunt, bevarar bankbelopp och original och uppdaterar båda fakturorna',()=>{
  const s=fixture(), original=structuredClone(s.journal[0]);
  const p={sourceBatch:'1000',targetInvoice:'310002',date:'2026-02-01',idempotencyKey:'once'};
  const result=execute(s,'reclassify',p);
  assert.notEqual(result.entry.batchNumber,'1000');
  assert.deepEqual(s.journal[1],original);
  assert.equal(F.remaining(s.invoices[0]),100);
  assert.equal(F.remaining(s.invoices[1]),-20);
  assert.equal(s.invoices[0].status,'Bokförd');
  assert.equal(s.invoices[1].status,'Överbetald');
  assert.equal(s.bankTransactions[0].amount,100);
  assert.equal(s.bankTransactions[0].journalNumber,'A1');
  assert.equal(s.bankTransactions[0].invoiceId,'i2');
  assert.equal(F.sum(result.entry.rows.filter(r=>r.account.startsWith('1930')),'debit'),0);
  for(const i of F.items(s,'customer'))assert.ok(F.rows(i).every(r=>r.remaining===i.remaining));
  assert.equal(execute(s,'reclassify',p).duplicate,true);
  assert.equal(s.journal.length,2);
  assert.throws(()=>execute(s,'reclassify',{...p,idempotencyKey:'again'}),/aktiv|entydig/);
});
test('Kvittning med faktura- och buntnummer samt överbetalning bevarar nettosaldot',()=>{
  const s=fixture();
  const before=F.totals(F.items(s,'customer')).open;
  execute(s,'offset',{creditInvoice:'1003',targetInvoice:'310002',amount:20,date:'2026-02-01'});
  assert.equal(F.remaining(s.invoices[2]),-10); assert.equal(F.remaining(s.invoices[1]),60);
  assert.equal(F.totals(F.items(s,'customer')).open,before);
  s.invoices[0].payments[0].amount=120;
  execute(s,'offset',{creditInvoice:'310001',targetInvoice:'1002',date:'2026-02-01'});
  assert.equal(F.remaining(s.invoices[0]),0); assert.equal(F.remaining(s.invoices[1]),40);
});
test('Fel kund, samma faktura, låst period, decimaler, datum och för stor kvittning stoppar utan ändringar',()=>{
  const attempts = [
    ['reclassify',{sourceBatch:'1000',targetInvoice:'310001',date:'2026-02-01'}],
    ['reclassify',{sourceBatch:'1000',targetInvoice:'310002',date:'2025-12-01'}],
    ['reclassify',{sourceBatch:'1000',targetInvoice:'310002',date:'2026-02-01',amount:1.5}],
    ['offset',{creditInvoice:'310003',targetInvoice:'310002',date:'2026-02-01',amount:31}],
    ['offset',{creditInvoice:'310003',targetInvoice:'310002',date:'2026-99-99'}]
  ];
  for(const [kind,p] of attempts){const s=fixture(),before=JSON.stringify(s);assert.throws(()=>execute(s,kind,p));assert.equal(JSON.stringify(s),before);}
  const locked=fixture();locked.settings.lockedPeriods=['2026-02'];assert.throws(()=>execute(locked,'reclassify',{sourceBatch:'1000',targetInvoice:'310002',date:'2026-02-01'}),/låst/);
  const other=fixture();other.invoices[1].customerNumber='K-2';assert.throws(()=>execute(other,'reclassify',{sourceBatch:'1000',targetInvoice:'310002',date:'2026-02-01'}),/samma kund/);
});
test('Omföring av bokförd bankpost vänder ursprungskontot utan dubbel bankbokning',()=>{
  const s=fixture();s.invoices[0].payments=[];
  Object.assign(s.bankTransactions[0],{status:'Bokförd',invoiceId:null});
  s.journal[0].rows[1].account='3010 Försäljning';
  const r=execute(s,'reclassify',{sourceBatch:'1000',targetInvoice:'310002',date:'2026-02-01'});
  assert.equal(r.entry.rows[0].account,'3010 Försäljning');assert.equal(r.entry.rows[0].debit,100);
  assert.equal(r.entry.rows[1].credit,100);assert.equal(s.bankTransactions[0].status,'Matchad');
});
