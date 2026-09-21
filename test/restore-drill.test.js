'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const Db=require('../apps/api/database.js');
const Documents=require('../apps/api/documents.js');
const Payables=require('../apps/api/payables.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');
const PdfArchiveStore=require('../apps/api/customer-invoice-pdf-archive-store.js');
const Drill=require('../scripts/pilot-restore-drill.js');

const root=path.resolve(__dirname,'..');
const KEY='Restore-Drill-Test-Key-2026-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex')}

function createEncryptedBackup(dir){
  const databasePath=path.join(dir,'source.sqlite'),backupDir=path.join(dir,'backups');
  fs.mkdirSync(backupDir,{mode:0o700});
  const db=Db.openDatabase(databasePath);
  Documents.initializeDocuments(db);
  Payables.initializePayables(db);
  CustomerInvoicing.initializeCustomerInvoicing(db);

  const company=Db.createCompany(db,{legalName:'Restore Drill AB',displayName:'Restore Drill',orgNumber:'559944-1001'});
  const user=Db.createUser(db,{username:'drill.user',displayName:'Drill User',passwordHash:'test-only'});
  Db.addMembership(db,{companyId:company.id,userId:user.id});
  Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'RESTORE_DRILL_FIXTURE',entityType:'company',entityId:company.id});

  const pending=Documents.createPending(db,{companyId:company.id,uploadedBy:user.id,title:'Restore drill document',category:'other',fileName:'restore-drill.pdf',mimeType:'application/pdf'});
  Documents.storeContent(db,{companyId:company.id,documentId:pending.id,bytes:Buffer.from('%PDF-1.4\n% restore drill document\n','ascii')});

  const supplier=Payables.createSupplier(db,{companyId:company.id,supplierNumber:'DRILL-SUP',name:'Restore Drill Supplier AB',bankgiro:'987-6543',defaultCostAccount:'4010'});
  const supplierInvoice=Payables.createSupplierInvoice(db,{
    companyId:company.id,
    supplierId:supplier.id,
    supplierInvoiceNumber:'DRILL-SUP-1',
    invoiceDate:'2026-09-20',
    dueDate:'2026-10-20',
    totalOre:12500,
    vatOre:2500,
    registeredBy:user.id
  });
  Payables.storeDocument(db,{
    companyId:company.id,
    invoiceId:supplierInvoice.id,
    name:'restore-drill-supplier.pdf',
    bytes:Buffer.from('%PDF-1.4\n% restore drill supplier\n','ascii')
  });

  const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'DRILL-K',name:'Restore Drill Customer AB'});
  const invoice=Db.createInvoice(db,{
    companyId:company.id,
    customerId:customer.id,
    invoiceNumber:'DRILL-1001',
    invoiceDate:'2026-09-20',
    postingDate:'2026-09-20',
    dueDate:'2026-10-20',
    totalOre:25000,
    remainingOre:25000,
    vatOre:5000,
    status:'Bokförd'
  });
  const documentJson=JSON.stringify({documentType:'FAKTURA',invoiceNumber:'DRILL-1001'});
  const createdAt='2026-09-20T12:00:00.000Z';
  db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)')
    .run(invoice.id,company.id,documentJson,sha256(Buffer.from(documentJson)),createdAt);
  const pdfBytes=Buffer.from('%PDF-1.4\n% restore drill customer invoice\n','ascii');
  PdfArchiveStore.createSqliteCustomerInvoicePdfArchiveStore(db).put({
    invoiceId:invoice.id,
    companyId:company.id,
    fileName:'Faktura-DRILL-1001.pdf',
    bytes:pdfBytes,
    pdfSha256:sha256(pdfBytes),
    sizeBytes:pdfBytes.length,
    createdAt
  });

  db.close();
  const result=spawnSync(process.execPath,['scripts/pilot-backup.js'],{
    cwd:root,
    encoding:'utf8',
    env:{...process.env,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_BACKUP_PATH:backupDir,ROLLANDS_BACKUP_ENCRYPTION_KEY:KEY}
  });
  assert.equal(result.status,0,result.stderr);
  return{
    databasePath,
    backupDir,
    encrypted:path.join(backupDir,fs.readdirSync(backupDir).find(name=>name.endsWith('.sqlite.enc')))
  };
}

