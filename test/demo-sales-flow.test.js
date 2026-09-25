'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Invoice=require('../packages/invoicing/invoice.js');
const {createInvoicePdf}=require('../packages/invoicing/pdf.js');
const {PDFDocument}=require('pdf-lib');
const {example,state}=require('./fixtures/invoice-example.js');
const {groups}=require('../apps/portal/portal-nav.js');
function balance(lines){return lines.reduce((n,r)=>n+r.debitOre-r.creditOre,0);}
function appendFees(i){const out=JSON.parse(JSON.stringify(i));if(out.useFees){if(out.administration?.amount!=='0,00')out.lines.push({kind:'administration',description:'Fakturaavgift',quantity:'1',unit:'st',unitPrice:out.administration.amount,vatRate:'25',revenueAccount:'3690'});if(out.freight?.amount!=='0,00')out.lines.push({kind:'freight',description:'Frakt',quantity:'1',unit:'st',unitPrice:out.freight.amount,vatRate:'25',revenueAccount:'3520'});}return out;}

test('approved invoice fields are preserved, OCR is locked and revenue accounts reach the actual journal',()=>{
 const input=appendFees(example()),s=state();s.invoiceRevenueAccounts=[{number:'3099',name:'Egen försäljning 12 %',vatRates:[12]}];input.lines[1].revenueAccount='3099';input.ocr='MANUELLT-FEL';
 const record=Invoice.postDemoInvoice(s,input,{id:'test-invoice'}),d=record.document,lines=s.accountingEntries[0].lines;
 assert.equal(record.invoiceNumber,'310001');assert.equal(record.ocr,'310001');assert.equal(d.ocr,d.invoiceNumber);
 assert.equal(d.netOre,133500);assert.equal(d.vatOre,28500);assert.equal(d.totalOre,162000);assert.equal(d.roundingOre,0);assert.equal(balance(lines),0);
 assert.equal(lines.find(r=>r.account==='3051').creditOre,90000);assert.equal(lines.find(r=>r.account==='3099').creditOre,37500);assert.equal(lines.find(r=>r.account==='3690').creditOre,1000);assert.equal(lines.find(r=>r.account==='3520').creditOre,5000);
 assert.equal(lines.find(r=>r.account==='2611').creditOre,24000);assert.equal(lines.find(r=>r.account==='2621').creditOre,4500);
 assert.equal(d.ourReference,input.ourReference);assert.equal(d.yourReference,input.yourReference);assert.equal(d.notes,input.notes);assert.equal(d.interestText,Invoice.INTEREST_TEXT);
 for(const removed of ['orderNumber','deliveryDate','deliveryTerms','deliveryMethod','deliveryAddress','paymentTermsText','taxExemptionReason','internalNotes'])assert.equal(Object.hasOwn(d,removed),false,removed);
 assert.equal(d.seller.plusgiro,undefined);assert.equal(d.seller.iban,undefined);assert.equal(d.seller.bic,undefined);assert.equal(d.seller.swish,undefined);assert.equal(d.seller.registeredOffice,undefined);
 assert.equal(record.remainingOre,d.totalOre);assert.equal(record.journalNumber,'F1');assert.equal(s.accountingEntries[0].sourceId,record.id);
});

test('VAT rate and revenue account must agree in both default and custom account metadata',()=>{
 const i=example();i.lines=[i.lines[0]];
 i.lines[0].vatRate='12';assert.throws(()=>Invoice.prepare(i),/3051.*12 % moms/);
 i.lines[0].revenueAccount='3042';assert.doesNotThrow(()=>Invoice.prepare(i));
 const custom={number:'3099',name:'Eget 6 %-konto',vatRates:[6]};i.lines[0].revenueAccount='3099';i.lines[0].vatRate='25';assert.throws(()=>Invoice.prepare(i,{accounts:[custom]}),/3099.*25 % moms/);
 i.lines[0].vatRate='6';assert.doesNotThrow(()=>Invoice.prepare(i,{accounts:[custom]}));
 const six=Invoice.accountsForVat(Invoice.revenueAccounts([custom]),6).map(a=>a.number);assert.ok(six.includes('3043'));assert.ok(six.includes('3053'));assert.ok(six.includes('3099'));assert.ok(!six.includes('3051'));
 assert.equal(Invoice.revenueAccounts([{number:'3098',name:'Äldre konto utan moms'}]).some(a=>a.number==='3098'),false);
});

test('automatic rounding always posts separately on 3740 and 0 % VAT needs no extra form field',()=>{
 const i=example();i.lines=[{description:'Test',quantity:'1',unit:'',unitPrice:'1,01',vatRate:'25',revenueAccount:'3051'}];
 let d=Invoice.prepare(i);assert.equal(d.totalOre,100);assert.equal(d.roundingOre,-26);assert.equal(Invoice.journalLines(d).find(r=>r.account==='3740').debitOre,26);
 i.lines[0].unitPrice='1,30';d=Invoice.prepare(i);assert.equal(d.totalOre,200);assert.equal(d.roundingOre,37);assert.equal(balance(Invoice.journalLines(d)),0);
 i.lines[0]={description:'Momsfri rad',quantity:'1',unit:'',unitPrice:'100,00',vatRate:'0',revenueAccount:'3054'};assert.doesNotThrow(()=>Invoice.prepare(i));
});

