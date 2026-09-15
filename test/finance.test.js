const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.ROLLANDS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rollands-reskontra-test-'));
const F = require('../public/finance.js');
const Model = require('../public/invoice-model.js');
const { server, seedState, registerPayment, registerPayout, autoBookMatches, applyOffset } = require('../server.js');
let base;
before(async () => { await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port; });
after(async () => { await new Promise(resolve=>server.close(resolve)); });
function fixture() {
  return F.normalize({ invoices: [{id:'i1',number:'R-1',customer:'Kund A',date:'2026-01-01',dueDate:'2026-01-31',total:1250,net:1000,vat:250,status:'Bokförd',paid:false}], supplierInvoices:[], journal:[], bankTransactions:[], activity:[] });
}
function pay(amount, reference='REF-1') { return {amount,reference,method:'Bank',date:'2026-02-01',idempotencyKey:reference}; }

test('Manuell överbetalning ger negativt saldo som kan kvittas utan att tappa bokföring',()=>{
  const store=fixture(), invoice=store.invoices[0];
  registerPayment(store,'customer',invoice,pay(1500,'OVER'));
  assert.equal(F.remaining(invoice),-250);assert.equal(invoice.status,'Överbetald');
  assert.equal(F.items(store,'customer',{status:'open'}).length,1);
  assert.equal(F.items(store,'customer',{status:'credit'}).length,1);
  assert.equal(F.rows(F.items(store,'customer')[0]).at(-1).remaining,-250);
  assert.ok(F.csv(F.items(store,'customer')).includes('-250'));
  const second={...invoice,id:'i2',number:'R-2',total:500,net:400,vat:100,payments:[],status:'Bokförd',offsets:[],offsetAmount:0};store.invoices.push(second);
  applyOffset(store,invoice,second,200);assert.equal(F.remaining(invoice),-50);assert.equal(F.remaining(second),300);
  assert.equal(F.rows(F.items(store,'customer').find(i=>i.id==='i1')).at(-1).remaining,-50);
  assert.equal(F.totals(F.items(store,'customer')).open,250);
  assert.throws(()=>applyOffset(store,invoice,second,51),/restbeloppen/);
  for(const j of store.journal)assert.equal(j.rows.reduce((n,r)=>n+F.cents(r.debit)-F.cents(r.credit),0),0);
});
test('Avinummersökning tar fram hela rätt kund och attest prioriteras vid 1–5 dagar',()=>{
  const store=fixture();const i=store.invoices[0];store.invoices.push({...i,id:'other',number:'R-2',status:'Betald',payments:[{amount:1250}]});
  store.invoices.push({...i,id:'another',number:'B-1',customer:'Kund B',customerNumber:'K-9000'});
  const groups=F.customerGroups(store,'R-1');assert.equal(groups.length,1);assert.equal(groups[0].invoices.length,2);
  assert.equal(F.customerGroups(store,'saknas').length,0);
  for(const d of [-1,0,1,5,6]){
    const due=Model.dueDate('2026-02-01',d);
    const s={id:'s'+d,supplier:'Leverantör',invoiceNumber:'S'+d,received:'2026-01-01',dueDate:due,total:100,status:'Attest väntar',payments:[]};
    assert.equal(!!F.supplierAlert(s,'2026-02-01'),d<=5);store.supplierInvoices.push(s);
  }
  const priorities=F.dashboard(store,'2026-02-01').priorities;
  assert.equal(priorities.filter(p=>p.rank===0).length,4);assert.match(priorities[0].label,/ATTEST/);
});

test('Fakturarader: blandad moms, heltalsavrundning, egna konton och kredit vänder konteringen',()=>{
  const lines=[{description:'Äpplen',amount:100,vatRate:12,account:'3052'},{description:'Tjänst',amount:200,vatRate:25,account:'3041'},{description:'Övrigt',amount:10,vatRate:0,account:'3054'}];
  const a=Model.calculate(lines), b=Model.calculate(lines,true);
  assert.equal(a.net,310);assert.equal(a.vat,62);assert.equal(a.total,372);
  assert.equal(b.total,-372);
  assert.equal(a.rows.reduce((n,r)=>n+F.cents(r.debit)-F.cents(r.credit),0),0);
  a.rows.forEach((r,i)=>{assert.equal(r.debit,b.rows[i].credit);assert.equal(r.credit,b.rows[i].debit);});
  assert.throws(()=>Model.calculate([{...lines[0],account:'1930'}]),/intäktskonto/);
  assert.throws(()=>Model.calculate([{...lines[0],amount:1.5}]),/hela kronor/);
  assert.equal(Model.dueDate('2026-01-31',30),'2026-03-02');
  assert.equal(Model.ocr('123456'),'123456');
  assert.equal(Model.ocr('2026-1007'),'261007');
});

