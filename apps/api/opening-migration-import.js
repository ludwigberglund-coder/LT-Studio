'use strict';

const crypto=require('node:crypto');
const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Payables=require('./payables.js');
const SupplierAccounting=require('./supplier-accounting.js');
const Preview=require('./opening-migration-preview.js');
const {protectAppendOnly}=require('./history-guards.js');

function migrationError(message,code='OPENING_MIGRATION_IMPORT_ERROR',statusCode=422,details=null){
  const error=new Error(message);error.code=code;error.statusCode=statusCode;if(details)error.details=details;return error;
}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}
function hash(value){return crypto.createHash('sha256').update(String(value)).digest('hex')}
function deterministicId(prefix,...parts){return prefix+'_'+hash(parts.join('|')).slice(0,48)}

function initializeOpeningMigrationImport(db){
  Accounting.initializeAccountingStore(db);
  Payables.initializePayables(db);
  SupplierAccounting.initializeSupplierAccounting(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS opening_migration_imports(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      fiscal_year TEXT NOT NULL,
      posting_date TEXT NOT NULL,
      package_sha256 TEXT NOT NULL,
      opening_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      receivable_count INTEGER NOT NULL CHECK(receivable_count>=0),
      receivables_ore INTEGER NOT NULL CHECK(receivables_ore>=0),
      payable_count INTEGER NOT NULL CHECK(payable_count>=0),
      payables_ore INTEGER NOT NULL CHECK(payables_ore>=0),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,fiscal_year),
      UNIQUE(company_id,package_sha256)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS opening_migration_receivables(
      company_id TEXT NOT NULL,
      fiscal_year TEXT NOT NULL,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      customer_number TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      original_total_ore INTEGER NOT NULL CHECK(original_total_ore>0),
      opening_amount_ore INTEGER NOT NULL CHECK(opening_amount_ore>0),
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,invoice_id),
      UNIQUE(company_id,fiscal_year,customer_number,invoice_number),
      FOREIGN KEY(company_id,fiscal_year) REFERENCES opening_migration_imports(company_id,fiscal_year) ON DELETE RESTRICT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS opening_migration_payables(
      company_id TEXT NOT NULL,
      fiscal_year TEXT NOT NULL,
      invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id) ON DELETE RESTRICT,
      supplier_number TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      original_total_ore INTEGER NOT NULL CHECK(original_total_ore>0),
      opening_amount_ore INTEGER NOT NULL CHECK(opening_amount_ore>0),
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,invoice_id),
      UNIQUE(company_id,fiscal_year,supplier_number,invoice_number),
      FOREIGN KEY(company_id,fiscal_year) REFERENCES opening_migration_imports(company_id,fiscal_year) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_opening_migration_receivables_year ON opening_migration_receivables(company_id,fiscal_year);
    CREATE INDEX IF NOT EXISTS idx_opening_migration_payables_year ON opening_migration_payables(company_id,fiscal_year);
  `);
  protectAppendOnly(db,'opening_migration_imports');
  protectAppendOnly(db,'opening_migration_receivables');
  protectAppendOnly(db,'opening_migration_payables');
}

function canonicalPackage(input={}){
  const lineRows=(Array.isArray(input.lines)?input.lines:[]).map(row=>({
    account:text(row?.account),text:text(row?.text),debitOre:Number(row?.debitOre),creditOre:Number(row?.creditOre)
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const receivables=(Array.isArray(input.receivables)?input.receivables:[]).map(row=>({
    customerNumber:text(row?.customerNumber),invoiceNumber:text(row?.invoiceNumber),invoiceDate:text(row?.invoiceDate),
    dueDate:text(row?.dueDate),totalOre:Number(row?.totalOre),remainingOre:Number(row?.remainingOre)
  })).sort((a,b)=>a.customerNumber.localeCompare(b.customerNumber,'sv')||a.invoiceNumber.localeCompare(b.invoiceNumber,'sv'));
  const payables=(Array.isArray(input.payables)?input.payables:[]).map(row=>({
    supplierNumber:text(row?.supplierNumber),invoiceNumber:text(row?.invoiceNumber),invoiceDate:text(row?.invoiceDate),
    dueDate:text(row?.dueDate),totalOre:Number(row?.totalOre),remainingOre:Number(row?.remainingOre)
  })).sort((a,b)=>a.supplierNumber.localeCompare(b.supplierNumber,'sv')||a.invoiceNumber.localeCompare(b.invoiceNumber,'sv'));
  return{year:text(input.year),postingDate:text(input.postingDate),lines:lineRows,receivables,payables};
}
function packageSha256(input){return hash(JSON.stringify(canonicalPackage(input)))}

const IMPORT_SELECT=`SELECT company_id AS companyId,fiscal_year AS year,posting_date AS postingDate,package_sha256 AS packageSha256,
 opening_entry_id AS openingEntryId,receivable_count AS receivableCount,receivables_ore AS receivablesOre,
 payable_count AS payableCount,payables_ore AS payablesOre,created_by AS createdBy,created_at AS createdAt
 FROM opening_migration_imports`;
function importByYear(db,companyId,year){
  initializeOpeningMigrationImport(db);
  return db.prepare(`${IMPORT_SELECT} WHERE company_id=? AND fiscal_year=?`).get(companyId,text(year))||null;
}
function receivableByInvoice(db,companyId,invoiceId){
  initializeOpeningMigrationImport(db);
  return db.prepare(`SELECT r.company_id AS companyId,r.fiscal_year AS year,r.invoice_id AS invoiceId,r.customer_number AS customerNumber,
    r.invoice_number AS invoiceNumber,r.original_total_ore AS originalTotalOre,r.opening_amount_ore AS openingAmountOre,
    i.opening_entry_id AS openingEntryId,i.package_sha256 AS packageSha256
    FROM opening_migration_receivables r JOIN opening_migration_imports i ON i.company_id=r.company_id AND i.fiscal_year=r.fiscal_year
    WHERE r.company_id=? AND r.invoice_id=?`).get(companyId,invoiceId)||null;
}
function payableByInvoice(db,companyId,invoiceId){
  initializeOpeningMigrationImport(db);
  return db.prepare(`SELECT r.company_id AS companyId,r.fiscal_year AS year,r.invoice_id AS invoiceId,r.supplier_number AS supplierNumber,
    r.invoice_number AS invoiceNumber,r.original_total_ore AS originalTotalOre,r.opening_amount_ore AS openingAmountOre,
    i.opening_entry_id AS openingEntryId,i.package_sha256 AS packageSha256
    FROM opening_migration_payables r JOIN opening_migration_imports i ON i.company_id=r.company_id AND i.fiscal_year=r.fiscal_year
    WHERE r.company_id=? AND r.invoice_id=?`).get(companyId,invoiceId)||null;
}
function rowsForYear(db,companyId,year){
  return{
    receivables:db.prepare(`SELECT invoice_id AS invoiceId,customer_number AS customerNumber,invoice_number AS invoiceNumber,
      original_total_ore AS originalTotalOre,opening_amount_ore AS openingAmountOre
      FROM opening_migration_receivables WHERE company_id=? AND fiscal_year=? ORDER BY customer_number,invoice_number`).all(companyId,year),
    payables:db.prepare(`SELECT invoice_id AS invoiceId,supplier_number AS supplierNumber,invoice_number AS invoiceNumber,
      original_total_ore AS originalTotalOre,opening_amount_ore AS openingAmountOre
      FROM opening_migration_payables WHERE company_id=? AND fiscal_year=? ORDER BY supplier_number,invoice_number`).all(companyId,year)
  };
}
function verifyImportIntegrity(db,companyId,year){
  initializeOpeningMigrationImport(db);
  const record=importByYear(db,companyId,year);
  if(!record)return null;
  const entry=Accounting.entryById(db,companyId,record.openingEntryId);
  if(!entry||entry.sourceType!=='opening-balance'||entry.sourceId!==record.year||entry.postingDate!==record.postingDate){
    throw migrationError('Systembytesimportens ingående balans saknas eller pekar på fel verifikation.','OPENING_MIGRATION_INTEGRITY_ERROR',500);
  }
  const rows=rowsForYear(db,companyId,record.year);
  const receivableTotal=rows.receivables.reduce((sum,row)=>sum+Number(row.openingAmountOre||0),0);
  const payableTotal=rows.payables.reduce((sum,row)=>sum+Number(row.openingAmountOre||0),0);
  const ledger1510=entry.lines.filter(line=>line.account==='1510').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
  const ledger2440=entry.lines.filter(line=>line.account==='2440').reduce((sum,line)=>sum+line.creditOre-line.debitOre,0);
  const receivableMismatch=db.prepare(`SELECT COUNT(*) AS n
    FROM opening_migration_receivables r
    LEFT JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
    LEFT JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
    WHERE r.company_id=? AND r.fiscal_year=? AND (
      i.id IS NULL OR c.customer_number<>r.customer_number OR i.invoice_number<>r.invoice_number OR
      i.total_ore<>r.original_total_ore OR i.invoice_account<>'1510' OR i.posting_date<>? OR
      i.remaining_ore<0 OR i.remaining_ore>r.opening_amount_ore
    )`).get(companyId,record.year,record.postingDate)?.n||0;
  const payableMismatch=db.prepare(`SELECT COUNT(*) AS n
    FROM opening_migration_payables r
    LEFT JOIN supplier_invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
    LEFT JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id
    WHERE r.company_id=? AND r.fiscal_year=? AND (
      i.id IS NULL OR s.supplier_number<>r.supplier_number OR i.supplier_invoice_number<>r.invoice_number OR
      i.total_ore<>r.original_total_ore OR i.liability_accounting_entry_id<>? OR
      i.open_amount_ore<0 OR i.open_amount_ore>r.opening_amount_ore
    )`).get(companyId,record.year,record.openingEntryId)?.n||0;
  if(rows.receivables.length!==record.receivableCount||rows.payables.length!==record.payableCount||
     receivableTotal!==record.receivablesOre||payableTotal!==record.payablesOre||
     ledger1510!==record.receivablesOre||ledger2440!==record.payablesOre||
     Number(receivableMismatch)!==0||Number(payableMismatch)!==0){
    throw migrationError('Systembytesimportens reskontra och ingående balans stämmer inte längre överens.','OPENING_MIGRATION_INTEGRITY_ERROR',500);
  }
  return{import:record,entry,receivables:rows.receivables,payables:rows.payables};
}
function existingRetry(db,companyId,input){
  const record=importByYear(db,companyId,text(input.year));
  if(!record)return null;
  const requestedHash=packageSha256(input);
  if(record.packageSha256!==requestedHash){
    throw migrationError('Det finns redan ett systembyte för året med ett annat innehåll. Ingen ändring gjordes.','OPENING_MIGRATION_IDEMPOTENCY_CONFLICT',409);
  }
  return{...verifyImportIntegrity(db,companyId,record.year),duplicate:true};
}

function importOpeningMigration(db,input={}){
  initializeOpeningMigrationImport(db);
  const companyId=text(input.companyId),createdBy=text(input.createdBy),year=text(input.year),postingDate=text(input.postingDate);
  if(!companyId||!createdBy)throw migrationError('Företag och personlig användare krävs för systembytesimport.','OPENING_MIGRATION_IDENTITY_REQUIRED',401);
  const retry=existingRetry(db,companyId,input);if(retry)return retry;
  const preview=Preview.previewOpeningMigration(db,{companyId,year,postingDate,lines:input.lines,receivables:input.receivables,payables:input.payables});
  if(preview.status!=='pass'){
    throw migrationError('Systembytespaketet klarar inte förhandskontrollen och importerades inte.','OPENING_MIGRATION_PREVIEW_BLOCKED',409,{blockers:preview.blockers});
  }
  const packageHash=packageSha256(input);
  return Db.transaction(db,()=>{
    const concurrent=existingRetry(db,companyId,input);if(concurrent)return concurrent;
    const validated=Accounting.validateLines(input.lines).lines;
    const posted=Accounting.postEntry(db,{
      companyId,postingDate,description:`Ingående balans och reskontra ${year}`,
      sourceType:'opening-balance',sourceId:year,createdBy,series:'IB',lines:validated
    });
    if(posted.duplicate)throw migrationError('Ingående balans finns redan utan motsvarande systembyteshistorik.','OPENING_MIGRATION_INTEGRITY_ERROR',500);
    const createdAt=nowIso();
    db.prepare(`INSERT INTO opening_migration_imports(company_id,fiscal_year,posting_date,package_sha256,opening_entry_id,
      receivable_count,receivables_ore,payable_count,payables_ore,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      companyId,year,postingDate,packageHash,posted.entry.id,
      preview.counts.receivables,preview.controls.receivables.subledgerOre,
      preview.counts.payables,preview.controls.payables.subledgerOre,createdBy,createdAt
    );

    for(const row of canonicalPackage(input).receivables){
      const customer=db.prepare('SELECT id FROM customers WHERE company_id=? AND customer_number=?').get(companyId,row.customerNumber);
      if(!customer)throw migrationError('Kundregistret ändrades efter preview. Importen avbröts.','OPENING_MIGRATION_MASTERDATA_CHANGED',409);
      const invoiceId=deterministicId('openrecv',companyId,year,row.customerNumber,row.invoiceNumber);
      Db.createInvoice(db,{
        id:invoiceId,companyId,customerId:customer.id,invoiceNumber:row.invoiceNumber,
        invoiceDate:row.invoiceDate,postingDate,dueDate:row.dueDate,totalOre:row.totalOre,remainingOre:row.remainingOre,
        vatOre:0,status:'Importerad',invoiceAccount:'1510',journalNumber:posted.entry.number
      });
      db.prepare(`INSERT INTO opening_migration_receivables(company_id,fiscal_year,invoice_id,customer_number,invoice_number,
        original_total_ore,opening_amount_ore,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
        companyId,year,invoiceId,row.customerNumber,row.invoiceNumber,row.totalOre,row.remainingOre,createdAt
      );
    }

    for(const row of canonicalPackage(input).payables){
      const supplier=Payables.supplierByNumber(db,companyId,row.supplierNumber);
      if(!supplier)throw migrationError('Leverantörsregistret ändrades efter preview. Importen avbröts.','OPENING_MIGRATION_MASTERDATA_CHANGED',409);
      const invoiceId=deterministicId('openpay',companyId,year,row.supplierNumber,row.invoiceNumber);
      db.prepare(`INSERT INTO supplier_invoices(
        id,company_id,supplier_id,supplier_invoice_number,invoice_date,due_date,total_ore,vat_ore,currency,vat_treatment,
        status,coding_json,coding_sha256,registered_by,approved_by,approved_at,liability_accounting_entry_id,
        liability_posted_at,open_amount_ore,accounting_status,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,'SEK',NULL,'approved','[]',NULL,?,?,?,?,?,?,'posted',?,?)`).run(
        invoiceId,companyId,supplier.id,row.invoiceNumber,row.invoiceDate,row.dueDate,row.totalOre,
        createdBy,createdBy,createdAt,posted.entry.id,createdAt,row.remainingOre,createdAt,createdAt
      );
      db.prepare(`INSERT INTO opening_migration_payables(company_id,fiscal_year,invoice_id,supplier_number,invoice_number,
        original_total_ore,opening_amount_ore,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
        companyId,year,invoiceId,row.supplierNumber,row.invoiceNumber,row.totalOre,row.remainingOre,createdAt
      );
    }

    Db.appendAudit(db,{companyId,userId:createdBy,action:'OPENING_MIGRATION_IMPORTED',entityType:'opening-migration',entityId:year,details:{
      packageSha256:packageHash,openingEntryId:posted.entry.id,openingEntryNumber:posted.entry.number,
      receivableCount:preview.counts.receivables,receivablesOre:preview.controls.receivables.subledgerOre,
      payableCount:preview.counts.payables,payablesOre:preview.controls.payables.subledgerOre
    }});
    return{...verifyImportIntegrity(db,companyId,year),duplicate:false};
  });
}

module.exports=Object.freeze({
  initializeOpeningMigrationImport,canonicalPackage,packageSha256,importByYear,receivableByInvoice,payableByInvoice,
  verifyImportIntegrity,importOpeningMigration,migrationError
});
