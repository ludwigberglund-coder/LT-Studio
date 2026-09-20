'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Invoicing=require('../apps/api/customer-invoicing.js');
const ArchiveStore=require('../apps/api/customer-invoice-pdf-archive-store.js');
const PrivateObject=require('../apps/api/private-object-contract.js');
const StoreContract=require('../apps/api/private-object-store-contract.js');
const Bridge=require('../apps/api/sqlite-customer-invoice-private-object-provider.js');

function pdf(label='customer-provider'){return Buffer.from('%PDF-1.4\n% '+label+'\n','ascii')}

function seedInvoice(db,{companyId,customerId,invoiceNumber,documentType='FAKTURA'}){
  const invoice=Db.createInvoice(db,{
    companyId,
    customerId,
    invoiceNumber,
    ocr:invoiceNumber,
    invoiceDate:'2026-09-20',
    postingDate:'2026-09-20',
    dueDate:'2026-10-20',
    totalOre:125000,
    remainingOre:125000,
    vatOre:25000,
    status:documentType==='KREDITFAKTURA'?'Kreditfaktura':'Bokförd'
  });
  const documentJson=JSON.stringify({documentType,invoiceNumber});
  const sha=crypto.createHash('sha256').update(documentJson).digest('hex');
  db.prepare(`INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at)
    VALUES(?,?,?,?,?)`).run(invoice.id,companyId,documentJson,sha,'2026-09-20T21:58:00.000Z');
  return invoice;
}

test('kundfakturans SQLite-brygga följer gemensamt provider-kontrakt',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Invoicing.initializeCustomerInvoicing(db);
    const company=Db.createCompany(db,{legalName:'Customer Provider A AB',displayName:'Customer A',orgNumber:'559904-1001'});
    const other=Db.createCompany(db,{legalName:'Customer Provider B AB',displayName:'Customer B',orgNumber:'559904-1002'});
    const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-100',name:'Kund A AB',customerType:'business'});
    const invoice=seedInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310101'});
    const bytes=pdf();
    const metadata=PrivateObject.createPrivateObjectMetadata({
      companyId:company.id,
      kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF,
      objectId:invoice.id,
      mimeType:'application/pdf',
      sizeBytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      createdAt:'2026-09-20T21:58:00.000Z'
    });
    const store=StoreContract.createContractedPrivateObjectStore(
      Bridge.createSqliteCustomerInvoicePrivateObjectProvider(db)
    );

    assert.equal(store.put({metadata,bytes}),true);
    assert.equal(store.exists(metadata),true);
    assert.deepEqual(store.get(metadata),bytes);

    const archived=ArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(db).get({companyId:company.id,invoiceId:invoice.id});
    assert.equal(archived.fileName,'Faktura-310101.pdf');
    assert.equal(archived.pdfSha256,metadata.sha256);

    const wrongCompany={companyId:other.id,kind:metadata.kind,objectId:metadata.objectId};
    assert.equal(store.exists(wrongCompany),false);
    assert.equal(store.get(wrongCompany),null);

    const wrongKind={companyId:company.id,kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,objectId:metadata.objectId};
    assert.equal(store.exists(wrongKind),false);
    assert.equal(store.get(wrongKind),null);
    assert.equal(store.put({metadata:{...metadata,kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT},bytes}),false);
  }finally{db.close();}
});

test('kundfaktura-bryggan bevarar kreditfakturans filnamnsregel',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Invoicing.initializeCustomerInvoicing(db);
    const company=Db.createCompany(db,{legalName:'Credit Provider AB',displayName:'Credit Provider',orgNumber:'559904-2001'});
    const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-200',name:'Kund Kredit AB',customerType:'business'});
    const invoice=seedInvoice(db,{companyId:company.id,customerId:customer.id,invoiceNumber:'310102',documentType:'KREDITFAKTURA'});
    const bytes=pdf('credit');
    const metadata=PrivateObject.createPrivateObjectMetadata({
      companyId:company.id,
      kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF,
      objectId:invoice.id,
      mimeType:'application/pdf',
      sizeBytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      createdAt:'2026-09-20T21:59:00.000Z'
    });
    const store=StoreContract.createContractedPrivateObjectStore(
      Bridge.createSqliteCustomerInvoicePrivateObjectProvider(db)
    );
    assert.equal(store.put({metadata,bytes}),true);
    const archived=ArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(db).get({companyId:company.id,invoiceId:invoice.id});
    assert.equal(archived.fileName,'Kreditfaktura-310102.pdf');
  }finally{db.close();}
});
