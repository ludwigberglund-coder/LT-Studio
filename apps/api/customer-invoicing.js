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
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      original_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      credit_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      UNIQUE(company_id,original_invoice_id),
      UNIQUE(company_id,credit_invoice_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS customer_invoice_credit_requests(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      original_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      credit_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,request_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_customer_invoice_documents_company ON customer_invoice_documents(company_id,created_at);
  `);
  protectAppendOnly(db,'customer_invoice_documents');
  protectAppendOnly(db,'customer_invoice_issue_requests');
  protectAppendOnly(db,'customer_invoice_credits');
  protectAppendOnly(db,'customer_invoice_credit_requests');
  require('./tenant-integrity.js').installTenantGuards(db);
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
  const entry=Accounting.entryBySource(db,companyId,'customer-invoice',invoiceId)||Accounting.entryBySource(db,companyId,'customer-credit',invoiceId);
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

function creditByOriginal(db,companyId,invoiceId){
  return db.prepare(`SELECT id,original_invoice_id AS originalInvoiceId,credit_invoice_id AS creditInvoiceId,reason,created_by AS createdBy,created_at AS createdAt
    FROM customer_invoice_credits WHERE company_id=? AND original_invoice_id=?`).get(companyId,invoiceId)||null;
}
function creditInvoice(db,{companyId,userId,invoiceId,payload}){
  const requestId=validateRequestId(payload?.requestId);
  const prior=db.prepare('SELECT original_invoice_id AS originalInvoiceId,credit_invoice_id AS creditInvoiceId FROM customer_invoice_credit_requests WHERE company_id=? AND request_id=?').get(companyId,requestId);
  if(prior){
    if(prior.originalInvoiceId!==invoiceId)throw invoiceError('Krediteringsnyckeln är redan använd för en annan faktura.','IDEMPOTENCY_CONFLICT',409);
    const credit=invoiceBundle(db,companyId,prior.creditInvoiceId);
    const original=invoiceBundle(db,companyId,prior.originalInvoiceId);
    if(!credit||!original)throw invoiceError('Tidigare krediteringsbegäran är ofullständig.','CREDIT_IDEMPOTENCY_CORRUPT',500);
    return{original:original.invoice,creditInvoice:credit.invoice,document:credit.document,documentSha256:credit.documentSha256,entry:credit.entry,duplicate:true};
  }
  const original=invoiceBundle(db,companyId,invoiceId);
  if(!original)throw invoiceError('Fakturan hittades inte i det inloggade företaget.','INVOICE_NOT_FOUND',404);
  if(!original.document||!original.entry)throw invoiceError('Fakturan saknar verifierat originalunderlag eller bokföringspost och kan inte krediteras automatiskt.','CREDIT_SOURCE_INCOMPLETE',409);
  if(original.document.documentType==='KREDITFAKTURA'||creditByOriginal(db,companyId,invoiceId))throw invoiceError('Fakturan är redan en kreditfaktura eller har redan krediterats.','INVOICE_ALREADY_CREDITED',409);
  if(original.invoice.totalOre<=0||original.invoice.remainingOre!==original.invoice.totalOre)throw invoiceError('Automatisk helkreditering kräver en helt obetald faktura. Delbetalda eller reglerade fakturor måste hanteras i ett separat rättelseflöde.','CREDIT_REQUIRES_UNPAID_INVOICE',409);
  const movements=db.prepare('SELECT COUNT(*) AS count FROM invoice_transactions WHERE company_id=? AND invoice_id=? AND approved=1 AND COALESCE(amount_ore,0)<>0').get(companyId,invoiceId);
  if(Number(movements?.count||0)!==0)throw invoiceError('Fakturan har redan ekonomiska transaktioner och kan inte helkrediteras automatiskt.','CREDIT_HAS_TRANSACTIONS',409);
  const reason=text(payload?.reason);
  if(reason.length<5||reason.length>500)throw invoiceError('Ange en tydlig krediteringsorsak på 5–500 tecken.','CREDIT_REASON_REQUIRED');
  const creditDate=text(payload?.creditDate),postingDate=text(payload?.postingDate||creditDate);
  if(!Accounting.validDate(creditDate)||!Accounting.validDate(postingDate))throw invoiceError('Kreditfakturans datum eller bokföringsdatum är ogiltigt.','INVALID_CREDIT_DATE');
  const creditNumber=nextInvoiceNumber(db,companyId);
  const src=original.document;
  const negate=value=>-Number(value||0);
  const creditDocument={
    ...src,
    schemaVersion:Math.max(Number(src.schemaVersion||0),3),
    documentType:'KREDITFAKTURA',demo:false,invoiceNumber:creditNumber,ocr:creditNumber,
    invoiceDate:creditDate,postingDate,dueDate:creditDate,paymentTermsDays:0,
    originalInvoiceNumber:original.invoice.invoiceNumber,creditReason:reason,
    lines:(src.lines||[]).map(line=>({...line,unitPriceOre:negate(line.unitPriceOre),netOre:negate(line.netOre),vatOre:negate(line.vatOre),grossOre:negate(line.grossOre)})),
    netOre:negate(src.netOre),vatOre:negate(src.vatOre),totalOre:negate(src.totalOre),roundingOre:negate(src.roundingOre),
    freightOre:negate(src.freightOre),administrationOre:negate(src.administrationOre),
    vatBreakdown:(src.vatBreakdown||[]).map(row=>({...row,netOre:negate(row.netOre),vatOre:negate(row.vatOre)})),
    warnings:[]
  };
  const credit=Db.createInvoice(db,{companyId,customerId:original.invoice.customerId,invoiceNumber:creditNumber,ocr:creditNumber,
    invoiceDate:creditDate,postingDate,dueDate:creditDate,totalOre:creditDocument.totalOre,remainingOre:0,vatOre:creditDocument.vatOre,
    status:'Kreditfaktura',paymentMethod:original.invoice.paymentMethod,paymentAccount:original.invoice.paymentAccount,invoiceAccount:'1510'});
  const reversalLines=original.entry.lines.map(line=>({account:line.account,text:`Kredit av ${original.invoice.invoiceNumber}: ${line.text||original.entry.description}`,debitOre:line.creditOre,creditOre:line.debitOre}));
  const posted=Accounting.postEntry(db,{companyId,postingDate,description:`Kreditfaktura ${creditNumber} av ${original.invoice.invoiceNumber}`.slice(0,240),
    sourceType:'customer-credit',sourceId:credit.id,createdBy:userId,series:'F',lines:reversalLines});
  const createdAt=new Date().toISOString();
  db.prepare('UPDATE invoices SET journal_number=?,updated_at=? WHERE company_id=? AND id=?').run(posted.entry.number,createdAt,companyId,credit.id);
  const documentJson=JSON.stringify(creditDocument),documentSha256=crypto.createHash('sha256').update(documentJson).digest('hex');
  db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)').run(credit.id,companyId,documentJson,documentSha256,createdAt);
  const updateOriginal=db.prepare("UPDATE invoices SET remaining_ore=0,status='Krediterad',updated_at=? WHERE company_id=? AND id=? AND remaining_ore=total_ore AND total_ore>0").run(createdAt,companyId,invoiceId);
  if(updateOriginal.changes!==1)throw invoiceError('Originalfakturan ändrades under krediteringen. Ingen kreditfaktura sparades.','CREDIT_CONFLICT',409);
  Db.addInvoiceTransaction(db,{companyId,invoiceId,transactionType:'credit',postingDate,amountOre:-original.invoice.totalOre,approved:true,account:'1510',journalNumber:posted.entry.number});
  const creditId=`credit_${crypto.randomUUID()}`;
  db.prepare('INSERT INTO customer_invoice_credits(id,company_id,original_invoice_id,credit_invoice_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(creditId,companyId,invoiceId,credit.id,reason,userId,createdAt);
  db.prepare('INSERT INTO customer_invoice_credit_requests(company_id,request_id,original_invoice_id,credit_invoice_id,created_at) VALUES(?,?,?,?,?)').run(companyId,requestId,invoiceId,credit.id,createdAt);
  Db.appendAudit(db,{companyId,userId,action:'CUSTOMER_INVOICE_CREDITED',entityType:'invoice',entityId:invoiceId,details:{creditInvoiceId:credit.id,creditInvoiceNumber:creditNumber,journalNumber:posted.entry.number,reason,originalTotalOre:original.invoice.totalOre,vatOre:original.invoice.vatOre,documentSha256}});
  const bundle=invoiceBundle(db,companyId,credit.id);
  return{original:Db.invoiceById(db,companyId,invoiceId),creditInvoice:bundle.invoice,document:bundle.document,documentSha256:bundle.documentSha256,entry:bundle.entry,duplicate:false};
}

module.exports=Object.freeze({initializeCustomerInvoicing,customerByNumber,nextInvoiceNumber,profileStatus,resolvedProfile,listCustomerInvoices,documentForInvoice,invoiceBundle,issueInvoice,creditInvoice,creditByOriginal,validateRequestId});
