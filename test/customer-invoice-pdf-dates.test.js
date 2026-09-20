'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Pdf=require('../packages/invoicing/pdf.js');
const PDFLib=require('pdf-lib');

function fixture(){
  return {
    documentType:'FAKTURA',
    invoiceNumber:'310999',
    invoiceDate:'2026-09-20',
    postingDate:'2099-12-31',
    dueDate:'2026-10-20',
    paymentTermsDays:30,
    currency:'SEK',
    customerNumber:'K-999',
    ocr:'310999',
    seller:{name:'Säljare AB',address:'Testgatan 1',orgNumber:'559999-9999',vatNumber:'SE559999999901',taxStatus:'Godkänd för F-skatt',phone:'031-000000',website:'example.invalid',email:'test@example.invalid',bankgiro:'123-4567'},
    buyer:{name:'Kund AB',address:'Kundvägen 2',orgNumber:'559888-8888',email:'kund@example.invalid'},
    lines:[{description:'Testvara',quantityMilli:1000,unit:'st',unitPriceOre:100000,netOre:100000,vatRate:25}],
    vatBreakdown:[{rate:25,netOre:100000,vatOre:25000}],
    netOre:100000,vatOre:25000,totalOre:125000,roundingOre:0,freightOre:0,administrationOre:0,
    interestText:'',notes:''
  };
}
function capturingLib(captured){
  const originalCreate=PDFLib.PDFDocument.create.bind(PDFLib.PDFDocument);
  return {...PDFLib,PDFDocument:{...PDFLib.PDFDocument,create:async()=>{
    const doc=await originalCreate();
    const originalAdd=doc.addPage.bind(doc);
    doc.addPage=(...args)=>{
      const page=originalAdd(...args);
      const originalDraw=page.drawText.bind(page);
      page.drawText=(value,options)=>{captured.push(String(value));return originalDraw(value,options)};
      return page;
    };
    return doc;
  }}};
}

test('kundens faktura visar fakturadatum och förfallodatum men inte bokföringsdatum',async()=>{
  const captured=[];
  await Pdf.createInvoicePdf(fixture(),{PDFLib:capturingLib(captured)});
  assert.ok(captured.includes('Fakturadatum'));
  assert.ok(captured.includes('2026-09-20'));
  assert.ok(captured.includes('Förfallodatum'));
  assert.ok(captured.includes('2026-10-20'));
  assert.equal(captured.includes('2099-12-31'),false);
  assert.equal(captured.some(value=>value.includes('Bokföringsdatum')),false);
});

test('bokföringsdatum får endast visas när internt fakturaunderlag uttryckligen skapas',async()=>{
  const captured=[];
  await Pdf.createInvoicePdf(fixture(),{PDFLib:capturingLib(captured),internal:true,record:{status:'Bokförd',journalNumber:'F1'}});
  assert.ok(captured.some(value=>value.includes('Bokföringsdatum: 2099-12-31')));
  assert.ok(captured.includes('2026-09-20'));
  assert.ok(captured.includes('2026-10-20'));
});