test('invalid dates, missing identity, missing bankgiro and non-revenue accounts are rejected atomically',()=>{
 for(const code of ['1930','4010','2611','3740','9999']){const i=example();i.lines[0].revenueAccount=code;assert.throws(()=>Invoice.prepare(i),/konto/);}
 assert.throws(()=>Invoice.revenueAccounts([{number:'4010',name:'Kostnad',vatRates:[25]}]),/intäktskonto/i);
 for(const [parent,key] of [['seller','name'],['seller','address'],['seller','orgNumber'],['seller','vatNumber'],['buyer','name'],['buyer','address']]){const i=example();i[parent][key]='';assert.throws(()=>Invoice.prepare(i),/måste anges/);}
 const payment=example();payment.seller.bankgiro='';assert.throws(()=>Invoice.prepare(payment),/Bankgiro/);
 const date=example();date.invoiceDate='2026-02-30';assert.throws(()=>Invoice.prepare(date),/giltigt datum/);
 const due=example();due.dueDate='2026-09-01';assert.throws(()=>Invoice.prepare(due),/före fakturadatum/);
 const s=state(),locked=example();locked.postingDate='2026-08-17';const before=JSON.stringify(s);assert.throws(()=>Invoice.postDemoInvoice(s,locked),/låst/);assert.equal(JSON.stringify(s),before);
});

test('posting creates one invoice and one balanced accounting entry without breaking receivable fields',()=>{
 const s=state(),record=Invoice.postDemoInvoice(s,example(),{id:'chain'}),entry=s.accountingEntries.at(-1);
 assert.equal(s.customerInvoices.length,1);assert.equal(s.accountingEntries.length,1);assert.equal(entry.sourceType,'customer-invoice');assert.equal(entry.sourceId,record.id);assert.equal(balance(entry.lines),0);assert.equal(record.invoiceAccount,'1510');assert.equal(record.remainingOre,record.totalOre);assert.equal(record.status,'Bokförd');assert.equal(record.ocr,record.invoiceNumber);
});

test('the full grouped navigation has unique destinations and financial tools remain registered',()=>{
 const items=groups.flatMap(g=>g.items),ids=items.map(i=>i[0]);assert.equal(new Set(ids).size,ids.length);
 const economy=groups.find(g=>g.id==='economy').items.map(i=>i[0]);for(const id of ['invoices','receivables','payables','bank','automation','accounting','reports','accounts','payroll'])assert.ok(economy.includes(id),id);
 assert.ok(groups.some(g=>g.label==='Systemadministration'));
 for(const [, ,route] of items){const url=new URL(route,'https://example.invalid/');let file=url.pathname.replace(/^\//,'');if(file.endsWith('/'))file+='index.html';const source=file.startsWith('portal/')?'apps/'+file:file.startsWith('admin/')?'apps/'+file:file.replace(/^legacy\//,'public/');assert.ok(fs.existsSync(path.join(__dirname,'..',source)),source);}
});

test('customer PDF omits internal posting fields and supports multiple pages; internal appendix remains separate',async()=>{
 const out=path.join(__dirname,'..','test-artifacts');fs.mkdirSync(out,{recursive:true});
 const input=example(),s=state(),record=Invoice.postDemoInvoice(s,input,{id:'pdf-example'});
 const standard=await createInvoicePdf(record.document),loaded=await PDFDocument.load(standard);assert.equal(loaded.getTitle(),'FAKTURA 310001');assert.equal(loaded.getAuthor(),input.seller.name);assert.ok(loaded.getPageCount()>=1);fs.writeFileSync(path.join(out,'invoice-example.pdf'),standard);
 const internal=await createInvoicePdf(record.document,{internal:true,record,journalLines:s.accountingEntries[0].lines});assert.ok((await PDFDocument.load(internal)).getPageCount()>loaded.getPageCount());fs.writeFileSync(path.join(out,'invoice-internal.pdf'),internal);
 const extended=example();extended.lines=Array.from({length:70},(_,i)=>({...extended.lines[i%2],description:`Rad ${i+1}: En lång beskrivning med svenska tecken åäö som ska brytas snyggt över flera rader utan att belopp eller text klipps.`}));const large=await createInvoicePdf(Invoice.prepare(extended,{invoiceNumber:'310777'}));assert.ok((await PDFDocument.load(large)).getPageCount()>2);fs.writeFileSync(path.join(out,'invoice-multiple-pages.pdf'),large);
 const unsupported=example();unsupported.notes='Test 😀';await assert.rejects(()=>createInvoicePdf(Invoice.prepare(unsupported)),/tecken/);
});
