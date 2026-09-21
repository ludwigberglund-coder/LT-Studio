'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Db=require('../apps/api/database.js');
const Accounting=require('../apps/api/accounting-store.js');
const Documents=require('../apps/api/documents.js');
const Payables=require('../apps/api/payables.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');
const PdfArchiveStore=require('../apps/api/customer-invoice-pdf-archive-store.js');
const {verifyDatabase}=require('../scripts/pilot-restore-verify.js');

function sqlLiteral(value){return `'${String(value).replaceAll("'","''")}'`}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}

test('SQLite-backup återställer ekonomi och verifierar alla tre privata filflöden',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-backup-restore-'));
  const sourcePath=path.join(dir,'source.sqlite');
  const backupPath=path.join(dir,'backup.sqlite');
  let source,restored;
  try{
    source=Db.openDatabase(sourcePath);
    Accounting.initializeAccountingStore(source);
    Documents.initializeDocuments(source);
    Payables.initializePayables(source);
    CustomerInvoicing.initializeCustomerInvoicing(source);

    const company=Db.createCompany(source,{legalName:'Pilot Backup AB',displayName:'Pilot Backup',orgNumber:'559999-1001'});
    const user=Db.createUser(source,{username:'backup-test',displayName:'Backup Test',passwordHash:'test-only-hash'});
    Db.addMembership(source,{companyId:company.id,userId:user.id});

    const customer=Db.createCustomer(source,{companyId:company.id,customerNumber:'K-RESTORE',name:'Restore Kund AB'});
    const invoice=Db.createInvoice(source,{companyId:company.id,customerId:customer.id,invoiceNumber:'R-1001',invoiceDate:'2026-09-17',postingDate:'2026-09-17',dueDate:'2026-10-17',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'});
    const posted=Accounting.postEntry(source,{companyId:company.id,postingDate:'2026-09-17',description:'Backup restore kontroll',sourceType:'backup-test',sourceId:invoice.id,createdBy:user.id,lines:[
      {account:'1510',debitOre:125000,creditOre:0,text:'Kundfordran'},
      {account:'3001',debitOre:0,creditOre:100000,text:'Försäljning'},
      {account:'2611',debitOre:0,creditOre:25000,text:'Utgående moms'}
    ]});
    Db.appendAudit(source,{companyId:company.id,userId:user.id,action:'BACKUP_TEST_CREATED',entityType:'invoice',entityId:invoice.id});

    const pendingDocument=Documents.createPending(source,{companyId:company.id,uploadedBy:user.id,title:'Backup original',category:'other',fileName:'backup-original.pdf',mimeType:'application/pdf'});
    const documentBytes=Buffer.from('%PDF-1.4\n% backup original\n','ascii');
    Documents.storeContent(source,{companyId:company.id,documentId:pendingDocument.id,bytes:documentBytes});

    const supplier=Payables.createSupplier(source,{companyId:company.id,supplierNumber:'L-RESTORE',name:'Restore Leverantör AB',bankgiro:'123-4567',defaultCostAccount:'4010'});
    const supplierInvoice=Payables.createSupplierInvoice(source,{
      companyId:company.id,
      supplierId:supplier.id,
      supplierInvoiceNumber:'LEV-RESTORE-1',
      invoiceDate:'2026-09-17',
      dueDate:'2026-10-17',
      totalOre:62500,
      vatOre:12500,
      registeredBy:user.id
    });
    const supplierPdfBytes=Buffer.from('%PDF-1.4\n% supplier restore archive\n','ascii');
    Payables.storeDocument(source,{companyId:company.id,invoiceId:supplierInvoice.id,name:'supplier-restore.pdf',bytes:supplierPdfBytes});

    const customerPdfInvoice=Db.createInvoice(source,{companyId:company.id,customerId:customer.id,invoiceNumber:'R-1002',invoiceDate:'2026-09-18',postingDate:'2026-09-18',dueDate:'2026-10-18',totalOre:25000,remainingOre:25000,vatOre:5000,status:'Bokförd'});
    const customerDocumentJson=JSON.stringify({documentType:'FAKTURA',invoiceNumber:'R-1002'});
    const customerPdfCreatedAt='2026-09-18T12:00:00.000Z';
    source.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)')
      .run(customerPdfInvoice.id,company.id,customerDocumentJson,sha256(Buffer.from(customerDocumentJson)),customerPdfCreatedAt);
    const customerPdfBytes=Buffer.from('%PDF-1.4\n% customer restore archive\n','ascii');
    PdfArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(source).put({
      invoiceId:customerPdfInvoice.id,
      companyId:company.id,
      fileName:'Faktura-R-1002.pdf',
      bytes:customerPdfBytes,
      pdfSha256:sha256(customerPdfBytes),
      sizeBytes:customerPdfBytes.length,
      createdAt:customerPdfCreatedAt
    });

    const sourceIntegrity=source.prepare('PRAGMA integrity_check').get();
    assert.equal(sourceIntegrity.integrity_check,'ok');
    source.exec(`VACUUM INTO ${sqlLiteral(backupPath)}`);
    assert.ok(fs.statSync(backupPath).size>0);

    const verifiedBackup=verifyDatabase(backupPath);
    assert.equal(verifiedBackup.archivedDocuments,1);
    assert.equal(verifiedBackup.privateObjectsVerified,true);
    assert.equal(verifiedBackup.privateObjectCount,3);
    assert.equal(verifiedBackup.verifiedPrivateObjectCount,3);
    assert.equal(verifiedBackup.privateObjectIssueCount,0);
    assert.equal(verifiedBackup.privateObjectsByKind.document.objects,1);
    assert.equal(verifiedBackup.privateObjectsByKind['supplier-invoice'].objects,1);
    assert.equal(verifiedBackup.privateObjectsByKind['customer-invoice-pdf'].objects,1);

    source.close();source=null;
    restored=Db.openDatabase(backupPath);
    Accounting.initializeAccountingStore(restored);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(Db.companyById(restored,company.id).orgNumber,'559999-1001');
    assert.equal(Db.customerById(restored,company.id,customer.id).customerNumber,'K-RESTORE');
    const restoredInvoice=Db.invoiceById(restored,company.id,invoice.id);
    assert.equal(restoredInvoice.remainingOre,125000);
    assert.equal(restoredInvoice.totalOre,125000);
    const restoredEntry=Accounting.entryBySource(restored,company.id,'backup-test',invoice.id);
    assert.equal(restoredEntry.number,posted.entry.number);
    assert.deepEqual(restoredEntry.lines.map(line=>[line.account,line.debitOre,line.creditOre]),[
      ['1510',125000,0],['3001',0,100000],['2611',0,25000]
    ]);
    assert.equal(Accounting.listEntries(restored,company.id).length,1);
    assert.equal(Db.listReceivables(restored,company.id).find(row=>row.id===invoice.id)?.remainingOre,125000);
    assert.ok(Db.auditForCompany(restored,company.id).some(event=>event.action==='BACKUP_TEST_CREATED'));
    assert.deepEqual(Buffer.from(Documents.content(restored,company.id,pendingDocument.id).bytes),documentBytes);
    assert.deepEqual(Buffer.from(Payables.document(restored,company.id,supplierInvoice.id).bytes),supplierPdfBytes);
    assert.deepEqual(
      Buffer.from(PdfArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(restored).get({companyId:company.id,invoiceId:customerPdfInvoice.id}).bytes),
      customerPdfBytes
    );
    restored.close();restored=null;

    const corrupt=new DatabaseSync(backupPath);
    try{
      corrupt.prepare('UPDATE supplier_invoices SET document_blob=? WHERE company_id=? AND id=?')
        .run(Buffer.from('%PDF-1.4\n% corrupted supplier\n','ascii'),company.id,supplierInvoice.id);
    }finally{corrupt.close()}
    assert.throws(()=>verifyDatabase(backupPath),/RESTORE_PRIVATE_OBJECT_INTEGRITY_FAILED/);
  }finally{
    try{source?.close()}catch{}
    try{restored?.close()}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
