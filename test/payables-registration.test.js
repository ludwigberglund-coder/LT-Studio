'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Payables=require('../apps/api/payables.js');
const Registration=require('../apps/api/payables-registration.js');

function seed(){
  const db=Db.openDatabase(':memory:');
  Payables.initializePayables(db);
  const company=Db.createCompany(db,{legalName:'Testbolag AB',displayName:'Testbolag',orgNumber:'559900-0001'});
  const user=Db.createUser(db,{username:'registrar',displayName:'Registrerare',passwordHash:Auth.hashPassword('Sakert testlosenord 2026!')});
  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-100',name:'Grön Grossist AB',bankgiro:'555-1234',defaultCostAccount:'4010'});
  return{db,company,user,supplier};
}
function pdfBase64(){return Buffer.from('%PDF-1.4\n% test supplier invoice\n','ascii').toString('base64')}

test('registrering sparar faktura och PDF tillsammans',()=>{
  const {db,company,user,supplier}=seed();
  try{
    const invoice=Db.transaction(db,()=>Registration.registerInvoice(db,{companyId:company.id,registeredBy:user.id,supplierId:supplier.id,supplierInvoiceNumber:'GG-5001',invoiceDate:'2026-09-16',dueDate:'2026-10-16',totalOre:125000,vatOre:25000,documentName:'GG-5001.pdf',documentBase64:pdfBase64()}));
    assert.equal(invoice.status,'registered');
    assert.equal(invoice.supplierInvoiceNumber,'GG-5001');
    assert.equal(invoice.hasDocument,true);
    assert.match(invoice.documentSha256,/^[a-f0-9]{64}$/);
    const doc=Payables.document(db,company.id,invoice.id);
    assert.equal(Buffer.from(doc.bytes).subarray(0,5).toString('ascii'),'%PDF-');
  }finally{db.close()}
});

test('ogiltigt PDF-underlag eller datum stoppar registrering',()=>{
  const {db,company,user,supplier}=seed();
  try{
    assert.throws(()=>Registration.registerInvoice(db,{companyId:company.id,registeredBy:user.id,supplierId:supplier.id,supplierInvoiceNumber:'BAD-1',invoiceDate:'2026-09-16',dueDate:'2026-09-15',totalOre:10000,vatOre:2000,documentBase64:pdfBase64()}),e=>e.code==='INVALID_DATES');
    assert.throws(()=>Registration.registerInvoice(db,{companyId:company.id,registeredBy:user.id,supplierId:supplier.id,supplierInvoiceNumber:'BAD-2',invoiceDate:'2026-09-16',dueDate:'2026-10-16',totalOre:10000,vatOre:2000,documentBase64:Buffer.from('inte pdf').toString('base64')}),e=>e.code==='INVALID_PDF');
  }finally{db.close()}
});

test('leverantör från annat företag kan inte användas',()=>{
  const {db,company,user}=seed();
  try{
    const other=Db.createCompany(db,{legalName:'Annat AB',displayName:'Annat',orgNumber:'559900-0002'});
    const foreign=Payables.createSupplier(db,{companyId:other.id,supplierNumber:'L-9',name:'Annan leverantör'});
    assert.throws(()=>Registration.registerInvoice(db,{companyId:company.id,registeredBy:user.id,supplierId:foreign.id,supplierInvoiceNumber:'X-1',invoiceDate:'2026-09-16',dueDate:'2026-10-16',totalOre:10000,vatOre:2000,documentBase64:pdfBase64()}),e=>e.code==='SUPPLIER_NOT_FOUND');
  }finally{db.close()}
});

test('databastransaktion rullar tillbaka fakturan om dokumentlagringen misslyckas',()=>{
  const {db,company,user,supplier}=seed();
  try{
    assert.throws(()=>Db.transaction(db,()=>Registration.registerInvoice(db,{companyId:company.id,registeredBy:user.id,supplierId:supplier.id,supplierInvoiceNumber:'ROLLBACK-1',invoiceDate:'2026-09-16',dueDate:'2026-10-16',totalOre:10000,vatOre:2000,documentBase64:Buffer.from('fel').toString('base64')})));
    assert.equal(Payables.listInvoices(db,company.id).length,0);
  }finally{db.close()}
});
