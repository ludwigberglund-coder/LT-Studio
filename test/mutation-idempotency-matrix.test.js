'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Bank=require('../apps/api/bank-payments.js');
const Payables=require('../apps/api/payables.js');
const Documents=require('../apps/api/documents.js');
const Accounting=require('../apps/api/accounting-store.js');
const Admin=require('../apps/api/accounting-admin.js');

function fixture(){
  const db=Db.openDatabase(':memory:');
  Bank.initializeBankPayments(db);Payables.initializePayables(db);Documents.initializeDocuments(db);Admin.initializeAccountingAdmin(db);
  const company=Db.createCompany(db,{legalName:'Idempotens Test AB',displayName:'Idempotens Test',orgNumber:'559960-1001'});
  const user=Db.createUser(db,{username:'idem.user',displayName:'Idempotens User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  return{db,company,user};
}

test('bankimport med samma externa id skapar inte en andra bankhändelse',()=>{
  const {db,company,user}=fixture();
  try{
    const first=Bank.create(db,{companyId:company.id,externalId:'BANK-EXT-1',bookingDate:'2026-09-20',amountOre:12500,reference:'REF-1',createdBy:user.id});
    const second=Bank.create(db,{companyId:company.id,externalId:'BANK-EXT-1',bookingDate:'2026-09-20',amountOre:12500,reference:'REF-1',createdBy:user.id});
    assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);assert.equal(second.payment.id,first.payment.id);
    assert.equal(Bank.list(db,company.id).length,1);
  }finally{db.close()}
});

test('leverantörsfaktura med samma leverantör och normaliserade fakturanummer stoppas utan dubblett',()=>{
  const {db,company,user}=fixture();
  try{
    const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-1',name:'Leverantör AB'});
    const first=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'INV-100 / 2026',invoiceDate:'2026-09-20',dueDate:'2026-10-20',totalOre:12500,vatOre:2500,registeredBy:user.id});
    assert.throws(()=>Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'inv1002026',invoiceDate:'2026-09-20',dueDate:'2026-10-20',totalOre:12500,vatOre:2500,registeredBy:user.id}),e=>e.code==='DUPLICATE_SUPPLIER_INVOICE'&&e.statusCode===409);
    assert.equal(Payables.listInvoices(db,company.id).length,1);
    assert.equal(Payables.listInvoices(db,company.id)[0].id,first.id);
  }finally{db.close()}
});

test('samma dokumentbytes kan inte arkiveras två gånger i samma företag',()=>{
  const {db,company,user}=fixture();
  try{
    const bytes=Buffer.from('%PDF-1.4\nSamma original\n');
    const first=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Original A',fileName:'a.pdf',mimeType:'application/pdf'});
    Documents.storeContent(db,{companyId:company.id,documentId:first.id,bytes});
    const second=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Original B',fileName:'b.pdf',mimeType:'application/pdf'});
    assert.throws(()=>Documents.storeContent(db,{companyId:company.id,documentId:second.id,bytes}),e=>e.code==='DUPLICATE_DOCUMENT'&&e.statusCode===409);
    assert.equal(Documents.listDocuments(db,company.id).filter(row=>row.status==='ready').length,1);
  }finally{db.close()}
});

test('dubbel rättelse av samma bokföringspost skapar inte extra motverifikation',()=>{
  const {db,company,user}=fixture();
  try{
    const original=Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-20',description:'Manuell post',sourceType:'manual',sourceId:'idem-original',createdBy:user.id,series:'A',lines:[
      {account:'1930',text:'Bank',debitOre:10000,creditOre:0},
      {account:'2999',text:'Motkonto',debitOre:0,creditOre:10000}
    ]}).entry;
    const first=Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-20',reason:'Rättelse test',replacementLines:null,createdBy:user.id});
    assert.ok(first.reversal?.id);
    const before=Accounting.listEntries(db,company.id,{limit:100}).length;
    assert.throws(()=>Admin.correctEntry(db,{companyId:company.id,entryId:original.id,postingDate:'2026-09-20',reason:'Rättelse test',replacementLines:null,createdBy:user.id}),e=>e.code==='ENTRY_ALREADY_CORRECTED'&&e.statusCode===409);
    assert.equal(Accounting.listEntries(db,company.id,{limit:100}).length,before);
    assert.equal(Admin.listCorrections(db,company.id).length,1);
  }finally{db.close()}
});
