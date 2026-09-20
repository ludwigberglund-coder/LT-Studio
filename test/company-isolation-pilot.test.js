'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Payables=require('../apps/api/payables.js');
const Accounting=require('../apps/api/accounting-store.js');
const Documents=require('../apps/api/documents.js');

test('pilotkritisk företagsisolering hindrar korsläsning av privat ekonomidata',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    Payables.initializePayables(db);
    Accounting.initializeAccountingStore(db);
    Documents.initializeDocuments(db);

    const companyA=Db.createCompany(db,{legalName:'Company A AB',displayName:'Company A',orgNumber:'559999-2001'});
    const companyB=Db.createCompany(db,{legalName:'Company B AB',displayName:'Company B',orgNumber:'559999-2002'});
    const userA=Db.createUser(db,{username:'company-a-user',displayName:'Company A User',passwordHash:'test-only-hash-a'});
    const userB=Db.createUser(db,{username:'company-b-user',displayName:'Company B User',passwordHash:'test-only-hash-b'});
    Db.addMembership(db,{companyId:companyA.id,userId:userA.id});
    Db.addMembership(db,{companyId:companyB.id,userId:userB.id});

    const customerB=Db.createCustomer(db,{companyId:companyB.id,customerNumber:'KB-1',name:'Company B Kund AB'});
    const invoiceB=Db.createInvoice(db,{companyId:companyB.id,customerId:customerB.id,invoiceNumber:'B-1001',invoiceDate:'2026-09-17',postingDate:'2026-09-17',dueDate:'2026-10-17',totalOre:50000,remainingOre:50000,vatOre:10000,status:'Bokförd'});
    const supplierB=Payables.createSupplier(db,{companyId:companyB.id,supplierNumber:'LB-1',name:'Company B Leverantör AB',orgNumber:'559999-2999',defaultCostAccount:'4010'});
    const supplierInvoiceB=Payables.createSupplierInvoice(db,{companyId:companyB.id,supplierId:supplierB.id,supplierInvoiceNumber:'LB-INV-1',invoiceDate:'2026-09-17',dueDate:'2026-10-17',totalOre:125000,vatOre:25000,registeredBy:userB.id});
    const entryB=Accounting.postEntry(db,{companyId:companyB.id,postingDate:'2026-09-17',description:'Company B verifikation',sourceType:'isolation-test',sourceId:'b-entry',createdBy:userB.id,lines:[{account:'1930',debitOre:10000,creditOre:0,text:'Bank'},{account:'2999',debitOre:0,creditOre:10000,text:'Motkonto'}]}).entry;
    const pendingB=Documents.createPending(db,{companyId:companyB.id,uploadedBy:userB.id,fileName:'company-b.pdf',mimeType:'application/pdf',category:'invoice',title:'Company B dokument'});
    const documentB=Documents.storeContent(db,{companyId:companyB.id,documentId:pendingB.id,bytes:Buffer.from('%PDF-1.4\nCompany B private document\n')});
    assert.ok(documentB.sha256);

    assert.equal(Db.customerById(db,companyA.id,customerB.id),null);
    assert.equal(Db.invoiceById(db,companyA.id,invoiceB.id),null);
    assert.equal(Payables.supplierById(db,companyA.id,supplierB.id),null);
    assert.equal(Payables.invoiceById(db,companyA.id,supplierInvoiceB.id),null);
    assert.equal(Accounting.entryBySource(db,companyA.id,'isolation-test','b-entry'),null);
    assert.equal(Documents.documentById(db,companyA.id,pendingB.id),null);
    assert.throws(()=>Documents.content(db,companyA.id,pendingB.id),error=>error?.code==='DOCUMENT_CONTENT_NOT_FOUND');

    assert.equal(Db.listReceivables(db,companyA.id).length,0);
    assert.equal(Payables.listSuppliers(db,companyA.id).length,0);
    assert.equal(Payables.listInvoices(db,companyA.id).length,0);
    assert.equal(Accounting.listEntries(db,companyA.id).length,0);
    assert.equal(Documents.listDocuments(db,companyA.id).length,0);

    assert.equal(Db.listReceivables(db,companyB.id).length,1);
    assert.equal(Payables.listSuppliers(db,companyB.id).length,1);
    assert.equal(Payables.listInvoices(db,companyB.id).length,1);
    assert.equal(Accounting.listEntries(db,companyB.id)[0].id,entryB.id);
    assert.equal(Documents.listDocuments(db,companyB.id).length,1);
  }finally{db.close()}
});