test('Ny faktura sparar PDF, kontakt och adress; återförsök och samtidighet ger unika fakturanummer',async()=>{
  async function post(url,data){const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
  let r=await post('/api/invoice-settings',{invoiceContact:'Anna Åberg',registeredOffice:'Göteborg',paymentAccount:'TESTKONTO 123-456',vatNumber:'SE556406505901'});assert.equal(r.status,200);
  const payload={customer:'PDF-kund AB',address:'Äppelvägen 22\n412 50 Göteborg',reference:'Östen',date:'2026-09-14',paymentTerms:30,idempotencyKey:'PDF-TEST-1',lines:[{description:'Frukt till kontoret',amount:100,account:'3052',vatRate:12},{description:'Leverans',amount:50,account:'3041',vatRate:25}]};
  const [a,b]=await Promise.all([post('/api/invoices',payload),post('/api/invoices',payload)]);
  assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(a.data.invoice.number,b.data.invoice.number);
  const invoice=a.data.invoice;assert.equal(invoice.ourContact,'Anna Åberg');assert.equal(invoice.address,payload.address);assert.equal(invoice.dueDate,'2026-10-14');assert.equal(invoice.total,175);
  const pdf=await fetch(base+'/api/invoices/'+invoice.id+'/pdf');assert.equal(pdf.headers.get('content-type'),'application/pdf');const bytes=Buffer.from(await pdf.arrayBuffer());assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
  await post('/api/invoice-settings',{invoiceContact:'Ny kontakt',registeredOffice:'Billdal',paymentAccount:'NYTT TESTKONTO',vatNumber:'SE556406505901'});
  const again=Buffer.from(await (await fetch(base+'/api/invoices/'+invoice.id+'/pdf')).arrayBuffer());assert.deepEqual(again,bytes);
  const count=(await (await fetch(base+'/api/state')).json()).invoices.length;
  r=await post('/api/invoices',{...payload,idempotencyKey:'INVALID',address:''});assert.equal(r.status,422);
  assert.equal((await (await fetch(base+'/api/state')).json()).invoices.length,count);
  const [c,d]=await Promise.all([post('/api/invoices',{...payload,idempotencyKey:'UNIQUE-1'}),post('/api/invoices',{...payload,idempotencyKey:'UNIQUE-2'})]);assert.notEqual(c.data.invoice.number,d.data.invoice.number);
});

test('Alla rader visar aktuellt restbelopp efter delbetalning och slutbetalning',()=>{
  const store=fixture(), i=store.invoices[0];
  registerPayment(store,'customer',i,pay(400));
  assert.equal(i.status,'Delbetald'); assert.equal(F.remaining(i),850);
  let ledger=F.items(store,'customer',{today:'2026-02-02'});
  assert.deepEqual(F.rows(ledger[0]).map(r=>r.remaining),[850,850]);
  assert.equal(F.totals(ledger).overdue,850);
  registerPayment(store,'customer',i,pay(850,'REF-2'));
  assert.equal(i.status,'Betald'); assert.equal(F.remaining(i),0);
  assert.deepEqual(F.rows(F.items(store,'customer')[0]).map(r=>r.remaining),[0,0,0]);
  assert.equal(F.items(store,'customer',{status:'open'}).length,0);
  for(const j of store.journal) assert.equal(j.rows.reduce((n,r)=>n+F.cents(r.debit)-F.cents(r.credit),0),0);
});

test('återbetalning av kundtillgodo skapar utbetalningsverifikation', () => {
  const store = seedState(); const i = store.invoices[0];
  registerPayment(store,'customer',i,{...pay(6000,'OVERPAY'),date:'2026-09-10'});
  assert.equal(F.remaining(i),-1000);
  registerPayout(store,'customer',i,{amount:1000,date:'2026-09-14',method:'Bank',reference:'REFUND-1',reason:'Överbetalning'});
  assert.equal(F.remaining(i),0); assert.equal(i.status,'Återbetald');
  assert.match(store.journal[0].description,/Återbetalning/);
  assert.equal(F.rows(F.items(store,'customer').find(x=>x.id===i.id)).at(-1).remaining,0);
});
test('Ogiltigt belopp, dubbelregistrering, framtida datum och fel riktning skapar ingen extra verifikation',()=>{
  const store=fixture(), i=store.invoices[0];
  assert.throws(()=>registerPayment(store,'customer',i,pay(-1)),/positivt/);
  assert.throws(()=>registerPayment(store,'customer',i,{...pay(1),date:'2999-01-01'}),/Betalningsdatum/);
  assert.throws(()=>registerPayment(store,'customer',i,pay(10),{amount:-10}),/riktning/);
  registerPayment(store,'customer',i,pay(100));
  registerPayment(store,'customer',i,pay(100));
  assert.equal(store.journal.length,1);
  assert.throws(()=>registerPayment(store,'customer',i,{...pay(100),idempotencyKey:'different'}),/Bankreferensen/);
});
test('Leverantörsfaktura måste attesteras och utbetalning minskar 2440',()=>{
  const store=fixture(); const i={id:'s1',supplier:'Leverantör',invoiceNumber:'L-1',received:'2026-01-01',dueDate:'2026-02-01',total:500,status:'Attest väntar',payments:[]}; store.supplierInvoices.push(i);
  assert.equal(F.totals(F.items(store,'supplier')).open,0);
  assert.equal(F.totals(F.items(store,'supplier')).pending,500);
  assert.throws(()=>registerPayment(store,'supplier',i,pay(100)),/Attestera/);
  i.status='Bokförd'; registerPayment(store,'supplier',i,pay(100));
  assert.equal(F.remaining(i),400); assert.equal(store.journal[0].rows[0].account,'2440 Leverantörsskulder');
  assert.equal(store.journal[0].rows[0].debit,100);
});
test('Automatchning kräver referens OCH restbelopp, annan valuta lämnas för granskning',()=>{
  const store=fixture();
  const tx=(id,text,amount=1250)=>({id,transactionRef:id,text,date:'2026-02-01',amount,reference:''});
  const missing=tx('no-ref','Okänd betalare');
  const wrongAmount=tx('wrong-amount','R-1',800);
  const currency={...tx('eur','R-1'),currency:'EUR'};
  const good=tx('exact','Betalning R-1');
  const duplicate=tx('duplicate','R-1');
  assert.equal(autoBookMatches(store,[missing,wrongAmount,currency,good,duplicate]).length,1);
  assert.equal(good.status,'Matchad');
  for(const t of [missing,wrongAmount,currency,duplicate]) assert.equal(t.status,'Granska');
  assert.equal(store.journal.length,1); assert.equal(store.invoices[0].payments.length,1);
});
test('Genererad OCR matchar en unik faktura med rätt belopp',()=>{
  const store=fixture();store.invoices[0].ocr=Model.ocr('2026-1001');
  const tx={id:'ocr',transactionRef:'OCR-TEST',text:'Betalning '+store.invoices[0].ocr,date:'2026-02-01',amount:1250,reference:''};
  assert.equal(autoBookMatches(store,[tx]).length,1);assert.equal(F.remaining(store.invoices[0]),0);
});
test('Reskontrafilter, åldersintervall och CSV med exakt kolumnordning',()=>{
  const store=fixture();
  const i=F.items(store,'customer',{today:'2026-03-05'})[0];
  assert.equal(F.aging([i])[2].value,1250);
  assert.equal(F.items(store,'customer',{period:'2026-02'}).length,0);
  assert.equal(F.items(store,'customer',{search:'kund a'}).length,1);
  assert.equal(F.items(store,'customer',{status:'paid'}).length,0);
  assert.equal(F.items(store,'customer',{status:'age2',today:'2026-03-05'}).length,1);
  assert.equal(F.items(store,'customer',{status:'age1',today:'2026-03-05'}).length,0);
  assert.deepEqual(F.headers,['Period','Avityp','Bet sätt','Avinr','Bokfdatum avi/fakt','Avibelopp','Ffd','Buntnr','Bokfdatum trans','Bokntyp','Transnr','Transbelopp','Restbelopp']);
  const csv=F.csv([{...i,party:'=HYPERLINK(1)'}]);
  assert.ok(csv.includes('"\'=HYPERLINK(1)"'));
  assert.equal(F.values(F.rows(i)[0]).length,13);
  assert.equal(F.totals([i]).invoiced,1250);
});
test('Migrering bevarar tidigare betalstatus och skapar inga påhittade betalningsdatum',()=>{
  const s=F.normalize(seedState());
  assert.equal(s.invoices.find(i=>i.id==='inv_1004').payments[0].date,'2026-09-10');
  assert.equal(s.invoices.find(i=>i.id==='inv_1003').payments[0].date,null);
  assert.equal(s.supplierInvoices.find(i=>i.id==='sup_110').status,'Betald');
  assert.equal(s.supplierInvoices.find(i=>i.id==='sup_111').bookedDate,'2026-09-09');
  assert.equal(s.supplierInvoices.find(i=>i.id==='sup_111').journalNumber,'A23');
  const before=JSON.stringify(s); F.normalize(s); assert.equal(JSON.stringify(s),before);
});
test('API: omföring och kvittning sparar spårbara buntar och stoppar återförsök',async()=>{
  async function post(url,data) { const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); return {status:r.status,data:await r.json()}; }
  const input={customer:'Omföringskund',net:100,vatRate:0,date:'2026-01-01',dueDate:'2026-01-31'};
  const a=(await post('/api/invoices',input)).data.invoice;
  const b=(await post('/api/invoices',input)).data.invoice;
  const creditResponse=await post('/api/invoices',{...input,address:'Testgatan 1',invoiceType:'credit',paymentTerms:30,lines:[{description:'Retur',amount:20,account:'3054',vatRate:0}]});
  assert.equal(creditResponse.status,201,JSON.stringify(creditResponse.data));
  const credit=creditResponse.data.invoice;
  const payment=await post('/api/payments',{kind:'customer',invoiceId:a.id,...pay(100,'MOVE-API')});
  const payload={sourceBatch:payment.data.payment.batch,targetInvoice:b.number,date:'2026-02-01',idempotencyKey:'MOVE-ONCE'};
  const result=await post('/api/receivables/reclassify',payload);
  assert.equal(result.status,200); assert.match(result.data.reclassification.entry.batchNumber,/^\d{4}$/);
  assert.equal(F.remaining(result.data.store.invoices.find(i=>i.id===a.id)),100);
  assert.equal(F.remaining(result.data.store.invoices.find(i=>i.id===b.id)),0);
  const again=await post('/api/receivables/reclassify',payload);
  assert.equal(again.data.store.journal.length,result.data.store.journal.length);
  const offset=await post('/api/receivables/offset',{creditInvoice:credit.batchNumber,targetInvoice:a.number,date:'2026-02-01',idempotencyKey:'OFFSET-ONCE'});
  assert.equal(offset.status,200); assert.equal(F.remaining(offset.data.store.invoices.find(i=>i.id===a.id)),80);
  const saved=await (await fetch(base+'/api/state')).json();
  assert.equal(F.remaining(saved.invoices.find(i=>i.id===credit.id)),0);
  assert.ok(F.rows(F.items(saved,'customer').find(i=>i.id===a.id)).every(r=>r.remaining===80));
});

