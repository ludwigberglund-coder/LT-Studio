'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib');
const {invoicePdf,invoiceDocumentData}=require('../invoice-pdf.js');

const business={
  name:'Demo Handel AB',
  orgNumber:'000000-0000',
  vatNumber:'SE000000000001',
  address:'Exempelgatan 1\n411 00 Göteborg',
  registeredOffice:'Göteborg',
  paymentAccount:'Bankgiro 123-4567',
  phone:'031-000 00 00',
  email:'faktura@demo.example.invalid',
  invoiceContact:'Anna Andersson'
};
const strictBusiness={...business,strictInvoiceValidation:true};
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
  const data=invoiceDocumentData(invoice,strictBusiness);
  assert.equal(data.number,'310123');
  assert.equal(data.issueDate,'2026-09-15');
  assert.equal(data.deliveryDate,'2026-09-14');
  assert.equal(data.customer,'Exempelbutiken AB');
  assert.equal(data.customerAddress,'Kundgatan 1\n411 01 Göteborg');
  assert.equal(data.sellerOrgNumber,'000000-0000');
  assert.equal(data.sellerVatNumber,'SE000000000001');
  assert.equal(data.sellerRegisteredOffice,'Göteborg');
  assert.equal(data.paymentAccount,'Bankgiro 123-4567');
  assert.equal(data.lines[0].quantity,2);
  assert.equal(data.lines[0].unitPrice,500);
  assert.deepEqual(data.vatSummary.map(row=>row.rate),[12,25]);
  assert.equal(data.productionReady,true);
});

test('skarp fakturaväg stoppar obligatoriska kärnuppgifter som saknas',()=>{
  assert.throws(()=>invoiceDocumentData({...invoice,address:''},strictBusiness),/köparens adress/);
  assert.throws(()=>invoiceDocumentData(invoice,{...strictBusiness,vatNumber:''}),/momsregistreringsnummer/);
  assert.throws(()=>invoiceDocumentData(invoice,{...strictBusiness,paymentAccount:''}),/betalningskonto/);
  assert.throws(()=>invoiceDocumentData({...invoice,credit:true,originalInvoiceNumber:''},strictBusiness),/ursprungsfakturan/);
});

test('legacy-demo kan generera ett tydligt ofullständigt utkast utan att utkastet markeras produktionsklart',async()=>{
  const draft={...invoice,address:''};
  const data=invoiceDocumentData(draft,business);
  assert.equal(data.productionReady,false);
  assert.ok(data.validationWarnings.some(value=>/adress/i.test(value)));
  const bytes=await invoicePdf(draft,business);
  assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
});

test('detaljerad faktura genereras som giltig PDF med dokumentmetadata',async()=>{
  const bytes=await invoicePdf(invoice,strictBusiness);
  assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
  const doc=await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(),'FAKTURA 310123');
  assert.equal(doc.getAuthor(),'Demo Handel AB');
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
  const data=invoiceDocumentData(credit,strictBusiness);
  assert.equal(data.documentType,'KREDITFAKTURA');
  assert.equal(data.originalInvoiceNumber,'310123');
  assert.equal(data.creditReason,'Retur');
  assert.equal(data.productionReady,true);
  const bytes=await invoicePdf(credit,strictBusiness);
  assert.ok(bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
  const doc=await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(),'KREDITFAKTURA 310124');
});