test('restore drill verifierar alla privata objekt och skriver evidens först efter lyckad återställning',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-restore-drill-'));
  try{
    const {databasePath,backupDir,encrypted}=createEncryptedBackup(dir);
    const drillDir=path.join(dir,'drill'),evidencePath=path.join(dir,'ops','restore-evidence.json');
    const result=spawnSync(process.execPath,['scripts/pilot-restore-drill.js'],{cwd:root,encoding:'utf8',env:{
      ...process.env,
      ROLLANDS_DATABASE_PATH:databasePath,
      ROLLANDS_BACKUP_PATH:backupDir,
      ROLLANDS_BACKUP_ENCRYPTION_KEY:KEY,
      ROLLANDS_RESTORE_DRILL_PATH:drillDir,
      ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH:evidencePath
    }});
    assert.equal(result.status,0,result.stderr);
    const stdout=JSON.parse(result.stdout.trim().split('\n')[0]);
    assert.equal(stdout.verified,true);

    const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
    assert.equal(evidence.schemaVersion,2);
    assert.equal(evidence.sourceFile,path.basename(encrypted));
    assert.equal(evidence.sqliteIntegrity,true);
    assert.equal(evidence.foreignKeys,true);
    assert.equal(evidence.privateObjectsVerified,true);
    assert.equal(evidence.privateObjectCount,3);
    assert.equal(evidence.verifiedPrivateObjectCount,3);
    assert.equal(evidence.privateObjectIssueCount,0);
    assert.equal(evidence.privateObjectsByKind.document.objects,1);
    assert.equal(evidence.privateObjectsByKind.document.verified,1);
    assert.equal(evidence.privateObjectsByKind['supplier-invoice'].objects,1);
    assert.equal(evidence.privateObjectsByKind['supplier-invoice'].verified,1);
    assert.equal(evidence.privateObjectsByKind['customer-invoice-pdf'].objects,1);
    assert.equal(evidence.privateObjectsByKind['customer-invoice-pdf'].verified,1);
    assert.ok(evidence.privateObjectBytes>0);
    assert.equal(evidence.productionDatabaseTouched,false);
    assert.equal(evidence.restoreCopyRemoved,true);
    assert.equal(fs.statSync(evidencePath).mode&0o077,0);
    assert.deepEqual(fs.existsSync(drillDir)?fs.readdirSync(drillDir):[],[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('restore drill med fel nyckel misslyckas och skriver inte nytt evidens',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-restore-drill-key-'));
  try{
    const {databasePath,backupDir}=createEncryptedBackup(dir);
    const drillDir=path.join(dir,'drill'),evidencePath=path.join(dir,'ops','restore-evidence.json');
    fs.mkdirSync(path.dirname(evidencePath),{recursive:true});
    fs.writeFileSync(evidencePath,'{"sentinel":true}\n');
    const result=spawnSync(process.execPath,['scripts/pilot-restore-drill.js'],{cwd:root,encoding:'utf8',env:{
      ...process.env,ROLLANDS_DATABASE_PATH:databasePath,ROLLANDS_BACKUP_PATH:backupDir,
      ROLLANDS_BACKUP_ENCRYPTION_KEY:'Wrong-Restore-Drill-Key-2026-abcdefghijklmnopqrstuvwxyz',
      ROLLANDS_RESTORE_DRILL_PATH:drillDir,ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH:evidencePath
    }});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/autentiseras|dekrypteras/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath,'utf8')),{sentinel:true});
    assert.deepEqual(fs.existsSync(drillDir)?fs.readdirSync(drillDir):[],[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('restore drill stoppar manipulerad krypterad backup före dekryptering',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollands-restore-drill-tamper-'));
  try{
    const {backupDir,encrypted}=createEncryptedBackup(dir);
    const fd=fs.openSync(encrypted,'r+');
    try{
      const b=Buffer.alloc(1);
      fs.readSync(fd,b,0,1,40);
      b[0]^=1;
      fs.writeSync(fd,b,0,1,40);
    }finally{fs.closeSync(fd)}
    assert.throws(()=>Drill.verifyTransportChecksum(encrypted),/RESTORE_DRILL_CHECKSUM_FAILED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
