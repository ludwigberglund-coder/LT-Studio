'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Invoice=require('../packages/invoicing/invoice.js');
const {createInvoicePdf}=require('../packages/invoicing/pdf.js');
const {PDFDocument}=require('pdf-lib');
const {example,state}=require('./fixtures/invoice-example.js');
const {groups}=require('../apps/portal/portal-nav.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function balance(lines){return lines.reduce((n,r)=>n+r.debitOre-r.creditOre,0);}

test('all template data is preserved and revenue accounts reach the actual journal',()=>{
 const input=example(),s=state();s.invoiceRevenueAccounts=[{number:'3099',name:'Egen försäljning'}];input.lines[1].revenueAccount='3099';
 const record=Invoice.postDemoInvoice(s,input,{id:'test-invoice'}),d=record.document,lines=s.accountingEntries[0].lines;
 assert.equal(d.netOre,123750);assert.equal(d.vatOre,26550);assert.equal(d.totalOre,150300);assert.equal(balance(lines),0);
 assert.equal(lines.find(r=>r.account==='3051').creditOre,90000);
 assert.equal(lines.find(r=>r.account==='3099').creditOre,33750);
 assert.equal(lines.find(r=>r.account==='2611').creditOre,22500);
 assert.equal(lines.find(r=>r.account==='2621').creditOre,4050);
 assert.equal(lines.some(r=>r.account==='3010'),false);
 for(const key of ['ourReference','yourReference','orderNumber','interestText','paymentTermsText','deliveryTerms','deliveryMethod','deliveryDate','notes','internalNotes'])assert.equal(d[key],input[key],key);
 for(const key of ['name','address','orgNumber','vatNumber','phone','email','website','registeredOffice','bankgiro','plusgiro','iban','bic','swish','taxStatus'])assert.equal(d.seller[key],input.seller[key],key);
 assert.equal(d.lines[1].quantityMilli,1500);assert.equal(d.lines[1].discountBasisPoints,1000);
 assert.equal(record.remainingOre,d.totalOre);assert.equal(record.journalNumber,'F1');assert.equal(s.accountingEntries[0].sourceId,record.id);
 input.seller.name='Changed';input.lines[0].description='Changed';s.invoiceRevenueAccounts[0].name='Changed';
 assert.equal(record.document.seller.name,'Rolands Frukt o Grönt Aktiebolag');assert.equal(record.document.lines[1].revenueAccountName,'Egen försäljning');
 const read=Invoice.documentFor(record);read.seller.name='Mutated copy';assert.notEqual(record.document.seller.name,read.seller.name);
});

test('fees, mixed VAT, discounts and both rounding directions balance in integer ore',()=>{
 const i=example();i.lines=[{...i.lines[0],quantity:'1',unitPrice:'1,01',vatRate:'25'}];i.roundToKrona=true;
 let d=Invoice.prepare(i);assert.equal(d.totalOre,100);assert.equal(d.roundingOre,-26);assert.equal(Invoice.journalLines(d).find(r=>r.account==='3740').debitOre,26);
 i.lines[0].unitPrice='1,30';d=Invoice.prepare(i);assert.equal(d.totalOre,200);assert.equal(d.roundingOre,37);assert.equal(balance(Invoice.journalLines(d)),0);
 i.roundToKrona=false;i.lines.push({...i.lines[0],kind:'freight',description:'Frakt',unitPrice:'50',vatRate:'6',revenueAccount:'3053'});
 i.lines.push({...i.lines[0],kind:'administration',description:'Expeditionsavgift',unitPrice:'10',vatRate:'12',revenueAccount:'3042'});
 i.lines.push({...i.lines[0],description:'Momsfri exempelrad',unitPrice:'100',vatRate:'0'});i.taxExemptionReason='Fiktivt exempel – kontrollera rättslig grund före drift';
 d=Invoice.prepare(i);assert.equal(d.freightOre,5000);assert.equal(d.administrationOre,1000);assert.equal(d.netOre,16130);assert.equal(d.vatOre,453);assert.equal(balance(Invoice.journalLines(d)),0);
 assert.equal(Invoice.journalLines(d).find(r=>r.account==='2631').creditOre,300);
});

test('invalid price precision, dates, missing identity and non-revenue accounts are rejected',()=>{
 for(const code of ['1930','4010','2611','3740','9999']){const i=example();i.lines[0].revenueAccount=code;assert.throws(()=>Invoice.prepare(i),/konto/);}
 assert.throws(()=>Invoice.revenueAccounts([{number:'4010',name:'Kostnad'}]),/Intäktskonto|intäktskonto/);
 for(const [parent,key] of [['seller','name'],['seller','address'],['seller','orgNumber'],['seller','vatNumber'],['buyer','name'],['buyer','address']]){const i=example();i[parent][key]='';assert.throws(()=>Invoice.prepare(i),/måste anges/);}
 const payment=example();for(const key of ['bankgiro','plusgiro','iban','swish'])payment.seller[key]='';assert.throws(()=>Invoice.prepare(payment),/betalningssätt/);
 for(const price of ['1,001','NaN','-5','9007199254740992']){const i=example();i.lines[0].unitPrice=price;assert.throws(()=>Invoice.prepare(i));}
 const date=example();date.invoiceDate='2026-02-30';assert.throws(()=>Invoice.prepare(date),/giltigt datum/);
 const due=example();due.dueDate='2026-09-01';assert.throws(()=>Invoice.prepare(due),/före fakturadatum/);
 const exempt=example();exempt.lines[0].vatRate='0';assert.throws(()=>Invoice.prepare(exempt),/0 % moms/);
});

test('locked periods and duplicate ids never partially change state; sequence follows maximum',()=>{
 const s=state(),i=example();i.postingDate='2026-08-17';const before=JSON.stringify(s);
 assert.throws(()=>Invoice.postDemoInvoice(s,i),/låst/);assert.equal(JSON.stringify(s),before);
 i.postingDate='2026-09-17';s.accountingEntries=[{number:'F7',postingDate:'2026-09-01',lines:[]}];
 const record=Invoice.postDemoInvoice(s,i,{id:'same'});assert.equal(record.journalNumber,'F8');
 const after=JSON.stringify(s);assert.throws(()=>Invoice.postDemoInvoice(s,i,{id:'same'}),/redan/);assert.equal(JSON.stringify(s),after);
});

test('the full grouped navigation has unique destinations and all financial tools remain registered',()=>{
 const items=groups.flatMap(g=>g.items),ids=items.map(i=>i[0]);assert.equal(new Set(ids).size,ids.length);
 const economy=groups.find(g=>g.id==='economy').items.map(i=>i[0]);for(const id of ['invoices','receivables','payables','bank','automation','accounting','reports','accounts','payroll','res-tools','batches'])assert.ok(economy.includes(id),id);
 assert.ok(groups.some(g=>g.label==='Systemadministration'));
 for(const [, ,route] of items){const url=new URL(route,'https://example.invalid/');let file=url.pathname.replace(/^\//,'');if(file.endsWith('/'))file+='index.html';const source=file.startsWith('portal/')?'apps/'+file:file.startsWith('admin/')?'apps/'+file:file.replace(/^legacy\//,'public/');assert.ok(fs.existsSync(path.join(__dirname,'..',source)),source);}
});

test('real PDF, internal appendix and many-page invoice are valid and written as review artifacts',async()=>{
 const out=path.join(__dirname,'..','test-artifacts');fs.mkdirSync(out,{recursive:true});
 const input=example(),s=state(),record=Invoice.postDemoInvoice(s,input,{id:'pdf-example'});
 const standard=await createInvoicePdf(record.document),loaded=await PDFDocument.load(standard);
 assert.equal(loaded.getTitle(),'FAKTURA 310001');assert.equal(loaded.getAuthor(),input.seller.name);assert.ok(loaded.getPageCount()>=1);
 fs.writeFileSync(path.join(out,'invoice-example.pdf'),standard);
 const internal=await createInvoicePdf(record.document,{internal:true,record,journalLines:s.accountingEntries[0].lines});
 assert.ok((await PDFDocument.load(internal)).getPageCount()>loaded.getPageCount());fs.writeFileSync(path.join(out,'invoice-internal.pdf'),internal);
 const extended=example();extended.lines=Array.from({length:70},(_,i)=>({...extended.lines[i%2],articleNumber:'ART-'+String(i+1),description:`Rad ${i+1}: En lång beskrivning med svenska tecken åäö som ska brytas snyggt över flera rader utan att belopp eller text klipps.`}));
 const large=await createInvoicePdf(Invoice.prepare(extended,{invoiceNumber:'310777'}));assert.ok((await PDFDocument.load(large)).getPageCount()>2);fs.writeFileSync(path.join(out,'invoice-multiple-pages.pdf'),large);
 const veryLong=example();veryLong.lines[0].description=('Mycketlångtord'.repeat(80)).slice(0,1000);await createInvoicePdf(Invoice.prepare(veryLong));
 const unsupported=example();unsupported.notes='Test 😀';await assert.rejects(()=>createInvoicePdf(Invoice.prepare(unsupported)),/tecken/);
 const old=Invoice.documentFor({invoiceNumber:'310099',customerName:'Äldre kund',totalOre:10000,vatOre:2000});assert.ok(old.warnings.length);await createInvoicePdf(old);
});
