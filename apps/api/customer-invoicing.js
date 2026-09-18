'use strict';

const crypto=require('node:crypto');
const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Invoice=require('../../packages/invoicing/invoice.js');
const InvoiceSettings=require('./company-invoice-settings.js');
const {protectAppendOnly}=require('./history-guards.js');

function invoiceError(message,code='CUSTOMER_INVOICE_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function initializeCustomerInvoicing(db){
  Accounting.initializeAccountingStore(db);
  InvoiceSettings.initializeInvoiceSettings(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_invoice_documents(
      invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      document_json TEXT NOT NULL,
      document_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(company_id,invoice_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS customer_invoice_issue_requests(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,request_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS customer_invoice_credits(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      original_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      credit_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,request_id),
      UNIQUE(company_id,original_invoice_id),
      UNIQUE(company_id,credit_invoice_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_customer_invoice_documents_company ON customer_invoice_documents(company_id,created_at);
  `);
  protectAppendOnly(db,'customer_invoice_documents');
  protectAppendOnly(db,'customer_invoice_issue_requests');
  protectAppendOnly(db,'customer_invoice_credits');
  // Settlement status may change; the issued invoice's financial identity may not.
  const fields=['customer_id','invoice_number','ocr','invoice_date','posting_date','due_date','total_ore','vat_ore','invoice_account','payment_account','payment_method','created_at'];
  db.exec(`CREATE TRIGGER IF NOT EXISTS history_issued_invoice_core BEFORE UPDATE ON invoices
    WHEN EXISTS(SELECT 1 FROM customer_invoice_documents WHERE invoice_id=OLD.id)
      AND (${fields.map(field=>`NEW.${field} IS NOT OLD.${field}`).join(' OR ')})
    BEGIN SELECT RAISE(ABORT,'ISSUED_INVOICE_IMMUTABLE'); END;`);
}
function customerByNumber(db,companyId,customerNumber){return Db.listCustomers(db,companyId).find(row=>row.customerNumber===text(customerNumber))||null}
function nextInvoiceNumber(db,companyId){
  const row=db.prepare(`SELECT MAX(CAST(invoice_number AS INTEGER)) AS maxNumber FROM invoices
    WHERE company_id=? AND length(invoice_number)=6 AND invoice_number NOT GLOB '*[^0-9]*'`).get(companyId);
  const next=Math.max(Number(row?.maxNumber||0),310000)+1;
  if(next>999999)throw invoiceError('Fakturanummerserien är full.','INVOICE_NUMBER_SERIES_FULL',409);
  return String(next);
}
function profileStatus(company,profile={}){
  const seller={
    name:text(profile.legalName||company?.legalName),
    address:text(profile.address?.full||profile.address),
    orgNumber:text(company?.orgNumber||profile.orgNumber),
    vatNumber:text(profile.vatNumber),
    phone:text(profile.contact?.phone||profile.phone),
    email:text(profile.contact?.email||profile.email),
    website:text(profile.website),
    bankgiro:text(profile.invoice?.bankgiro||profile.bankgiro),
    taxStatus:text(profile.invoice?.taxStatus||profile.taxStatus)
  };
  const blockers=[];
  if(!company)blockers.push('Företaget hittades inte.');
  if(profile.orgNumber&&company&&text(profile.orgNumber)!==text(company.orgNumber))blockers.push('Företagsprofilens organisationsnummer matchar inte det inloggade företaget.');
  for(const [key,label] of [['name','juridiskt namn'],['address','adress'],['orgNumber','organisationsnummer'],['vatNumber','VAT-nummer'],['bankgiro','bankgiro']])if(!seller[key])blockers.push(`Företagets ${label} saknas.`);
  if(/^DEMO\b/i.test(seller.bankgiro)||/EJ-BETALNING/i.test(seller.bankgiro))blockers.push('Bankgiro är fortfarande markerat som demo och måste verifieras före bokföring.');
  if(/\bdemo\b/i.test(seller.taxStatus)||/verifiera/i.test(seller.taxStatus))blockers.push('Skattestatusen är fortfarande markerad för verifiering.');
  return{
    ready:blockers.length===0,
    blocker:blockers[0]||'',
    seller,
    company:{
      legalName:seller.name,displayName:text(profile.displayName||company?.displayName||seller.name),orgNumber:seller.orgNumber,vatNumber:seller.vatNumber,
      address:{full:seller.address},contact:{phone:seller.phone,email:seller.email},website:seller.website,
      invoice:{bankgiro:seller.bankgiro,taxStatus:seller.taxStatus}
    }
  };
}
function listCustomerInvoices(db,companyId){
  return db.prepare(`SELECT i.id,i.company_id AS companyId,i.customer_id AS customerId,i.invoice_number AS invoiceNumber,i.ocr,
    i.invoice_date AS invoiceDate,i.posting_date AS postingDate,i.due_date AS dueDate,i.total_ore AS totalOre,i.remaining_ore AS remainingOre,
    i.vat_ore AS vatOre,i.status,i.payment_method AS paymentMethod,i.payment_account AS paymentAccount,i.invoice_account AS invoiceAccount,
    i.batch_number AS batchNumber,i.journal_number AS journalNumber,i.created_at AS createdAt,i.updated_at AS updatedAt,
    c.customer_number AS customerNumber,c.name AS customerName
    FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id
    WHERE i.company_id=? ORDER BY i.invoice_date DESC,i.invoice_number DESC`).all(companyId);
}
function documentForInvoice(db,companyId,invoiceId){
  const row=db.prepare('SELECT document_json AS documentJson,document_sha256 AS documentSha256,created_at AS createdAt FROM customer_invoice_documents WHERE company_id=? AND invoice_id=?').get(companyId,invoiceId);
  if(!row)return null;
  if(crypto.createHash('sha256').update(row.documentJson).digest('hex')!==row.documentSha256)throw invoiceError('Det sparade fakturaunderlagets digitala fingeravtryck st\u00e4mmer inte. Visningen har stoppats.','INVOICE_DOCUMENT_INTEGRITY_ERROR',409);
  let document;try{document=JSON.parse(row.documentJson)}catch{throw invoiceError('Det sparade fakturaunderlaget kan inte läsas.','INVOICE_DOCUMENT_CORRUPT',500)}
  return{document,documentSha256:row.documentSha256,createdAt:row.createdAt};
}
function invoiceBundle(db,companyId,invoiceId){
  const invoice=Db.invoiceById(db,companyId,invoiceId);
  if(!invoice)return null;
  const stored=documentForInvoice(db,companyId,invoiceId);
  const entry=Accounting.entryBySource(db,companyId,'customer-invoice',invoiceId)||Accounting.entryBySource(db,companyId,'customer-credit-note',invoiceId);
  return{invoice,document:stored?.document||null,documentSha256:stored?.documentSha256||null,entry};
}
function validateRequestId(value){const id=text(value);if(!/^[A-Za-z0-9_-]{16,100}$/.test(id))throw invoiceError('En giltig idempotensnyckel krävs för fakturautställning.','INVALID_INVOICE_REQUEST_ID',422);return id}
function resolvedProfile(db,companyId,publicProfile={}){return InvoiceSettings.privateProfile(db,companyId,publicProfile)}
function issueInvoice(db,{companyId,userId,payload,profile}){
  const requestId=validateRequestId(payload?.requestId);
  const prior=db.prepare('SELECT invoice_id AS invoiceId FROM customer_invoice_issue_requests WHERE company_id=? AND request_id=?').get(companyId,requestId);
  if(prior){const existing=invoiceBundle(db,companyId,prior.invoiceId);if(!existing)throw invoiceError('Tidigare fakturabegäran saknar faktura.','INVOICE_IDEMPOTENCY_CORRUPT',500);return{...existing,duplicate:true}}
  const company=Db.companyById(db,companyId);
  const resolved=resolvedProfile(db,companyId,profile);
  if(!resolved.configured)throw invoiceError('Privata fakturainställningar saknas. Bankgiro och skattestatus måste läggas in i den privata databasen före bokföring.','INVOICE_PRIVATE_SETTINGS_MISSING',409);
  const readiness=profileStatus(company,resolved.profile);
  if(!readiness.ready)throw invoiceError(readiness.blocker,'INVOICE_PROFILE_NOT_READY',409);
  const customer=customerByNumber(db,companyId,payload?.customerNumber);
  if(!customer)throw invoiceError('Kunden finns inte i det inloggade företagets kundregister.','CUSTOMER_NOT_FOUND',404);
  const invoiceNumber=nextInvoiceNumber(db,companyId);
  let document;
  try{
    document=Invoice.prepare({
      customerNumber:customer.customerNumber,
      buyer:{name:customer.name,address:customer.address?.full||'',orgNumber:customer.orgNumber||'',email:customer.email||''},
      seller:readiness.seller,
      invoiceDate:payload?.invoiceDate,postingDate:payload?.postingDate,dueDate:payload?.dueDate,paymentTermsDays:payload?.paymentTermsDays,
      currency:'SEK',ourReference:payload?.ourReference,yourReference:payload?.yourReference,notes:payload?.notes,lines:payload?.lines
    },{invoiceNumber,accounts:[],requireVatTreatment:true});
  }catch(error){throw invoiceError(error.message,'INVALID_CUSTOMER_INVOICE',422)}
  document.demo=false;
  const invoice=Db.createInvoice(db,{companyId,customerId:customer.id,invoiceNumber,ocr:invoiceNumber,invoiceDate:document.invoiceDate,postingDate:document.postingDate,dueDate:document.dueDate,totalOre:document.totalOre,remainingOre:document.totalOre,vatOre:document.vatOre,status:'Bokförd',paymentMethod:'Bankgiro',paymentAccount:readiness.seller.bankgiro,invoiceAccount:'1510'});
  const posted=Accounting.postEntry(db,{companyId,postingDate:document.postingDate,description:`Kundfaktura ${invoiceNumber} · ${customer.name}`.slice(0,240),sourceType:'customer-invoice',sourceId:invoice.id,createdBy:userId,series:'F',lines:Invoice.journalLines(document)});
  db.prepare('UPDATE invoices SET journal_number=?,updated_at=? WHERE company_id=? AND id=?').run(posted.entry.number,new Date().toISOString(),companyId,invoice.id);
  const documentJson=JSON.stringify(document),documentSha256=crypto.createHash('sha256').update(documentJson).digest('hex'),createdAt=new Date().toISOString();
  db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)').run(invoice.id,companyId,documentJson,documentSha256,createdAt);
  db.prepare('INSERT INTO customer_invoice_issue_requests(company_id,request_id,invoice_id,created_at) VALUES(?,?,?,?)').run(companyId,requestId,invoice.id,createdAt);
  Db.appendAudit(db,{companyId,userId,action:'CUSTOMER_INVOICE_ISSUED',entityType:'invoice',entityId:invoice.id,details:{invoiceNumber,journalNumber:posted.entry.number,customerNumber:customer.customerNumber,totalOre:document.totalOre,vatOre:document.vatOre,documentSha256}});
  return{...invoiceBundle(db,companyId,invoice.id),duplicate:false};
}

function assertCreditDate(value){
  const date=text(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw invoiceError('Kreditdatum måste anges som ÅÅÅÅ-MM-DD.','INVALID_CREDIT_DATE',422);
  const parsed=new Date(date+'T00:00:00Z');
  if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date)throw invoiceError('Kreditdatum är inte ett giltigt kalenderdatum.','INVALID_CREDIT_DATE',422);
  return date;
}
function creditDocumentFrom(original,invoiceNumber,creditDate,reason){
  const document=structuredClone(original);
  const negate=value=>Number.isSafeInteger(Number(value))?-Number(value):value;
  document.schemaVersion=Math.max(Number(document.schemaVersion||0),3);
  document.documentType='KREDITFAKTURA';
  document.invoiceNumber=invoiceNumber;
  document.ocr=invoiceNumber;
  document.invoiceDate=creditDate;
  document.postingDate=creditDate;
  document.dueDate=creditDate;
  document.paymentTermsDays=0;
  document.creditOfInvoiceNumber=String(original.invoiceNumber||'');
  document.creditReason=reason;
  document.lines=(document.lines||[]).map(row=>({...row,unitPriceOre:negate(row.unitPriceOre),netOre:negate(row.netOre),vatOre:negate(row.vatOre),grossOre:negate(row.grossOre)}));
  for(const key of ['netOre','vatOre','totalOre','roundingOre','freightOre','administrationOre'])document[key]=negate(document[key]);
  document.vatBreakdown=(document.vatBreakdown||[]).map(row=>({...row,netOre:negate(row.netOre),vatOre:negate(row.vatOre)}));
  document.notes=[text(original.notes),`Krediterar faktura ${original.invoiceNumber}. ${reason}`].filter(Boolean).join('\n');
  document.demo=false;
  return document;
}
function creditUnpaidInvoice(db,{companyId,userId,invoiceId,payload}){
  const requestId=validateRequestId(payload?.requestId);
  const prior=db.prepare('SELECT credit_invoice_id AS creditInvoiceId FROM customer_invoice_credits WHERE company_id=? AND request_id=?').get(companyId,requestId);
  if(prior){const existing=invoiceBundle(db,companyId,prior.creditInvoiceId);if(!existing)throw invoiceError('Tidigare krediteringsbegäran saknar kreditfaktura.','CREDIT_IDEMPOTENCY_CORRUPT',500);return{...existing,duplicate:true}}
  const original=Db.invoiceById(db,companyId,invoiceId);
  if(!original)throw invoiceError('Fakturan hittades inte i det inloggade företaget.','INVOICE_NOT_FOUND',404);
  if(original.totalOre<=0)throw invoiceError('En kreditfaktura kan inte krediteras med detta flöde.','CREDIT_SOURCE_INVALID',409);
  const existingCredit=db.prepare('SELECT credit_invoice_id AS creditInvoiceId FROM customer_invoice_credits WHERE company_id=? AND original_invoice_id=?').get(companyId,invoiceId);
  if(existingCredit)throw invoiceError('Fakturan är redan krediterad.','INVOICE_ALREADY_CREDITED',409);
  const transactions=Db.transactionsForInvoice(db,companyId,invoiceId).filter(row=>row.approved!==false);
  if(original.remainingOre!==original.totalOre||transactions.length)throw invoiceError('Endast en helt obetald faktura utan registrerade transaktioner kan helkrediteras i denna pilotversion.','CREDIT_REQUIRES_UNPAID_INVOICE',409);
  const reason=text(payload?.reason);
  if(reason.length<5||reason.length>500)throw invoiceError('Ange en tydlig orsak på 5–500 tecken.','CREDIT_REASON_REQUIRED',422);
  const creditDate=assertCreditDate(payload?.creditDate);
  const stored=documentForInvoice(db,companyId,invoiceId);
  if(!stored)throw invoiceError('Fakturans arkiverade originalunderlag saknas. Krediteringen stoppades.','INVOICE_DOCUMENT_REQUIRED',409);
  const originalEntry=Accounting.entryBySource(db,companyId,'customer-invoice',invoiceId);
  if(!originalEntry)throw invoiceError('Fakturans ursprungsverifikation saknas. Krediteringen stoppades.','INVOICE_ACCOUNTING_ENTRY_REQUIRED',409);
  const receivableLine=originalEntry.lines.find(line=>line.account==='1510');
  if(!receivableLine||receivableLine.debitOre-originalEntry.lines.filter(line=>line.account==='1510').reduce((sum,line)=>sum+line.creditOre,0)!==original.totalOre){
    throw invoiceError('Fakturans kundfordringspost kan inte verifieras. Krediteringen stoppades.','INVOICE_ACCOUNTING_MISMATCH',409);
  }
  const invoiceNumber=nextInvoiceNumber(db,companyId);
  const document=creditDocumentFrom(stored.document,invoiceNumber,creditDate,reason);
  const creditInvoice=Db.createInvoice(db,{companyId,customerId:original.customerId,invoiceNumber,ocr:invoiceNumber,invoiceDate:creditDate,postingDate:creditDate,dueDate:creditDate,totalOre:-original.totalOre,remainingOre:0,vatOre:-original.vatOre,status:'Kreditfaktura',paymentMethod:original.paymentMethod,paymentAccount:original.paymentAccount,invoiceAccount:'1510'});
  const posted=Accounting.postEntry(db,{companyId,postingDate:creditDate,description:`Kreditfaktura ${invoiceNumber} av ${original.invoiceNumber}`.slice(0,240),sourceType:'customer-credit-note',sourceId:creditInvoice.id,createdBy:userId,series:'F',lines:originalEntry.lines.map(line=>({account:line.account,text:`Kreditering av ${original.invoiceNumber}: ${line.text||originalEntry.description}`,debitOre:line.creditOre,creditOre:line.debitOre}))});
  const createdAt=new Date().toISOString();
  db.prepare('UPDATE invoices SET remaining_ore=0,status=?,updated_at=? WHERE company_id=? AND id=?').run('Krediterad',createdAt,companyId,original.id);
  db.prepare('UPDATE invoices SET journal_number=?,updated_at=? WHERE company_id=? AND id=?').run(posted.entry.number,createdAt,companyId,creditInvoice.id);
  const documentJson=JSON.stringify(document),documentSha256=crypto.createHash('sha256').update(documentJson).digest('hex');
  db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)').run(creditInvoice.id,companyId,documentJson,documentSha256,createdAt);
  db.prepare('INSERT INTO customer_invoice_credits(company_id,request_id,original_invoice_id,credit_invoice_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(companyId,requestId,original.id,creditInvoice.id,reason,userId,createdAt);
  Db.appendAudit(db,{companyId,userId,action:'CUSTOMER_INVOICE_CREDITED',entityType:'invoice',entityId:original.id,details:{originalInvoiceNumber:original.invoiceNumber,creditInvoiceId:creditInvoice.id,creditInvoiceNumber:invoiceNumber,journalNumber:posted.entry.number,reason,documentSha256}});
  return{...invoiceBundle(db,companyId,creditInvoice.id),duplicate:false,original:Db.invoiceById(db,companyId,original.id)};
}

module.exports=Object.freeze({initializeCustomerInvoicing,customerByNumber,nextInvoiceNumber,profileStatus,resolvedProfile,listCustomerInvoices,documentForInvoice,invoiceBundle,issueInvoice,creditUnpaidInvoice,creditDocumentFrom,validateRequestId});
