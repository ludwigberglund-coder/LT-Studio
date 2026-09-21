'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Documents=require('../apps/api/documents.js');
const Payables=require('../apps/api/payables.js');
const ContentStore=require('../apps/api/document-content-store.js');

function seed(){const db=Db.openDatabase(':memory:');Documents.initializeDocuments(db);const company=Db.createCompany(db,{legalName:'Dokumentbolaget AB',displayName:'Dokumentbolaget',orgNumber:'559900-8080'});const user=Db.createUser(db,{username:'docs',displayName:'Dokumenttest',passwordHash:Auth.hashPassword('Sakert dokumenttest 2026!')});return{db,company,user}}
function pdf(text='test'){return Buffer.from(`%PDF-1.4\n% ${text}\n`,'ascii')}

test('originaldokument sparas med SHA-256 och affärslänk',()=>{const {db,company,user}=seed();try{Payables.initializePayables(db);const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'L-DOC-1',name:'Dokumentleverantör AB'});const invoice=Payables.createSupplierInvoice(db,{companyId:company.id,supplierId:supplier.id,supplierInvoiceNumber:'DOC-123',invoiceDate:'2026-09-01',dueDate:'2026-09-30',totalOre:125000,vatOre:25000,registeredBy:user.id});const pending=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Leverantörsfaktura 123',category:'supplier-invoice',fileName:'faktura-123.pdf',mimeType:'application/pdf',entityType:'supplier-invoice',entityId:invoice.id,linkLabel:'Original'});assert.equal(pending.status,'pending');const bytes=pdf('invoice');const ready=Documents.storeContent(db,{companyId:company.id,documentId:pending.id,bytes});assert.equal(ready.status,'ready');assert.equal(ready.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(ready.links[0].entityId,invoice.id);assert.deepEqual(Buffer.from(Documents.content(db,company.id,pending.id).bytes),bytes);}finally{db.close()}});

test('identiskt filretry återanvänder färdigt original men andra bytes kan inte ersätta det',()=>{const {db,company,user}=seed();try{const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Kvitto september',category:'receipt',fileName:'kvitto.pdf',mimeType:'application/pdf'});const bytes=pdf('one'),ready=Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes});const retry=Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes});assert.equal(retry.id,ready.id);assert.equal(retry.sha256,ready.sha256);assert.throws(()=>Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes:pdf('two')}),e=>e.code==='DOCUMENT_IMMUTABLE');}finally{db.close()}});

test('dokumentregistrering återanvänder requestId och blockerar ändrad metadata',()=>{const {db,company,user}=seed();try{
  const input={companyId:company.id,uploadedBy:user.id,requestId:'document-create-request-0001',title:'Retry-underlag',category:'other',fileName:'retry.pdf',mimeType:'application/pdf'};
  const first=Documents.createPendingIdempotent(db,input);
  assert.equal(first.duplicate,false);
  assert.equal(first.document.status,'pending');
  const retry=Documents.createPendingIdempotent(db,input);
  assert.equal(retry.duplicate,true);
  assert.equal(retry.document.id,first.document.id);
  assert.equal(Documents.documentIdForRequest(company.id,input.requestId),first.document.id);
  assert.throws(()=>Documents.createPendingIdempotent(db,{...input,title:'Ändrad titel'}),e=>e.code==='DOCUMENT_IDEMPOTENCY_CONFLICT'&&e.statusCode===409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE company_id=?').get(company.id).n,1);
}finally{db.close()}});

test('samma originalfil kan inte registreras två gånger i samma företag',()=>{const {db,company,user}=seed();try{const bytes=pdf('same');const one=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Underlag ett',category:'other',fileName:'one.pdf',mimeType:'application/pdf'});Documents.storeContent(db,{companyId:company.id,documentId:one.id,bytes});const two=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Underlag två',category:'other',fileName:'two.pdf',mimeType:'application/pdf'});assert.throws(()=>Documents.storeContent(db,{companyId:company.id,documentId:two.id,bytes}),e=>e.code==='DUPLICATE_DOCUMENT');}finally{db.close()}});

test('filinnehåll måste stämma med angiven MIME-typ',()=>{const {db,company,user}=seed();try{const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Bild',category:'receipt',fileName:'bild.png',mimeType:'image/png'});assert.throws(()=>Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes:pdf('not png')}),e=>e.code==='DOCUMENT_MAGIC_MISMATCH');}finally{db.close()}});

test('dokument är strikt isolerade mellan företag',()=>{const {db,company,user}=seed();try{const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Hemligt underlag',category:'other',fileName:'secret.pdf',mimeType:'application/pdf'});Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes:pdf('secret')});const other=Db.createCompany(db,{legalName:'Annat Dokumentbolag AB',displayName:'Annat',orgNumber:'559900-9090'});assert.equal(Documents.documentById(db,other.id,doc.id),null);assert.equal(Documents.listDocuments(db,other.id).length,0);assert.throws(()=>Documents.content(db,other.id,doc.id),e=>e.code==='DOCUMENT_CONTENT_NOT_FOUND');}finally{db.close()}});

test('kända dokumentlänkar kan inte peka på objekt i ett annat företag',()=>{const {db,company,user}=seed();try{
  Payables.initializePayables(db);
  const other=Db.createCompany(db,{legalName:'Främmande Länkbolag AB',displayName:'Främmande Länkbolag',orgNumber:'559900-9191'});
  const otherUser=Db.createUser(db,{username:'docs-foreign-target',displayName:'Främmande mål',passwordHash:Auth.hashPassword('Sakert dokumenttest 2026!')});
  const otherCustomer=Db.createCustomer(db,{companyId:other.id,customerNumber:'B-DOC',name:'Främmande kund'});
  const otherInvoice=Db.createInvoice(db,{companyId:other.id,customerId:otherCustomer.id,invoiceNumber:'B-DOC-1',invoiceDate:'2026-09-01',dueDate:'2026-09-30',totalOre:125000,vatOre:25000});
  const otherSupplier=Payables.createSupplier(db,{companyId:other.id,supplierNumber:'B-SUP',name:'Främmande leverantör'});
  const otherSupplierInvoice=Payables.createSupplierInvoice(db,{companyId:other.id,supplierId:otherSupplier.id,supplierInvoiceNumber:'B-SUP-1',invoiceDate:'2026-09-01',dueDate:'2026-09-30',totalOre:125000,vatOre:25000,registeredBy:otherUser.id});
  const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Eget dokument',category:'other',fileName:'own.pdf',mimeType:'application/pdf'});
  assert.throws(()=>Documents.linkDocument(db,{companyId:company.id,documentId:doc.id,entityType:'customer-invoice',entityId:otherInvoice.id}),e=>e.code==='DOCUMENT_LINK_TARGET_NOT_FOUND'&&e.statusCode===404);
  assert.throws(()=>Documents.linkDocument(db,{companyId:company.id,documentId:doc.id,entityType:'supplier-invoice',entityId:otherSupplierInvoice.id}),e=>e.code==='DOCUMENT_LINK_TARGET_NOT_FOUND'&&e.statusCode===404);
  assert.deepEqual(Documents.linksForDocument(db,company.id,doc.id),[]);
}finally{db.close()}});

test('skadat arkivinnehåll eller felaktig storlek stoppas vid läsning',()=>{const {db,company,user}=seed();try{const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Arkivkontroll',category:'other',fileName:'arkiv.pdf',mimeType:'application/pdf'});const bytes=pdf('archive');Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes});assert.deepEqual(Buffer.from(Documents.content(db,company.id,doc.id).bytes),bytes);db.prepare('UPDATE documents SET content_blob=? WHERE company_id=? AND id=?').run(pdf('tampered'),company.id,doc.id);assert.throws(()=>Documents.content(db,company.id,doc.id),e=>e.code==='DOCUMENT_INTEGRITY_ERROR'&&e.statusCode===409);db.prepare('UPDATE documents SET content_blob=?,size_bytes=? WHERE company_id=? AND id=?').run(bytes,bytes.length+1,company.id,doc.id);assert.throws(()=>Documents.content(db,company.id,doc.id),e=>e.code==='DOCUMENT_INTEGRITY_ERROR');}finally{db.close()}});

test('samma filhash får finnas i två olika företag',()=>{const {db,company,user}=seed();try{const other=Db.createCompany(db,{legalName:'Annat AB',displayName:'Annat',orgNumber:'559901-0001'});const user2=Db.createUser(db,{username:'docs2',displayName:'Dokumenttest 2',passwordHash:Auth.hashPassword('Sakert dokumenttest 2026!')});const bytes=pdf('shared-template');const a=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Underlag A',category:'other',fileName:'a.pdf',mimeType:'application/pdf'});const b=Documents.createPending(db,{companyId:other.id,uploadedBy:user2.id,title:'Underlag B',category:'other',fileName:'b.pdf',mimeType:'application/pdf'});Documents.storeContent(db,{companyId:company.id,documentId:a.id,bytes});Documents.storeContent(db,{companyId:other.id,documentId:b.id,bytes});assert.equal(Documents.listDocuments(db,company.id).length,1);assert.equal(Documents.listDocuments(db,other.id).length,1);}finally{db.close()}});


test('intern dokumentlagring är företagsskopad och låses när originalet är färdigt',()=>{const {db,company,user}=seed();try{
  const other=Db.createCompany(db,{legalName:'Lagring B AB',displayName:'Lagring B',orgNumber:'559901-1002'});
  const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Lagringsgräns',category:'other',fileName:'storage.pdf',mimeType:'application/pdf'});
  const store=ContentStore.createSqliteDocumentContentStore(db),bytes=pdf('storage-seam');
  assert.equal(store.put({companyId:other.id,documentId:doc.id,bytes}),false);
  assert.equal(store.exists({companyId:other.id,documentId:doc.id}),false);
  assert.equal(store.get({companyId:other.id,documentId:doc.id}),null);
  assert.equal(store.put({companyId:company.id,documentId:doc.id,bytes}),true);
  assert.equal(store.exists({companyId:company.id,documentId:doc.id}),true);
  assert.deepEqual(store.get({companyId:company.id,documentId:doc.id}),bytes);
  Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes});
  assert.equal(store.put({companyId:company.id,documentId:doc.id,bytes:pdf('replacement')}),false);
  assert.deepEqual(Documents.content(db,company.id,doc.id).bytes,bytes);
}finally{db.close()}});


test('färdigt dokument kan beskrivas med provider-neutral företagsisolerad metadata',()=>{const {db,company,user}=seed();try{
  const doc=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Objektmetadata',category:'other',fileName:'metadata.pdf',mimeType:'application/pdf'});
  assert.equal(Documents.privateObjectMetadata(db,company.id,doc.id),null);
  const bytes=pdf('object-metadata');
  const ready=Documents.storeContent(db,{companyId:company.id,documentId:doc.id,bytes});
  const metadata=Documents.privateObjectMetadata(db,company.id,doc.id);
  assert.equal(metadata.companyId,company.id);
  assert.equal(metadata.kind,'document');
  assert.equal(metadata.objectId,doc.id);
  assert.equal(metadata.objectKey,`private/${company.id}/documents/${doc.id}`);
  assert.equal(metadata.mimeType,'application/pdf');
  assert.equal(metadata.sizeBytes,bytes.length);
  assert.equal(metadata.sha256,ready.sha256);
  assert.equal(metadata.createdAt,ready.completedAt);

  const other=Db.createCompany(db,{legalName:'Metadata B AB',displayName:'Metadata B',orgNumber:'559901-3003'});
  assert.equal(Documents.privateObjectMetadata(db,other.id,doc.id),null);
}finally{db.close()}});