test('Bedöm bankhändelse begränsar fakturor och konton efter betalningsriktning',async()=>{
  async function post(data) {const r=await fetch(base+'/api/bank/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
  const initial=await (await fetch(base+'/api/state')).json();
  const tx=initial.bankTransactions.find(t=>t.status==='Granska' && t.amount<0);
  assert.ok(tx);
  assert.equal((await post({id:tx.id,action:'match',invoiceId:initial.invoices[0].id})).status,422);
  assert.equal((await post({id:tx.id,action:'book',account:'3010 Försäljning'})).status,422);
  assert.equal((await post({id:tx.id,action:'book',account:'1930 Företagskonto'})).status,422);
  assert.equal((await (await fetch(base+'/api/state')).json()).journal.length,initial.journal.length);
  const cost=require('../public/account-plan').accounts.find(a=>/^4/.test(a.code));
  const result=await post({id:tx.id,action:'book',account:cost.code+' '+cost.name});
  assert.equal(result.status,200);
  assert.equal(result.data.store.journal[0].rows[0].debit,Math.abs(tx.amount));
  assert.equal(result.data.store.journal[0].rows[1].credit,Math.abs(tx.amount));
  assert.equal((await post({id:tx.id,action:'book',account:cost.code})).status,409);
  const incoming=initial.bankTransactions.find(t=>t.status==='Granska' && t.amount>0);
  assert.ok(incoming);
  assert.equal((await post({id:incoming.id,action:'match',invoiceId:initial.supplierInvoices[0].id})).status,422);
  assert.equal((await post({id:incoming.id,action:'book',account:cost.code})).status,422);
  const revenue=require('../public/account-plan').accounts.find(a=>/^3/.test(a.code));
  const receipt=await post({id:incoming.id,action:'book',account:revenue.code});
  assert.equal(receipt.status,200);
  assert.equal(receipt.data.store.journal[0].rows[0].account,'1930 Företagskonto');
  assert.equal(receipt.data.store.journal[0].rows[0].debit,incoming.amount);
  assert.equal(receipt.data.store.journal[0].rows[1].credit,incoming.amount);
});

test('API: faktura, delbetalning, reskontraexport, restbetalning och idempotent återförsök',async()=>{
  async function post(url,data) { const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); return {status:r.status,data:await r.json()}; }
  let r=await post('/api/invoices',{customer:'Integrationskund',net:1000,vatRate:12,date:'2026-01-01',dueDate:'2026-01-31'});
  assert.equal(r.status,201); const i=r.data.invoice;
  assert.equal(i.total,1120); assert.equal(i.channel,'Ej skickad');
  assert.equal(r.data.store.journal[0].rows[2].account,'2621 Utgående moms 12 %');
  const payload={kind:'customer',invoiceId:i.id,...pay(120,'API-1')};
  r=await post('/api/payments',payload); assert.equal(r.status,201);
  assert.equal(F.remaining(r.data.store.invoices[0]),1000);
  const n=r.data.store.journal.length;
  r=await post('/api/payments',payload); assert.equal(r.status,200); assert.equal(r.data.store.journal.length,n);
  r=await post('/api/payments',{...payload,...pay(-1,'API-INVALID')}); assert.equal(r.status,400);
  const csv=await (await fetch(base+'/api/export/reskontra?kind=customer&search=Integrationskund')).text();
  assert.ok(csv.includes('Transbelopp')); assert.ok(csv.includes('-120')); assert.ok(csv.includes('1000'));
  r=await post('/api/payments',{...payload,...pay(1000,'API-2')}); assert.equal(r.status,201);
  assert.equal(r.data.store.invoices[0].status,'Betald');
  assert.equal(F.remaining(r.data.store.invoices[0]),0);
});

test('Kund- och leverantörsregister summerar reskontra utan att duplicera saldon',()=>{
  const store=fixture();
  store.invoices.push({...store.invoices[0],id:'i2',number:'R-2',total:500,net:400,vat:100,payments:[{amount:100,date:'2026-02-01',method:'Bank',reference:'P2'}]});
  store.supplierInvoices.push({id:'s1',supplier:'Leverantör A',supplierNumber:'L-1',invoiceNumber:'S-1',received:'2026-01-10',dueDate:'2026-01-31',total:800,status:'Attest väntar',payments:[]});
  const customers=F.partyDirectory(store,'customer');
  const suppliers=F.partyDirectory(store,'supplier');
  assert.equal(customers.length,1);
  assert.equal(customers[0].open,1650);
  assert.equal(F.partyDirectory(store,'customer','kund a').length,1);
  assert.equal(suppliers.length,1);
  assert.equal(suppliers[0].pending,800);
});
