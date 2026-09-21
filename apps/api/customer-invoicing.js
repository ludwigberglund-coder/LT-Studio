'use strict';

const crypto=require('node:crypto');
const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Invoice=require('../../packages/invoicing/invoice.js');
const InvoiceSettings=require('./company-invoice-settings.js');
const Pdf=require('../../packages/invoicing/pdf.js');
const PrivateObject=require('./private-object-contract.js');
const StoreFactory=require('./private-object-store-factory.js');
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
    CREATE TABLE IF NOT EXISTS customer_invoice_pdf_archives(
      invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK(mime_type='application/pdf'),
      pdf_blob BLOB NOT NULL,
      pdf_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
      created_at TEXT NOT NULL,
      UNIQUE(company_id,invoice_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS customer_invoice_number_reservations(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('invoice','credit')),
      invoice_number TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      source_invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
      issued_invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('reserved','issued')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(company_id,request_id),
      UNIQUE(company_id,invoice_number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS customer_invoice_drafts(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      draft_json TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(company_id,user_id)
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
    CREATE INDEX IF NOT EXISTS idx_customer_invoice_pdf_archives_company ON customer_invoice_pdf_archives(company_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_customer_invoice_reservations_status ON customer_invoice_number_reservations(company_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_customer_invoice_drafts_updated ON customer_invoice_drafts(company_id,updated_at);
    CREATE TRIGGER IF NOT EXISTS tenant_customer_invoice_credits_insert BEFORE INSERT ON customer_invoice_credits
      WHEN NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.original_invoice_id AND company_id=NEW.company_id)
        OR NOT EXISTS(SELECT 1 FROM invoices WHERE id=NEW.credit_invoice_id AND company_id=NEW.company_id)
      BEGIN SELECT RAISE(ABORT,'TENANT_RELATION_VIOLATION'); END;
  `);
  protectAppendOnly(db,'customer_invoice_documents');
  protectAppendOnly(db,'customer_invoice_pdf_archives');
  protectAppendOnly(db,'customer_invoice_issue_requests');
  protectAppendOnly(db,'customer_invoice_credits');
  db.exec(`CREATE TRIGGER IF NOT EXISTS history_invoice_reservation_identity BEFORE UPDATE ON customer_invoice_number_reservations
    WHEN NEW.company_id IS NOT OLD.company_id OR NEW.request_id IS NOT OLD.request_id OR NEW.purpose IS NOT OLD.purpose
      OR NEW.invoice_number IS NOT OLD.invoice_number OR NEW.payload_sha256 IS NOT OLD.payload_sha256
      OR NEW.source_invoice_id IS NOT OLD.source_invoice_id OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT,'INVOICE_RESERVATION_IMMUTABLE'); END;`);
  // Settlement status may change; the issued invoice's financial identity may not.
  const fields=['customer_id','invoice_number','ocr','invoice_date','posting_date','due_date','total_ore','vat_ore','invoice_account','payment_account','payment_method','created_at'];
  db.exec(`CREATE TRIGGER IF NOT EXISTS history_issued_invoice_core BEFORE UPDATE ON invoices
    WHEN EXISTS(SELECT 1 FROM customer_invoice_documents WHERE invoice_id=OLD.id)
      AND (${fields.map(field=>`NEW.${field} IS NOT OLD.${field}`).join(' OR ')})
    BEGIN SELECT RAISE(ABORT,'ISSUED_INVOICE_IMMUTABLE'); END;`);
}
function customerByNumber(db,companyId,customerNumber){return Db.listCustomers(db,companyId).find(row=>row.customerNumber===text(customerNumber))||null}
function nextInvoiceNumber(db,companyId){
  const row=db.prepare(`SELECT MAX(number) AS maxNumber FROM (
      SELECT CAST(invoice_number AS INTEGER) AS number FROM invoices
        WHERE company_id=? AND length(invoice_number)=6 AND invoice_number NOT GLOB '*[^0-9]*'
      UNION ALL
      SELECT CAST(invoice_number AS INTEGER) AS number FROM customer_invoice_number_reservations
        WHERE company_id=? AND length(invoice_number)=6 AND invoice_number NOT GLOB '*[^0-9]*'
    )`).get(companyId,companyId);
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
  for(const [key,label] of [['name','juridiskt namn'],['address','adress'],['orgNumber','organisationsnummer'],['vatNumber','VAT-nummer'],['bankgiro','bankgiro'],['taxStatus','skattestatus']])if(!seller[key])blockers.push(`Företagets ${label} saknas.`);
  if(/^(?:EJ\s+ANGIVET|ADRESS\s+EJ\s+ANGIVEN)$/i.test(seller.address))blockers.push('Företagets adress är fortfarande en platshållare och måste verifieras före fakturering.');
  if(seller.vatNumber&&!InvoiceSettings.vatNumberMatchesOrgNumber(seller.vatNumber,seller.orgNumber))blockers.push('Företagets VAT-nummer är ogiltigt eller matchar inte organisationsnumret.');
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
  const pdfArchive=pdfArchiveMetadata(db,companyId,invoiceId);
  const entry=Accounting.entryBySource(db,companyId,'customer-invoice',invoiceId)||Accounting.entryBySource(db,companyId,'customer-credit-note',invoiceId);
  return{invoice,document:stored?.document||null,documentSha256:stored?.documentSha256||null,pdfArchive,entry};
}
function validateRequestId(value){const id=text(value);if(!/^[A-Za-z0-9_-]{16,100}$/.test(id))throw invoiceError('En giltig idempotensnyckel krävs för fakturautställning.','INVALID_INVOICE_REQUEST_ID',422);return id}

function stableJson(value){
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function requestDigest(purpose,payload,sourceInvoiceId=''){
  return crypto.createHash('sha256').update(stableJson({purpose,sourceInvoiceId,payload})).digest('hex');
}
function reservationByRequest(db,companyId,requestId){return db.prepare(`SELECT company_id AS companyId,request_id AS requestId,purpose,invoice_number AS invoiceNumber,payload_sha256 AS payloadSha256,source_invoice_id AS sourceInvoiceId,issued_invoice_id AS issuedInvoiceId,status,created_at AS createdAt,updated_at AS updatedAt FROM customer_invoice_number_reservations WHERE company_id=? AND request_id=?`).get(companyId,requestId)||null}
function assertReservationMatch(row,{purpose,payloadSha256,sourceInvoiceId=''}){if(!row)return;if(row.purpose!==purpose||row.payloadSha256!==payloadSha256||String(row.sourceInvoiceId||'')!==String(sourceInvoiceId||''))throw invoiceError('Idempotensnyckeln är redan använd med annat fakturainnehåll.','INVOICE_IDEMPOTENCY_CONFLICT',409)}
function reserveInvoiceNumber(db,{companyId,requestId,purpose,payloadSha256,sourceInvoiceId=null}){
  const existing=reservationByRequest(db,companyId,requestId);
  if(existing){assertReservationMatch(existing,{purpose,payloadSha256,sourceInvoiceId});return existing}
  const invoiceNumber=nextInvoiceNumber(db,companyId),now=new Date().toISOString();
  db.prepare(`INSERT INTO customer_invoice_number_reservations(company_id,request_id,purpose,invoice_number,payload_sha256,source_invoice_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'reserved',?,?)`).run(companyId,requestId,purpose,invoiceNumber,payloadSha256,sourceInvoiceId||null,now,now);
  return reservationByRequest(db,companyId,requestId);
}
function markReservationIssued(db,{companyId,requestId,invoiceId}){const now=new Date().toISOString(),result=db.prepare(`UPDATE customer_invoice_number_reservations SET issued_invoice_id=?,status='issued',updated_at=? WHERE company_id=? AND request_id=? AND status='reserved'`).run(invoiceId,now,companyId,requestId);if(Number(result.changes||0)!==1)throw invoiceError('Fakturanumrets reservation kunde inte slutföras.','INVOICE_RESERVATION_STATE_ERROR',409)}
function pdfArchiveMetadata(db,companyId,invoiceId){return db.prepare(`SELECT file_name AS fileName,mime_type AS mimeType,pdf_sha256 AS pdfSha256,size_bytes AS sizeBytes,created_at AS createdAt FROM customer_invoice_pdf_archives WHERE company_id=? AND invoice_id=?`).get(companyId,invoiceId)||null}
function pdfArchivePrivateObjectMetadata(db,companyId,invoiceId){
  const row=pdfArchiveMetadata(db,companyId,invoiceId);
  if(!row)return null;
  return PrivateObject.createPrivateObjectMetadata({
    companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF,
    objectId:invoiceId,
    mimeType:row.mimeType,
    sizeBytes:row.sizeBytes,
    sha256:row.pdfSha256,
    createdAt:row.createdAt
  });
}
function pdfArchiveForInvoice(db,companyId,invoiceId){
  const row=pdfArchiveMetadata(db,companyId,invoiceId);
  if(!row)throw invoiceError('Den exakt arkiverade PDF-fakturan saknas.','INVOICE_PDF_ARCHIVE_NOT_FOUND',404);
  const store=StoreFactory.createPrivateObjectStore({
    db,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF
  });
  const bytes=Buffer.from(store.get({
    companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF,
    objectId:invoiceId
  })||[]);
  if(bytes.length!==row.sizeBytes||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||crypto.createHash('sha256').update(bytes).digest('hex')!==row.pdfSha256)throw invoiceError('Den arkiverade PDF-fakturans digitala fingeravtryck stämmer inte. Åtkomsten har stoppats.','INVOICE_PDF_ARCHIVE_INTEGRITY_ERROR',409);
  return{...row,bytes};
}
function storePdfArchive(db,{companyId,invoiceId,invoiceNumber,documentType='FAKTURA',pdfBytes}){
  const bytes=Buffer.from(pdfBytes||[]);
  if(!bytes.length||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw invoiceError('PDF-arkivet innehåller inte en giltig PDF-fil.','INVOICE_PDF_ARCHIVE_INVALID',500);
  if(bytes.length>15*1024*1024)throw invoiceError('Den utfärdade PDF-fakturan är för stor för arkivet.','INVOICE_PDF_ARCHIVE_TOO_LARGE',500);
  const pdfSha256=crypto.createHash('sha256').update(bytes).digest('hex'),createdAt=new Date().toISOString();
  const prefix=documentType==='KREDITFAKTURA'?'Kreditfaktura':'Faktura',expectedFileName=`${prefix}-${String(invoiceNumber).replace(/[^0-9A-Za-z_-]/g,'_')}.pdf`;
  const metadata=PrivateObject.createPrivateObjectMetadata({
    companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF,
    objectId:invoiceId,
    mimeType:'application/pdf',
    sizeBytes:bytes.length,
    sha256:pdfSha256,
    createdAt
  });
  const store=StoreFactory.createPrivateObjectStore({
    db,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.CUSTOMER_INVOICE_PDF
  });
  if(!store.put({metadata,bytes}))throw invoiceError('PDF-arkivet kunde inte lagras.','INVOICE_PDF_ARCHIVE_STORE_FAILED',500);
  const archived=pdfArchiveMetadata(db,companyId,invoiceId);
  if(!archived||archived.fileName!==expectedFileName)throw invoiceError('PDF-arkivets metadata stämmer inte med fakturaunderlaget.','INVOICE_PDF_ARCHIVE_STORE_FAILED',500);
  return archived;
}
async function renderInvoicePdf(document){try{return Buffer.from(await Pdf.createInvoicePdf(document))}catch(error){throw invoiceError(`PDF-fakturan kunde inte skapas: ${error.message}`,'INVOICE_PDF_GENERATION_FAILED',500)}}
function parseDraftRow(row){
  if(!row)return null;
  let draft;
  try{draft=JSON.parse(row.draftJson)}catch{throw invoiceError('Det sparade fakturautkastet kan inte läsas.','INVOICE_DRAFT_CORRUPT',500)}
  if(!draft||typeof draft!=='object'||Array.isArray(draft))throw invoiceError('Det sparade fakturautkastet har ogiltigt format.','INVOICE_DRAFT_CORRUPT',500);
  return{draft,requestId:row.requestId,createdAt:row.createdAt,updatedAt:row.updatedAt};
}
function canonicalDraftBuyer(customer){
  return customer?{name:customer.name||'',address:customer.address?.full||'',orgNumber:customer.orgNumber||'',email:customer.email||''}:{name:'',address:'',orgNumber:'',email:''};
}
function canonicalizeDraftCustomer(db,companyId,draft,{requireExisting=false}={}){
  const value=structuredClone(draft),number=text(value.customerNumber);
  if(!number){value.customerNumber='';value.buyer=canonicalDraftBuyer(null);return value}
  const customer=customerByNumber(db,companyId,number);
  if(!customer){
    if(requireExisting)throw invoiceError('Kunden finns inte i det inloggade företagets kundregister.','CUSTOMER_NOT_FOUND',404);
    value.buyer=canonicalDraftBuyer(null);
    return value;
  }
  value.customerNumber=customer.customerNumber;
  value.buyer=canonicalDraftBuyer(customer);
  return value;
}
function getCustomerInvoiceDraft(db,companyId,userId){
  const row=db.prepare('SELECT draft_json AS draftJson,request_id AS requestId,created_at AS createdAt,updated_at AS updatedAt FROM customer_invoice_drafts WHERE company_id=? AND user_id=?').get(companyId,userId);
  const record=parseDraftRow(row);
  if(record)record.draft=canonicalizeDraftCustomer(db,companyId,record.draft);
  return record;
}
function saveCustomerInvoiceDraft(db,{companyId,userId,payload}){
  const draft=payload?.draft;
  if(!draft||typeof draft!=='object'||Array.isArray(draft))throw invoiceError('Fakturautkastet måste vara ett objekt.','INVALID_INVOICE_DRAFT',422);
  const requestId=validateRequestId(payload?.requestId);
  const rawJson=JSON.stringify(draft);
  if(Buffer.byteLength(rawJson,'utf8')>128*1024)throw invoiceError('Fakturautkastet är för stort för att sparas.','INVOICE_DRAFT_TOO_LARGE',413);
  const normalizedDraft=canonicalizeDraftCustomer(db,companyId,draft,{requireExisting:Boolean(text(draft.customerNumber))});
  const draftJson=JSON.stringify(normalizedDraft),now=new Date().toISOString();
  db.prepare(`INSERT INTO customer_invoice_drafts(company_id,user_id,draft_json,request_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(company_id,user_id) DO UPDATE SET draft_json=excluded.draft_json,request_id=excluded.request_id,updated_at=excluded.updated_at`)
    .run(companyId,userId,draftJson,requestId,now,now);
  return getCustomerInvoiceDraft(db,companyId,userId);
}
function clearCustomerInvoiceDraft(db,{companyId,userId,requestId=null}){
  const result=requestId
    ? db.prepare('DELETE FROM customer_invoice_drafts WHERE company_id=? AND user_id=? AND request_id=?').run(companyId,userId,requestId)
    : db.prepare('DELETE FROM customer_invoice_drafts WHERE company_id=? AND user_id=?').run(companyId,userId);
  return Number(result.changes||0)>0;
}
function resolvedProfile(db,companyId,publicProfile={}){return InvoiceSettings.privateProfile(db,companyId,publicProfile)}
function preparedCustomerInvoiceDocument(db,{companyId,payload,profile,invoiceNumber}){
  const company=Db.companyById(db,companyId),resolved=resolvedProfile(db,companyId,profile);
  if(!resolved.configured)throw invoiceError('Privata fakturainställningar saknas. Bankgiro och skattestatus måste läggas in i den privata databasen före bokföring.','INVOICE_PRIVATE_SETTINGS_MISSING',409);
  const readiness=profileStatus(company,resolved.profile);
  if(!readiness.ready)throw invoiceError(readiness.blocker,'INVOICE_PROFILE_NOT_READY',409);
  const customer=customerByNumber(db,companyId,payload?.customerNumber);
  if(!customer)throw invoiceError('Kunden finns inte i det inloggade företagets kundregister.','CUSTOMER_NOT_FOUND',404);
  let document;
  try{document=Invoice.prepare({customerNumber:customer.customerNumber,buyer:{name:customer.name,address:customer.address?.full||'',orgNumber:customer.orgNumber||'',email:customer.email||''},seller:readiness.seller,invoiceDate:payload?.invoiceDate,postingDate:payload?.postingDate,dueDate:payload?.dueDate,paymentTermsDays:payload?.paymentTermsDays,currency:'SEK',ourReference:payload?.ourReference,yourReference:payload?.yourReference,notes:payload?.notes,lines:payload?.lines},{invoiceNumber,accounts:[],requireVatTreatment:true})}catch(error){throw invoiceError(error.message,'INVALID_CUSTOMER_INVOICE',422)}
  document.demo=false;
  const periodRow=db.prepare('SELECT status FROM accounting_periods WHERE company_id=? AND period=?').get(companyId,String(document.postingDate||'').slice(0,7));
  if(periodRow?.status==='locked')throw invoiceError(`Bokföringsperioden ${String(document.postingDate).slice(0,7)} är låst.`,'PERIOD_LOCKED',409);
  return{customer,readiness,document};
}
function prepareInvoiceIssuance(db,{companyId,userId,payload,profile}){
  const requestId=validateRequestId(payload?.requestId);
  const prior=db.prepare('SELECT invoice_id AS invoiceId FROM customer_invoice_issue_requests WHERE company_id=? AND request_id=?').get(companyId,requestId);
  if(prior){const existing=invoiceBundle(db,companyId,prior.invoiceId);if(!existing)throw invoiceError('Tidigare fakturabegäran saknar faktura.','INVOICE_IDEMPOTENCY_CORRUPT',500);if(!existing.pdfArchive)throw invoiceError('Tidigare fakturabegäran saknar exakt PDF-arkiv.','INVOICE_PDF_ARCHIVE_NOT_FOUND',409);const reservation=reservationByRequest(db,companyId,requestId);if(reservation)assertReservationMatch(reservation,{purpose:'invoice',payloadSha256:requestDigest('invoice',{payload,document:existing.document})});return{duplicate:true,result:{...existing,duplicate:true}}}
  let reservation=reservationByRequest(db,companyId,requestId);
  const invoiceNumber=reservation?.invoiceNumber||nextInvoiceNumber(db,companyId);
  const prepared=preparedCustomerInvoiceDocument(db,{companyId,payload,profile,invoiceNumber});
  const payloadSha256=requestDigest('invoice',{payload,document:prepared.document});
  if(reservation)assertReservationMatch(reservation,{purpose:'invoice',payloadSha256});else reservation=reserveInvoiceNumber(db,{companyId,requestId,purpose:'invoice',payloadSha256});
  if(reservation.invoiceNumber!==invoiceNumber)throw invoiceError('Fakturanummerreservationen ändrades under förberedelsen.','INVOICE_RESERVATION_STATE_ERROR',409);
  return{duplicate:false,requestId,payloadSha256,invoiceNumber,customerId:prepared.customer.id,customerNumber:prepared.customer.customerNumber,customerUpdatedAt:prepared.customer.updatedAt,customerName:prepared.customer.name,paymentAccount:prepared.readiness.seller.bankgiro,document:prepared.document,userId};
}
function finalizeInvoiceIssuance(db,{companyId,userId,prepared,pdfBytes}){
  const prior=db.prepare('SELECT invoice_id AS invoiceId FROM customer_invoice_issue_requests WHERE company_id=? AND request_id=?').get(companyId,prepared.requestId);
  if(prior){const existing=invoiceBundle(db,companyId,prior.invoiceId);if(!existing?.pdfArchive)throw invoiceError('Tidigare fakturabegäran saknar exakt PDF-arkiv.','INVOICE_PDF_ARCHIVE_NOT_FOUND',409);return{...existing,duplicate:true}}
  const reservation=reservationByRequest(db,companyId,prepared.requestId);if(!reservation)throw invoiceError('Fakturanummerreservationen saknas.','INVOICE_RESERVATION_NOT_FOUND',409);
  assertReservationMatch(reservation,{purpose:'invoice',payloadSha256:prepared.payloadSha256});
  if(reservation.status!=='reserved'||reservation.invoiceNumber!==prepared.invoiceNumber)throw invoiceError('Fakturanummerreservationen är inte i rätt läge.','INVOICE_RESERVATION_STATE_ERROR',409);
  const customer=Db.customerById(db,companyId,prepared.customerId);
  if(!customer||customer.customerNumber!==prepared.customerNumber||String(customer.updatedAt||'')!==String(prepared.customerUpdatedAt||''))throw invoiceError('Kunden har ändrats efter att fakturan förbereddes. Ladda om och skapa ett nytt fakturaförsök.','INVOICE_CUSTOMER_CHANGED',409);
  const document=prepared.document,invoiceNumber=prepared.invoiceNumber;
  const invoice=Db.createInvoice(db,{companyId,customerId:customer.id,invoiceNumber,ocr:invoiceNumber,invoiceDate:document.invoiceDate,postingDate:document.postingDate,dueDate:document.dueDate,totalOre:document.totalOre,remainingOre:document.totalOre,vatOre:document.vatOre,status:'Bokförd',paymentMethod:'Bankgiro',paymentAccount:prepared.paymentAccount,invoiceAccount:'1510'});
  const posted=Accounting.postEntry(db,{companyId,postingDate:document.postingDate,description:`Kundfaktura ${invoiceNumber} · ${customer.name}`.slice(0,240),sourceType:'customer-invoice',sourceId:invoice.id,createdBy:userId,series:'F',lines:Invoice.journalLines(document)});
  const createdAt=new Date().toISOString();db.prepare('UPDATE invoices SET journal_number=?,updated_at=? WHERE company_id=? AND id=?').run(posted.entry.number,createdAt,companyId,invoice.id);
  const documentJson=JSON.stringify(document),documentSha256=crypto.createHash('sha256').update(documentJson).digest('hex');
  db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)').run(invoice.id,companyId,documentJson,documentSha256,createdAt);
  const pdfArchive=storePdfArchive(db,{companyId,invoiceId:invoice.id,invoiceNumber,documentType:document.documentType,pdfBytes});
  db.prepare('INSERT INTO customer_invoice_issue_requests(company_id,request_id,invoice_id,created_at) VALUES(?,?,?,?)').run(companyId,prepared.requestId,invoice.id,createdAt);
  markReservationIssued(db,{companyId,requestId:prepared.requestId,invoiceId:invoice.id});
  const draftCleared=clearCustomerInvoiceDraft(db,{companyId,userId,requestId:prepared.requestId});
  Db.appendAudit(db,{companyId,userId,action:'CUSTOMER_INVOICE_ISSUED',entityType:'invoice',entityId:invoice.id,details:{invoiceNumber,journalNumber:posted.entry.number,customerNumber:customer.customerNumber,totalOre:document.totalOre,vatOre:document.vatOre,documentSha256,pdfSha256:pdfArchive.pdfSha256,pdfSizeBytes:pdfArchive.sizeBytes,draftCleared}});
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
function creditSettlementState(db,companyId,invoice){
  const transactions=Db.transactionsForInvoice(db,companyId,invoice.id).filter(row=>row.approved!==false);
  let expectedRemaining=invoice.totalOre,grossPaymentsOre=0,reversedPaymentsOre=0;
  for(const transaction of transactions){
    const amountOre=Number(transaction.amountOre||0),type=text(transaction.transactionType).toLowerCase();
    if(!Number.isSafeInteger(amountOre))throw invoiceError('Kundreskontran innehåller ett ogiltigt transaktionsbelopp. Krediteringen stoppades.','CREDIT_BALANCE_HISTORY_INVALID',409);
    if(amountOre===0)continue;
    if(type==='payment'&&amountOre<0){expectedRemaining+=amountOre;grossPaymentsOre+=Math.abs(amountOre);continue}
    if(type==='payment-reversal'&&amountOre>0){expectedRemaining+=amountOre;reversedPaymentsOre+=amountOre;continue}
    throw invoiceError('Kundreskontran innehåller en saldoförändring som kreditflödet ännu inte kan verifiera säkert.','CREDIT_BALANCE_HISTORY_UNSUPPORTED',409);
  }
  if(expectedRemaining<0||expectedRemaining>invoice.totalOre)throw invoiceError('Kundreskontrans betalningshistorik ger ett ogiltigt saldo. Krediteringen stoppades.','CREDIT_BALANCE_HISTORY_INVALID',409);
  if(expectedRemaining!==invoice.remainingOre)throw invoiceError('Fakturans restbelopp stämmer inte med betalningshistoriken. Krediteringen stoppades.','CREDIT_BALANCE_HISTORY_MISMATCH',409);
  const settledOre=invoice.totalOre-invoice.remainingOre;
  return Object.freeze({transactions:Object.freeze(transactions),expectedRemaining,grossPaymentsOre,reversedPaymentsOre,settledOre,hasPaymentHistory:transactions.length>0});
}
function validateCreditSource(db,{companyId,invoiceId,payload}){
  const original=Db.invoiceById(db,companyId,invoiceId);if(!original)throw invoiceError('Fakturan hittades inte i det inloggade företaget.','INVOICE_NOT_FOUND',404);if(original.totalOre<=0)throw invoiceError('En kreditfaktura kan inte krediteras med detta flöde.','CREDIT_SOURCE_INVALID',409);
  const existingCredit=db.prepare('SELECT credit_invoice_id AS creditInvoiceId FROM customer_invoice_credits WHERE company_id=? AND original_invoice_id=?').get(companyId,invoiceId);if(existingCredit)throw invoiceError('Fakturan är redan krediterad.','INVOICE_ALREADY_CREDITED',409);
  const settlement=creditSettlementState(db,companyId,original);
  if(settlement.settledOre>0)throw invoiceError('Fakturan har mottagna betalningar som inte är återförda. Helkredit skulle skapa en skuld till kunden, men något verifierat återbetalnings-/skuldkonto är ännu inte beslutat i systemets kontoplan. Krediteringen stoppades.','CREDIT_AFTER_PAYMENT_REQUIRES_REFUND_ACCOUNT',409);
  const reason=text(payload?.reason);if(reason.length<5||reason.length>500)throw invoiceError('Ange en tydlig orsak på 5–500 tecken.','CREDIT_REASON_REQUIRED',422);
  const creditDate=assertCreditDate(payload?.creditDate),periodRow=db.prepare('SELECT status FROM accounting_periods WHERE company_id=? AND period=?').get(companyId,creditDate.slice(0,7));if(periodRow?.status==='locked')throw invoiceError(`Bokföringsperioden ${creditDate.slice(0,7)} är låst.`,'PERIOD_LOCKED',409);
  const stored=documentForInvoice(db,companyId,invoiceId);if(!stored)throw invoiceError('Fakturans arkiverade originalunderlag saknas. Krediteringen stoppades.','INVOICE_DOCUMENT_REQUIRED',409);if(!pdfArchiveMetadata(db,companyId,invoiceId))throw invoiceError('Fakturans exakt arkiverade PDF saknas. Krediteringen stoppades.','INVOICE_PDF_ARCHIVE_REQUIRED',409);
  const originalEntry=Accounting.entryBySource(db,companyId,'customer-invoice',invoiceId);if(!originalEntry)throw invoiceError('Fakturans ursprungsverifikation saknas. Krediteringen stoppades.','INVOICE_ACCOUNTING_ENTRY_REQUIRED',409);
  const receivableLines=originalEntry.lines.filter(line=>line.account==='1510'),bookedReceivableOre=receivableLines.reduce((sum,line)=>sum+Number(line.debitOre||0)-Number(line.creditOre||0),0);if(!receivableLines.length||bookedReceivableOre!==original.totalOre)throw invoiceError('Fakturans kundfordringspost kan inte verifieras. Krediteringen stoppades.','INVOICE_ACCOUNTING_MISMATCH',409);
  return{original,reason,creditDate,stored,originalEntry,settlement};
}
function prepareCreditIssuance(db,{companyId,userId,invoiceId,payload}){
  const requestId=validateRequestId(payload?.requestId),prior=db.prepare('SELECT original_invoice_id AS originalInvoiceId,credit_invoice_id AS creditInvoiceId FROM customer_invoice_credits WHERE company_id=? AND request_id=?').get(companyId,requestId);
  if(prior){if(prior.originalInvoiceId!==invoiceId)throw invoiceError('Idempotensnyckeln är redan använd för en annan faktura.','CREDIT_IDEMPOTENCY_CONFLICT',409);const existing=invoiceBundle(db,companyId,prior.creditInvoiceId);if(!existing?.pdfArchive)throw invoiceError('Tidigare kreditfaktura saknar exakt PDF-arkiv.','INVOICE_PDF_ARCHIVE_NOT_FOUND',409);const reservation=reservationByRequest(db,companyId,requestId);if(reservation)assertReservationMatch(reservation,{purpose:'credit',payloadSha256:requestDigest('credit',{payload,document:existing.document},invoiceId),sourceInvoiceId:invoiceId});return{duplicate:true,result:{...existing,duplicate:true,original:Db.invoiceById(db,companyId,invoiceId)}}}
  const source=validateCreditSource(db,{companyId,invoiceId,payload});let reservation=reservationByRequest(db,companyId,requestId);const invoiceNumber=reservation?.invoiceNumber||nextInvoiceNumber(db,companyId);const document=creditDocumentFrom(source.stored.document,invoiceNumber,source.creditDate,source.reason),payloadSha256=requestDigest('credit',{payload,document},invoiceId);
  if(reservation)assertReservationMatch(reservation,{purpose:'credit',payloadSha256,sourceInvoiceId:invoiceId});else reservation=reserveInvoiceNumber(db,{companyId,requestId,purpose:'credit',payloadSha256,sourceInvoiceId:invoiceId});
  if(reservation.invoiceNumber!==invoiceNumber)throw invoiceError('Kreditfakturans nummerreservation ändrades under förberedelsen.','INVOICE_RESERVATION_STATE_ERROR',409);
  return{duplicate:false,requestId,payloadSha256,invoiceNumber,invoiceId,reason:source.reason,creditDate:source.creditDate,document,userId};
}
function finalizeCreditIssuance(db,{companyId,userId,prepared,pdfBytes}){
  const prior=db.prepare('SELECT original_invoice_id AS originalInvoiceId,credit_invoice_id AS creditInvoiceId FROM customer_invoice_credits WHERE company_id=? AND request_id=?').get(companyId,prepared.requestId);if(prior){const existing=invoiceBundle(db,companyId,prior.creditInvoiceId);if(!existing?.pdfArchive)throw invoiceError('Tidigare kreditfaktura saknar exakt PDF-arkiv.','INVOICE_PDF_ARCHIVE_NOT_FOUND',409);return{...existing,duplicate:true,original:Db.invoiceById(db,companyId,prior.originalInvoiceId)}}
  const reservation=reservationByRequest(db,companyId,prepared.requestId);if(!reservation)throw invoiceError('Kreditfakturans nummerreservation saknas.','INVOICE_RESERVATION_NOT_FOUND',409);assertReservationMatch(reservation,{purpose:'credit',payloadSha256:prepared.payloadSha256,sourceInvoiceId:prepared.invoiceId});if(reservation.status!=='reserved'||reservation.invoiceNumber!==prepared.invoiceNumber)throw invoiceError('Kreditfakturans nummerreservation är inte i rätt läge.','INVOICE_RESERVATION_STATE_ERROR',409);
  const source=validateCreditSource(db,{companyId,invoiceId:prepared.invoiceId,payload:{reason:prepared.reason,creditDate:prepared.creditDate}}),original=source.original,originalEntry=source.originalEntry,document=prepared.document,invoiceNumber=prepared.invoiceNumber;
  const creditInvoice=Db.createInvoice(db,{companyId,customerId:original.customerId,invoiceNumber,ocr:invoiceNumber,invoiceDate:prepared.creditDate,postingDate:prepared.creditDate,dueDate:prepared.creditDate,totalOre:-original.totalOre,remainingOre:0,vatOre:-original.vatOre,status:'Kreditfaktura',paymentMethod:original.paymentMethod,paymentAccount:original.paymentAccount,invoiceAccount:'1510'});
  const posted=Accounting.postEntry(db,{companyId,postingDate:prepared.creditDate,description:`Kreditfaktura ${invoiceNumber} av ${original.invoiceNumber}`.slice(0,240),sourceType:'customer-credit-note',sourceId:creditInvoice.id,createdBy:userId,series:'F',lines:originalEntry.lines.map(line=>({account:line.account,text:`Kreditering av ${original.invoiceNumber}: ${line.text||originalEntry.description}`,debitOre:line.creditOre,creditOre:line.debitOre}))});
  const createdAt=new Date().toISOString();db.prepare('UPDATE invoices SET remaining_ore=0,status=?,updated_at=? WHERE company_id=? AND id=?').run('Krediterad',createdAt,companyId,original.id);db.prepare('UPDATE invoices SET journal_number=?,updated_at=? WHERE company_id=? AND id=?').run(posted.entry.number,createdAt,companyId,creditInvoice.id);
  const documentJson=JSON.stringify(document),documentSha256=crypto.createHash('sha256').update(documentJson).digest('hex');db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)').run(creditInvoice.id,companyId,documentJson,documentSha256,createdAt);
  const pdfArchive=storePdfArchive(db,{companyId,invoiceId:creditInvoice.id,invoiceNumber,documentType:'KREDITFAKTURA',pdfBytes});db.prepare('INSERT INTO customer_invoice_credits(company_id,request_id,original_invoice_id,credit_invoice_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(companyId,prepared.requestId,original.id,creditInvoice.id,prepared.reason,userId,createdAt);markReservationIssued(db,{companyId,requestId:prepared.requestId,invoiceId:creditInvoice.id});
  Db.appendAudit(db,{companyId,userId,action:'CUSTOMER_INVOICE_CREDITED',entityType:'invoice',entityId:original.id,details:{originalInvoiceNumber:original.invoiceNumber,creditInvoiceId:creditInvoice.id,creditInvoiceNumber:invoiceNumber,journalNumber:posted.entry.number,reason:prepared.reason,documentSha256,pdfSha256:pdfArchive.pdfSha256,pdfSizeBytes:pdfArchive.sizeBytes}});
  return{...invoiceBundle(db,companyId,creditInvoice.id),duplicate:false,original:Db.invoiceById(db,companyId,original.id)};
}

module.exports=Object.freeze({initializeCustomerInvoicing,customerByNumber,nextInvoiceNumber,profileStatus,resolvedProfile,listCustomerInvoices,documentForInvoice,pdfArchiveMetadata,pdfArchivePrivateObjectMetadata,pdfArchiveForInvoice,invoiceBundle,getCustomerInvoiceDraft,saveCustomerInvoiceDraft,clearCustomerInvoiceDraft,prepareInvoiceIssuance,finalizeInvoiceIssuance,prepareCreditIssuance,finalizeCreditIssuance,renderInvoicePdf,creditDocumentFrom,creditSettlementState,validateCreditSource,validateRequestId,reservationByRequest});
