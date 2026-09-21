'use strict';

const crypto=require('node:crypto');
const Domain=require('../../packages/payables/supplier-invoices.js');
const PrivateObject=require('./private-object-contract.js');
const StoreFactory=require('./private-object-store-factory.js');

function err(message,code='PAYABLES_ERROR',statusCode=422,details){const e=new Error(message);e.code=code;e.statusCode=statusCode;if(details)e.details=details;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function nowIso(){return new Date().toISOString()}
function text(value){return String(value??'').trim()}
function json(value,fallback){try{return JSON.parse(value)}catch{return fallback}}
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(value)))return false;const [y,m,d]=value.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d}
function validAccount(value){return /^\d{4}$/.test(text(value))}
function normalizeInvoiceNumber(value){return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
function hasColumn(db,table,column){return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column)}

function initializePayables(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers(
      id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_number TEXT NOT NULL,name TEXT NOT NULL,org_number TEXT,email TEXT,bankgiro TEXT,plusgiro TEXT,
      default_cost_account TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(company_id,supplier_number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS supplier_invoices(
      id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,supplier_invoice_number TEXT NOT NULL,
      invoice_date TEXT NOT NULL,due_date TEXT NOT NULL,total_ore INTEGER NOT NULL CHECK(total_ore>0),
      vat_ore INTEGER NOT NULL DEFAULT 0 CHECK(vat_ore>=0),currency TEXT NOT NULL DEFAULT 'SEK',vat_treatment TEXT,
      status TEXT NOT NULL CHECK(status IN ('registered','coding-review','coded','approved','payment-prepared','paid','rejected')),
      coding_json TEXT NOT NULL DEFAULT '[]',coding_sha256 TEXT,document_name TEXT,document_mime TEXT,document_sha256 TEXT,document_blob BLOB,
      registered_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      approved_at TEXT,liability_accounting_entry_id TEXT,liability_posted_at TEXT,open_amount_ore INTEGER NOT NULL DEFAULT 0 CHECK(open_amount_ore>=0),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(company_id,supplier_id,supplier_invoice_number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS supplier_payments(
      id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      supplier_invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id) ON DELETE RESTRICT,payment_date TEXT NOT NULL,
      amount_ore INTEGER NOT NULL CHECK(amount_ore>0),account TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('prepared','released','paid','cancelled')),
      prepared_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,released_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      released_at TEXT,recipient_name TEXT,recipient_bankgiro TEXT,recipient_plusgiro TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(company_id,supplier_invoice_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_supplier_invoice_company_status ON supplier_invoices(company_id,status,due_date);
    CREATE INDEX IF NOT EXISTS idx_supplier_payment_company_date ON supplier_payments(company_id,payment_date,status);
    CREATE INDEX IF NOT EXISTS idx_supplier_invoice_document_sha ON supplier_invoices(company_id,document_sha256);
  `);
  if(!hasColumn(db,'supplier_payments','recipient_name'))db.exec('ALTER TABLE supplier_payments ADD COLUMN recipient_name TEXT');
  if(!hasColumn(db,'supplier_payments','recipient_bankgiro'))db.exec('ALTER TABLE supplier_payments ADD COLUMN recipient_bankgiro TEXT');
  if(!hasColumn(db,'supplier_payments','recipient_plusgiro'))db.exec('ALTER TABLE supplier_payments ADD COLUMN recipient_plusgiro TEXT');
  if(!hasColumn(db,'supplier_invoices','vat_treatment'))db.exec('ALTER TABLE supplier_invoices ADD COLUMN vat_treatment TEXT');
  if(!hasColumn(db,'supplier_invoices','liability_accounting_entry_id'))db.exec('ALTER TABLE supplier_invoices ADD COLUMN liability_accounting_entry_id TEXT');
  if(!hasColumn(db,'supplier_invoices','liability_posted_at'))db.exec('ALTER TABLE supplier_invoices ADD COLUMN liability_posted_at TEXT');
  if(!hasColumn(db,'supplier_invoices','open_amount_ore')){
    db.exec('ALTER TABLE supplier_invoices ADD COLUMN open_amount_ore INTEGER NOT NULL DEFAULT 0');
    db.exec(`UPDATE supplier_invoices SET open_amount_ore=CASE WHEN status='paid' THEN 0 ELSE total_ore END`);
  }
}

function listSuppliers(db,companyId){return db.prepare(`SELECT id,company_id AS companyId,supplier_number AS supplierNumber,name,org_number AS orgNumber,email,bankgiro,plusgiro,default_cost_account AS defaultCostAccount FROM suppliers WHERE company_id=? ORDER BY name,supplier_number`).all(companyId)}
function supplierById(db,companyId,supplierId){return db.prepare(`SELECT id,company_id AS companyId,supplier_number AS supplierNumber,name,org_number AS orgNumber,email,bankgiro,plusgiro,default_cost_account AS defaultCostAccount FROM suppliers WHERE company_id=? AND id=?`).get(companyId,supplierId)||null}
function supplierByNumber(db,companyId,supplierNumber){return db.prepare(`SELECT id,company_id AS companyId,supplier_number AS supplierNumber,name,org_number AS orgNumber,email,bankgiro,plusgiro,default_cost_account AS defaultCostAccount FROM suppliers WHERE company_id=? AND supplier_number=?`).get(companyId,text(supplierNumber))||null}
function createSupplier(db,input){const companyId=text(input.companyId),supplierNumber=text(input.supplierNumber),name=text(input.name),defaultCostAccount=text(input.defaultCostAccount);if(!companyId||supplierNumber.length<1||supplierNumber.length>40||name.length<2||name.length>160)throw err('Företag, leverantörsnummer och namn krävs.','INVALID_SUPPLIER');if(defaultCostAccount&&!validAccount(defaultCostAccount))throw err('Standardkontot måste bestå av fyra siffror.','INVALID_SUPPLIER_ACCOUNT');if(supplierByNumber(db,companyId,supplierNumber))throw err('Leverantörsnumret används redan.','DUPLICATE_SUPPLIER',409);const now=nowIso(),supplierId=input.id||id('supplier');db.prepare(`INSERT INTO suppliers(id,company_id,supplier_number,name,org_number,email,bankgiro,plusgiro,default_cost_account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(supplierId,companyId,supplierNumber,name,text(input.orgNumber)||null,text(input.email)||null,text(input.bankgiro)||null,text(input.plusgiro)||null,defaultCostAccount||null,now,now);return supplierById(db,companyId,supplierId)}

function invoiceById(db,companyId,invoiceId){
  const row=db.prepare(`SELECT i.id,i.company_id AS companyId,i.supplier_id AS supplierId,i.supplier_invoice_number AS supplierInvoiceNumber,i.invoice_date AS invoiceDate,i.due_date AS dueDate,i.total_ore AS totalOre,i.vat_ore AS vatOre,i.currency,i.vat_treatment AS vatTreatment,i.status,i.coding_json AS codingJson,i.coding_sha256 AS codingSha256,i.document_name AS documentName,i.document_mime AS documentMime,i.document_sha256 AS documentSha256,i.registered_by AS registeredBy,i.approved_by AS approvedBy,i.approved_at AS approvedAt,i.liability_accounting_entry_id AS liabilityAccountingEntryId,i.liability_posted_at AS liabilityPostedAt,i.open_amount_ore AS openAmountOre,i.created_at AS createdAt,i.updated_at AS updatedAt,s.supplier_number AS supplierNumber,s.name AS supplierName,s.bankgiro,s.plusgiro,s.default_cost_account AS defaultCostAccount FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE i.company_id=? AND i.id=?`).get(companyId,invoiceId);
  return row?{...row,coding:json(row.codingJson,[]),hasDocument:Boolean(row.documentSha256),liabilityPosted:Boolean(row.liabilityAccountingEntryId)}:null;
}
function listInvoices(db,companyId){return db.prepare(`SELECT i.id,i.company_id AS companyId,i.supplier_id AS supplierId,i.supplier_invoice_number AS supplierInvoiceNumber,i.invoice_date AS invoiceDate,i.due_date AS dueDate,i.total_ore AS totalOre,i.vat_ore AS vatOre,i.currency,i.vat_treatment AS vatTreatment,i.status,i.registered_by AS registeredBy,i.approved_by AS approvedBy,i.approved_at AS approvedAt,i.liability_accounting_entry_id AS liabilityAccountingEntryId,i.liability_posted_at AS liabilityPostedAt,i.open_amount_ore AS openAmountOre,CASE WHEN i.document_sha256 IS NULL THEN 0 ELSE 1 END AS hasDocument,s.supplier_number AS supplierNumber,s.name AS supplierName,s.bankgiro,s.plusgiro FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE i.company_id=? ORDER BY i.due_date,i.created_at`).all(companyId).map(row=>({...row,hasDocument:Boolean(row.hasDocument),liabilityPosted:Boolean(row.liabilityAccountingEntryId)}))}
function duplicateInvoice(db,companyId,supplierId,number){const normalized=normalizeInvoiceNumber(number);if(!normalized)return null;const rows=db.prepare(`SELECT id,supplier_invoice_number AS supplierInvoiceNumber FROM supplier_invoices WHERE company_id=? AND supplier_id=?`).all(companyId,supplierId);return rows.find(row=>normalizeInvoiceNumber(row.supplierInvoiceNumber)===normalized)||null}
function duplicateDocument(db,companyId,sha,excludeInvoiceId=''){const row=excludeInvoiceId?db.prepare(`SELECT id,supplier_id AS supplierId,supplier_invoice_number AS supplierInvoiceNumber FROM supplier_invoices WHERE company_id=? AND document_sha256=? AND id<>?`).get(companyId,sha,excludeInvoiceId):db.prepare(`SELECT id,supplier_id AS supplierId,supplier_invoice_number AS supplierInvoiceNumber FROM supplier_invoices WHERE company_id=? AND document_sha256=?`).get(companyId,sha);return row||null}
function createSupplierInvoice(db,input){const companyId=text(input.companyId),supplierId=text(input.supplierId),number=text(input.supplierInvoiceNumber),invoiceDate=text(input.invoiceDate),dueDate=text(input.dueDate),currency=text(input.currency||'SEK').toUpperCase(),vatTreatment=text(input.vatTreatment)||null;if(!companyId||!supplierId||number.length<1||number.length>100||!normalizeInvoiceNumber(number))throw err('Företag, leverantör och fakturanummer krävs.','INVALID_SUPPLIER_INVOICE');if(!supplierById(db,companyId,supplierId))throw err('Leverantören hittades inte i företaget.','SUPPLIER_NOT_FOUND',404);if(!validDate(invoiceDate)||!validDate(dueDate)||dueDate<invoiceDate)throw err('Fakturadatum eller förfallodatum är ogiltigt.','INVALID_SUPPLIER_INVOICE_DATE');if(!Number.isSafeInteger(input.totalOre)||input.totalOre<=0||!Number.isSafeInteger(input.vatOre||0)||input.vatOre<0||input.vatOre>input.totalOre)throw err('Fakturabelopp och moms måste anges som giltiga heltal i ören.','INVALID_SUPPLIER_INVOICE_AMOUNT');if(currency!=='SEK')throw err('Den första versionen av leverantörsfakturor stöder endast SEK.','UNSUPPORTED_CURRENCY');if(vatTreatment&&vatTreatment!=='se-domestic-full-input-vat')throw err('Momsbehandlingen stöds inte i leverantörsfakturaflödet.','UNSUPPORTED_SUPPLIER_VAT_TREATMENT');if(vatTreatment&&input.vatOre<=0)throw err('Den verifierade svenska momsbehandlingen kräver ett positivt momsbelopp.','UNSUPPORTED_SUPPLIER_VAT_TREATMENT');const duplicate=duplicateInvoice(db,companyId,supplierId,number);if(duplicate)throw err(`Leverantörsfakturan verkar redan vara registrerad som ${duplicate.supplierInvoiceNumber}.`,'DUPLICATE_SUPPLIER_INVOICE',409,{existingInvoiceId:duplicate.id});const now=nowIso(),invoiceId=input.id||id('sinv');db.prepare(`INSERT INTO supplier_invoices(id,company_id,supplier_id,supplier_invoice_number,invoice_date,due_date,total_ore,vat_ore,currency,vat_treatment,status,open_amount_ore,registered_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'registered',?,?,?,?)`).run(invoiceId,companyId,supplierId,number,invoiceDate,dueDate,input.totalOre,input.vatOre||0,currency,vatTreatment,input.totalOre,input.registeredBy,now,now);return invoiceById(db,companyId,invoiceId)}
function supplierHistory(db,companyId,supplierId,{excludeInvoiceId='',limit=20}={}){const safe=Math.max(1,Math.min(100,Number(limit)||20));const rows=excludeInvoiceId?db.prepare(`SELECT id,status,coding_json AS codingJson,total_ore AS totalOre,vat_ore AS vatOre,approved_at AS approvedAt FROM supplier_invoices WHERE company_id=? AND supplier_id=? AND id<>? AND status IN ('approved','payment-prepared','paid') ORDER BY approved_at DESC LIMIT ?`).all(companyId,supplierId,excludeInvoiceId,safe):db.prepare(`SELECT id,status,coding_json AS codingJson,total_ore AS totalOre,vat_ore AS vatOre,approved_at AS approvedAt FROM supplier_invoices WHERE company_id=? AND supplier_id=? AND status IN ('approved','payment-prepared','paid') ORDER BY approved_at DESC LIMIT ?`).all(companyId,supplierId,safe);return rows.map(row=>({...row,coding:json(row.codingJson,[])}))}
function storeDocument(db,{companyId,invoiceId,name,mime='application/pdf',bytes}){
  const invoice=invoiceById(db,companyId,invoiceId);
  if(!invoice)throw err('Leverantörsfakturan hittades inte.','INVOICE_NOT_FOUND',404);
  if(!['registered','coding-review','coded'].includes(invoice.status))throw err('PDF-underlaget kan inte bytas efter attest.','DOCUMENT_LOCKED',409);
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw err('PDF-dokument saknas.','MISSING_DOCUMENT');
  if(mime!=='application/pdf')throw err('Endast PDF stöds för leverantörsfakturor i denna version.','UNSUPPORTED_DOCUMENT_TYPE');
  if(bytes.length>10*1024*1024)throw err('PDF-filen får vara högst 10 MB.','DOCUMENT_TOO_LARGE',413);
  if(bytes.length<5||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw err('Filen ser inte ut att vara en giltig PDF.','INVALID_PDF');
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  const duplicate=duplicateDocument(db,companyId,sha,invoiceId);
  if(duplicate)throw err(`Samma PDF-underlag används redan på faktura ${duplicate.supplierInvoiceNumber}.`,'DUPLICATE_SUPPLIER_DOCUMENT',409,{existingInvoiceId:duplicate.id});
  const updatedAt=nowIso();
  const metadata=PrivateObject.createPrivateObjectMetadata({
    companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE,
    objectId:invoiceId,
    mimeType:mime,
    sizeBytes:bytes.length,
    sha256:sha,
    createdAt:invoice.createdAt
  });
  const store=StoreFactory.createPrivateObjectStore({
    db,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE
  });
  const savepoint=`supplier_pdf_${crypto.randomBytes(8).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try{
    if(!store.put({metadata,bytes}))throw err('PDF-underlaget kunde inte lagras.','DOCUMENT_STORE_FAILED',409);
    const result=db.prepare(`UPDATE supplier_invoices
      SET document_name=?,document_mime=?,document_sha256=?,updated_at=?
      WHERE company_id=? AND id=? AND status IN ('registered','coding-review','coded')`).run(text(name)||'leverantorsfaktura.pdf',mime,sha,updatedAt,companyId,invoiceId);
    if(result.changes!==1)throw err('PDF-underlagets metadata kunde inte färdigställas.','DOCUMENT_STORE_FAILED',409);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  }catch(error){
    try{db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)}catch{}
    try{db.exec(`RELEASE SAVEPOINT ${savepoint}`)}catch{}
    throw error;
  }
  return {sha256:sha,size:bytes.length};
}
function document(db,companyId,invoiceId){
  const row=db.prepare(`SELECT document_name AS name,document_mime AS mime,document_sha256 AS sha256 FROM supplier_invoices WHERE company_id=? AND id=?`).get(companyId,invoiceId);
  if(row){
    const store=StoreFactory.createPrivateObjectStore({
      db,
      kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE
    });
    row.bytes=store.get({companyId,kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE,objectId:invoiceId});
  }
  if(!row||!row.bytes)throw err('PDF-underlaget hittades inte.','DOCUMENT_NOT_FOUND',404);
  const actual=crypto.createHash('sha256').update(row.bytes).digest('hex');
  if(row.mime!=='application/pdf'||actual!==row.sha256){
    throw err('PDF-underlaget stämmer inte med sitt sparade digitala fingeravtryck. Dokumentet måste granskas innan det kan visas eller attesteras.','DOCUMENT_INTEGRITY_ERROR',409);
  }
  return row;
}
function privateObjectMetadata(db,companyId,invoiceId){
  const invoice=invoiceById(db,companyId,invoiceId);
  if(!invoice?.hasDocument)return null;
  const stored=document(db,companyId,invoiceId);
  return PrivateObject.createPrivateObjectMetadata({
    companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.SUPPLIER_INVOICE,
    objectId:invoiceId,
    mimeType:stored.mime,
    sizeBytes:stored.bytes.length,
    sha256:stored.sha256,
    createdAt:invoice.createdAt
  });
}
function saveCoding(db,{companyId,invoiceId,lines}){const invoice=invoiceById(db,companyId,invoiceId);if(!invoice)throw err('Leverantörsfakturan hittades inte.','INVOICE_NOT_FOUND',404);if(!['registered','coding-review','coded'].includes(invoice.status))throw err('Konteringen kan inte ändras efter attest.','CODING_LOCKED',409);const validated=Domain.validateCoding({totalOre:invoice.totalOre,lines});const hash=Domain.codingHash(validated.lines);db.prepare(`UPDATE supplier_invoices SET coding_json=?,coding_sha256=?,status='coded',updated_at=? WHERE company_id=? AND id=?`).run(JSON.stringify(validated.lines),hash,nowIso(),companyId,invoiceId);return invoiceById(db,companyId,invoiceId)}
function approve(db,{companyId,invoiceId,actorId,expectedCodingSha256,expectedDocumentSha256}){const invoice=invoiceById(db,companyId,invoiceId);if(!invoice)throw err('Leverantörsfakturan hittades inte.','INVOICE_NOT_FOUND',404);if(!invoice.hasDocument)throw err('PDF-underlag krävs innan fakturan kan attesteras.','DOCUMENT_REQUIRED_FOR_APPROVAL',409);const expectedCoding=text(expectedCodingSha256),expectedDocument=text(expectedDocumentSha256);if(!/^[a-f0-9]{64}$/.test(expectedCoding)||!/^[a-f0-9]{64}$/.test(expectedDocument))throw err('Attest kräver versionsuppgifter för både kontering och PDF-underlag. Ladda om fakturan och granska igen.','APPROVAL_PRECONDITION_REQUIRED',428);if(invoice.codingSha256!==expectedCoding)throw err('Konteringen har ändrats sedan den granskades. Ladda om fakturan och granska den nya konteringen innan attest.','APPROVAL_STALE_CODING',409,{expectedCodingSha256:expectedCoding,currentCodingSha256:invoice.codingSha256});if(invoice.documentSha256!==expectedDocument)throw err('PDF-underlaget har ändrats sedan det granskades. Ladda om fakturan och granska det nya underlaget innan attest.','APPROVAL_STALE_DOCUMENT',409,{expectedDocumentSha256:expectedDocument,currentDocumentSha256:invoice.documentSha256});document(db,companyId,invoiceId);const check=Domain.assertApproval(invoice,actorId,invoice.coding);const now=nowIso();db.prepare(`UPDATE supplier_invoices SET status='approved',coding_sha256=?,approved_by=?,approved_at=?,updated_at=? WHERE company_id=? AND id=?`).run(check.codingHash,actorId,now,now,companyId,invoiceId);return invoiceById(db,companyId,invoiceId)}
function paymentByInvoice(db,companyId,invoiceId){return db.prepare(`SELECT id FROM supplier_payments WHERE company_id=? AND supplier_invoice_id=?`).get(companyId,invoiceId)||null}
function preparePayment(db,{companyId,invoiceId,paymentDate,amountOre,account='1930',preparedBy}){const invoice=invoiceById(db,companyId,invoiceId);if(!invoice)throw err('Leverantörsfakturan hittades inte.','INVOICE_NOT_FOUND',404);const existing=paymentByInvoice(db,companyId,invoiceId);if(existing){const payment=paymentById(db,companyId,existing.id);if(payment&&payment.amountOre===amountOre&&payment.paymentDate===text(paymentDate)&&payment.account===text(account))return payment;throw err('Det finns redan en betalning för fakturan med andra uppgifter.','PAYMENT_ALREADY_EXISTS',409)}if(invoice.status!=='approved')throw err('Fakturan måste vara attesterad innan betalningen förbereds.','INVOICE_NOT_APPROVED',409);if(!invoice.liabilityAccountingEntryId)throw err('Leverantörsskulden måste bokföras innan betalningen kan förberedas.','INVOICE_LIABILITY_NOT_POSTED',409);if(invoice.openAmountOre!==invoice.totalOre)throw err('Fakturans öppna reskontrabelopp stämmer inte med fakturabeloppet.','INVALID_OPEN_AMOUNT',409);if(amountOre!==invoice.openAmountOre)throw err('Den första versionen kräver betalning av hela det öppna fakturabeloppet.','PARTIAL_PAYMENT_NOT_SUPPORTED');if(!validDate(paymentDate))throw err('Betalningsdatumet är ogiltigt.','INVALID_PAYMENT_DATE');if(!validAccount(account))throw err('Bankkontot måste bestå av fyra siffror.','INVALID_PAYMENT_ACCOUNT');if(!invoice.bankgiro&&!invoice.plusgiro)throw err('Leverantören saknar godkända betalningsuppgifter.','SUPPLIER_PAYMENT_DETAILS_MISSING',409);const paymentId=id('spay'),now=nowIso();db.prepare(`INSERT INTO supplier_payments(id,company_id,supplier_invoice_id,payment_date,amount_ore,account,status,prepared_by,recipient_name,recipient_bankgiro,recipient_plusgiro,created_at,updated_at) VALUES(?,?,?,?,?,?,'prepared',?,?,?,?,?,?)`).run(paymentId,companyId,invoiceId,text(paymentDate),amountOre,text(account),preparedBy,invoice.supplierName,invoice.bankgiro||null,invoice.plusgiro||null,now,now);db.prepare(`UPDATE supplier_invoices SET status='payment-prepared',updated_at=? WHERE company_id=? AND id=?`).run(now,companyId,invoiceId);return paymentById(db,companyId,paymentId)}
function paymentById(db,companyId,paymentId){return db.prepare(`SELECT p.id,p.company_id AS companyId,p.supplier_invoice_id AS supplierInvoiceId,p.payment_date AS paymentDate,p.amount_ore AS amountOre,p.account,p.status,p.prepared_by AS preparedBy,p.released_by AS releasedBy,p.released_at AS releasedAt,COALESCE(p.recipient_name,s.name) AS supplierName,p.recipient_bankgiro AS bankgiro,p.recipient_plusgiro AS plusgiro,i.supplier_invoice_number AS supplierInvoiceNumber FROM supplier_payments p JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE p.company_id=? AND p.id=?`).get(companyId,paymentId)||null}
function listPayments(db,companyId,date=''){const base=`SELECT p.id,p.company_id AS companyId,p.supplier_invoice_id AS supplierInvoiceId,p.payment_date AS paymentDate,p.amount_ore AS amountOre,p.account,p.status,p.prepared_by AS preparedBy,p.released_by AS releasedBy,p.released_at AS releasedAt,s.supplier_number AS supplierNumber,COALESCE(p.recipient_name,s.name) AS supplierName,i.supplier_invoice_number AS supplierInvoiceNumber,p.recipient_bankgiro AS bankgiro,p.recipient_plusgiro AS plusgiro FROM supplier_payments p JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id`;return date?db.prepare(`${base} WHERE p.company_id=? AND p.payment_date=? ORDER BY supplierName`).all(companyId,date):db.prepare(`${base} WHERE p.company_id=? ORDER BY p.payment_date,supplierName`).all(companyId)}

module.exports=Object.freeze({initializePayables,listSuppliers,createSupplier,supplierById,supplierByNumber,createSupplierInvoice,invoiceById,listInvoices,supplierHistory,storeDocument,document,privateObjectMetadata,saveCoding,approve,preparePayment,paymentByInvoice,paymentById,listPayments,validDate,normalizeInvoiceNumber,duplicateInvoice,duplicateDocument});
