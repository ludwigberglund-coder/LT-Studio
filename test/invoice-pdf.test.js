'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib');
const {invoicePdf,invoiceDocumentData}=require('../invoice-pdf.js');

const business={
  name:'Rolands Frukt o Grönt Aktiebolag',
  orgNumber:'556406-5059',
  vatNumber:'SE556406505901',
  address:'Bolshedens Industriväg 22\n427 50 Billdal',
  registeredOffice:'Billdal',
  paymentAccount:'Bankgiro 123-4567',
  phone:'031-91 32 23',
  email:'frukt@rollands.se',
  invoiceContact:'Anna Andersson'
};
const invoice={
  number:'310123',ocr:'310123',date:'2026-09-15',dueDate:'2026-10-15',paymentTerms:30,
  customer:'Exempelbutiken AB',customerNumber:'K-1010',address:'Kundgatan 1\n411 01 Göteborg',customerOrgNumber:'559000-1234',
  reference:'Erik Ek',ourContact:'Anna Andersson',deliveryDate:'2026-09-14',net:1500,vat:245,total:1745,currency:'SEK',
  lines:[
    {description:'Fruktkorg',quantity:2,unit:'st',unitPrice:500,net:1000,vatRate:12},
    {description:'Leverans',quantity:1,unit:'st',unitPrice:500,net:500,vatRate:25}
  ],
  vatSummary:[{rate:12,net:1000,vat:120},{rate:25,net:500,vat:125}]
};

test('fakturadatan innehåller identitet, datum, köpare, säljare, betalning, rader och momssammanställning',()=>{
  const data=invoiceDocumentData(invoice,business);
  assert.equal(data.number,'310123');
  assert.equal(data.issueDate,'2026-09-15');
  assert.equal(data.deliveryDate,'2026-09-14');
  assert.equal(data.customer,'Exempelbutiken AB');
  assert.equal(data.customerAddress,'Kundgatan 1\n411 01 Göteborg');
  assert.equal(data.sellerOrgNumber,'556406-5059');
  assert.equal(data.sellerVatNumber,'SE556406505901');
  assert.equal(data.paymentAccount,'Bankgiro 123-4567');
  assert.equal(data.lines[0].quantity,2);
  assert.equal(data.lines[0].unitPrice,500);
  assert.deepEqual(data.vatSummary.map(row=>row.rate),[12,25]);
});

test('obligatoriska kärnuppgifter saknas inte tyst vid PDF-generering',()=>{
  assert.throws(()=>invoiceDocumentData({...invoice,address:''},business),/köparens adress/);
  assert.throws(()=>invoiceDocumentData(invoice,{...business,vatNumber:''}),/momsregistreringsnummer/);
  assert.throws(()=>invoiceDocumentData(invoice,{...business,paymentAccount:''}),/betalningskonto/);
});

test('detaljerad faktura genereras som giltig PDF med dokumentmetadata',async()=>{
  const bytes=await invoicePdf(invoice,business);
  assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
  const doc=await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(),'FAKTURA 310123');
  assert.equal(doc.getAuthor(),'Rolands Frukt o Grönt Aktiebolag');
  assert.ok(doc.getPageCount()>=1);
});

test('kreditfaktura visar ursprungsfaktura och negativa belopp utan teckenkodningsfel',async()=>{
  const credit={
    ...invoice,
    credit:true,
    number:'310124',
    originalInvoiceNumber:'310123',
    creditReason:'Retur',
    net:-1500,
    vat:-245,
    total:-1745,
    lines:invoice.lines.map(line=>({...line,unitPrice:-Math.abs(line.unitPrice),net:-Math.abs(line.net)})),
    vatSummary:invoice.vatSummary.map(row=>({...row,net:-Math.abs(row.net),vat:-Math.abs(row.vat)}))
  };
  const data=invoiceDocumentData(credit,business);
  assert.equal(data.documentType,'KREDITFAKTURA');
  assert.equal(data.originalInvoiceNumber,'310123');
  assert.equal(data.creditReason,'Retur');
  const bytes=await invoicePdf(credit,business);
  assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
  const doc=await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(),'KREDITFAKTURA 310124');
});
