'use strict';

const crypto=require('node:crypto');
const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Payables=require('./payables.js');
const Domain=require('../../packages/payables/supplier-invoices.js');
const {protectAppendOnly}=require('./history-guards.js');

function flowError(message,code='SUPPLIER_ACCOUNTING_ERROR',statusCode=422){const error=new Error(message);error.code=code;error.statusCode=statusCode;return error}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function validRequestId(value){return /^[A-Za-z0-9_-]{16,100}$/.test(text(value))}
function hasColumn(db,table,column){return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column)}

function initializeSupplierAccounting(db){
  Payables.initializePayables(db);
  Accounting.initializeAccountingStore(db);
  if(!hasColumn(db,'supplier_payments','confirmation_reference'))db.exec('ALTER TABLE supplier_payments ADD COLUMN confirmation_reference TEXT');
  if(!hasColumn(db,'supplier_payments','accounting_entry_id'))db.exec('ALTER TABLE supplier_payments ADD COLUMN accounting_entry_id TEXT');
  if(!hasColumn(db,'supplier_payments','paid_at'))db.exec('ALTER TABLE supplier_payments ADD COLUMN paid_at TEXT');
  if(!hasColumn(db,'supplier_invoices','accounting_status')){
    db.exec(`ALTER TABLE supplier_invoices ADD COLUMN accounting_status TEXT NOT NULL DEFAULT 'unposted'`);
    db.exec(`UPDATE supplier_invoices SET accounting_status=CASE WHEN status='paid' THEN 'paid' WHEN liability_accounting_entry_id IS NOT NULL THEN 'posted' ELSE 'unposted' END`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_confirmation_reference
      ON supplier_payments(company_id,confirmation_reference) WHERE confirmation_reference IS NOT NULL;
    CREATE TABLE IF NOT EXISTS supplier_accounting_operations(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      operation_type TEXT NOT NULL CHECK(operation_type IN ('invoice-post','payment-post')),
      source_id TEXT NOT NULL,
      accounting_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,operation_type,source_id),
      UNIQUE(company_id,accounting_entry_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS supplier_payment_confirmation_refs(
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      confirmation_reference TEXT NOT NULL,
      payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE RESTRICT,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY(company_id,confirmation_reference)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS supplier_payment_attempts(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE RESTRICT,
      attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
      confirmation_reference TEXT NOT NULL,
      posting_date TEXT NOT NULL,
      account TEXT NOT NULL,
      amount_ore INTEGER NOT NULL CHECK(amount_ore>0),
      accounting_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('posted','reversed')),
      reversal_entry_id TEXT REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      correction_reason TEXT,
      correction_date TEXT,
      correction_request_id TEXT,
      corrected_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      corrected_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(company_id,payment_id,attempt_number),
      UNIQUE(company_id,accounting_entry_id),
      UNIQUE(company_id,reversal_entry_id)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_attempt_correction_request
      ON supplier_payment_attempts(company_id,correction_request_id) WHERE correction_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_supplier_payment_attempt_payment_status
      ON supplier_payment_attempts(company_id,payment_id,status,attempt_number);
    CREATE TRIGGER IF NOT EXISTS history_supplier_payment_attempts_delete BEFORE DELETE ON supplier_payment_attempts
      BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS history_supplier_payment_attempts_update BEFORE UPDATE ON supplier_payment_attempts
      WHEN NEW.id IS NOT OLD.id OR NEW.company_id IS NOT OLD.company_id OR NEW.payment_id IS NOT OLD.payment_id
        OR NEW.attempt_number IS NOT OLD.attempt_number OR NEW.confirmation_reference IS NOT OLD.confirmation_reference
        OR NEW.posting_date IS NOT OLD.posting_date OR NEW.account IS NOT OLD.account OR NEW.amount_ore IS NOT OLD.amount_ore
        OR NEW.accounting_entry_id IS NOT OLD.accounting_entry_id OR NEW.created_at IS NOT OLD.created_at
        OR OLD.status<>'posted' OR NEW.status<>'reversed'
        OR OLD.reversal_entry_id IS NOT NULL OR NEW.reversal_entry_id IS NULL
        OR OLD.correction_reason IS NOT NULL OR NEW.correction_reason IS NULL
        OR OLD.correction_date IS NOT NULL OR NEW.correction_date IS NULL
        OR OLD.correction_request_id IS NOT NULL OR NEW.correction_request_id IS NULL
        OR OLD.corrected_by IS NOT NULL OR NEW.corrected_by IS NULL
        OR OLD.corrected_at IS NOT NULL OR NEW.corrected_at IS NULL
      BEGIN SELECT RAISE(ABORT,'PAYMENT_ATTEMPT_HISTORY_IMMUTABLE'); END;
  `);
  db.exec(`INSERT INTO supplier_payment_confirmation_refs(company_id,confirmation_reference,payment_id,first_seen_at)
    SELECT p.company_id,p.confirmation_reference,p.id,COALESCE(p.paid_at,p.updated_at,p.created_at)
    FROM supplier_payments p
    WHERE p.confirmation_reference IS NOT NULL
      AND NOT EXISTS(
        SELECT 1 FROM supplier_payment_confirmation_refs r
        WHERE r.company_id=p.company_id AND r.confirmation_reference=p.confirmation_reference
      )`);
  protectAppendOnly(db,'supplier_payment_confirmation_refs');
}

function operationBySource(db,companyId,operationType,sourceId){return db.prepare(`SELECT company_id AS companyId,operation_type AS operationType,source_id AS sourceId,accounting_entry_id AS accountingEntryId,created_at AS createdAt FROM supplier_accounting_operations WHERE company_id=? AND operation_type=? AND source_id=?`).get(companyId,operationType,sourceId)||null}
function saveOperation(db,{companyId,operationType,sourceId,accountingEntryId}){db.prepare(`INSERT INTO supplier_accounting_operations(company_id,operation_type,source_id,accounting_entry_id,created_at) VALUES(?,?,?,?,?)`).run(companyId,operationType,sourceId,accountingEntryId,nowIso());return operationBySource(db,companyId,operationType,sourceId)}
function accountingStatus(db,companyId,invoiceId){return db.prepare(`SELECT accounting_status AS accountingStatus FROM supplier_invoices WHERE company_id=? AND id=?`).get(companyId,invoiceId)?.accountingStatus||null}
function supplierInvoiceWithAccountingStatus(db,companyId,invoiceId){const invoice=Payables.invoiceById(db,companyId,invoiceId);return invoice?{...invoice,accountingStatus:accountingStatus(db,companyId,invoiceId)}:null}
function paymentAttempts(db,companyId,paymentId){return db.prepare(`SELECT id,company_id AS companyId,payment_id AS paymentId,attempt_number AS attemptNumber,confirmation_reference AS confirmationReference,posting_date AS postingDate,account,amount_ore AS amountOre,accounting_entry_id AS accountingEntryId,status,reversal_entry_id AS reversalEntryId,correction_reason AS correctionReason,correction_date AS correctionDate,correction_request_id AS correctionRequestId,corrected_by AS correctedBy,corrected_at AS correctedAt,created_at AS createdAt FROM supplier_payment_attempts WHERE company_id=? AND payment_id=? ORDER BY attempt_number`).all(companyId,paymentId)}
function activePaymentAttempt(db,companyId,paymentId){return db.prepare(`SELECT id,company_id AS companyId,payment_id AS paymentId,attempt_number AS attemptNumber,confirmation_reference AS confirmationReference,posting_date AS postingDate,account,amount_ore AS amountOre,accounting_entry_id AS accountingEntryId,status,reversal_entry_id AS reversalEntryId,correction_reason AS correctionReason,correction_date AS correctionDate,correction_request_id AS correctionRequestId,corrected_by AS correctedBy,corrected_at AS correctedAt,created_at AS createdAt FROM supplier_payment_attempts WHERE company_id=? AND payment_id=? AND status='posted' ORDER BY attempt_number DESC LIMIT 1`).get(companyId,paymentId)||null}
function correctionAttemptByRequest(db,companyId,requestId){return db.prepare(`SELECT id,company_id AS companyId,payment_id AS paymentId,attempt_number AS attemptNumber,confirmation_reference AS confirmationReference,posting_date AS postingDate,account,amount_ore AS amountOre,accounting_entry_id AS accountingEntryId,status,reversal_entry_id AS reversalEntryId,correction_reason AS correctionReason,correction_date AS correctionDate,correction_request_id AS correctionRequestId,corrected_by AS correctedBy,corrected_at AS correctedAt,created_at AS createdAt FROM supplier_payment_attempts WHERE company_id=? AND correction_request_id=?`).get(companyId,requestId)||null}
function nextPaymentAttemptNumber(db,companyId,paymentId){return Number(db.prepare(`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM supplier_payment_attempts WHERE company_id=? AND payment_id=?`).get(companyId,paymentId).n)}
function reserveConfirmationReference(db,{companyId,paymentId,confirmationReference}){
  const reference=text(confirmationReference);
  const existing=db.prepare(`SELECT payment_id AS paymentId FROM supplier_payment_confirmation_refs WHERE company_id=? AND confirmation_reference=?`).get(companyId,reference);
  if(existing&&existing.paymentId!==paymentId)throw flowError('Bankreferensen är redan kopplad till en annan betalning.','DUPLICATE_CONFIRMATION_REFERENCE',409);
  if(!existing)db.prepare(`INSERT INTO supplier_payment_confirmation_refs(company_id,confirmation_reference,payment_id,first_seen_at) VALUES(?,?,?,?)`).run(companyId,reference,paymentId,nowIso());
}
function savePaymentAttempt(db,{companyId,paymentId,attemptNumber,confirmationReference,postingDate,account,amountOre,accountingEntryId}){
  const attemptId=id('spattempt'),createdAt=nowIso();
  db.prepare(`INSERT INTO supplier_payment_attempts(id,company_id,payment_id,attempt_number,confirmation_reference,posting_date,account,amount_ore,accounting_entry_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'posted',?)`).run(
    attemptId,companyId,paymentId,attemptNumber,confirmationReference,postingDate,account,amountOre,accountingEntryId,createdAt
  );
  return activePaymentAttempt(db,companyId,paymentId);
}
function ensureCurrentPaymentAttempt(db,payment){
  const current=activePaymentAttempt(db,payment.companyId,payment.id);if(current)return current;
  if(payment.status!=='paid'||!payment.accountingEntryId||!payment.confirmationReference)return null;
  const entry=Accounting.entryById(db,payment.companyId,payment.accountingEntryId);
  if(!entry)throw flowError('Den bokförda betalningens verifikation saknas.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
  const operation=operationBySource(db,payment.companyId,'payment-post',payment.id);
  if(operation&&operation.accountingEntryId!==entry.id)throw flowError('Idempotensposten och betalningsjournalen är inte synkroniserade.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
  reserveConfirmationReference(db,{companyId:payment.companyId,paymentId:payment.id,confirmationReference:payment.confirmationReference});
  return savePaymentAttempt(db,{companyId:payment.companyId,paymentId:payment.id,attemptNumber:nextPaymentAttemptNumber(db,payment.companyId,payment.id),confirmationReference:payment.confirmationReference,postingDate:entry.postingDate,account:payment.account,amountOre:payment.amountOre,accountingEntryId:entry.id});
}
function assertSupplierPaymentEntry(payment,attempt,entry){
  if(!entry||entry.id!==attempt.accountingEntryId)throw flowError('Betalningsförsöket saknar sin bokföringsverifikation.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
  const liability=entry.lines.filter(line=>line.account==='2440'),bank=entry.lines.filter(line=>line.account===attempt.account);
  if(liability.length!==1||bank.length!==1||entry.lines.length!==2||liability[0].debitOre!==payment.amountOre||liability[0].creditOre!==0||bank[0].debitOre!==0||bank[0].creditOre!==payment.amountOre){
    throw flowError('Betalningsverifikationen har oväntad kontering och kan inte rättas automatiskt.','SUPPLIER_PAYMENT_CORRECTION_UNSAFE',409);
  }
  return entry;
}

function assertSupplierInvoiceCoding(invoice){
  const validated=Domain.validateCoding({totalOre:invoice.totalOre,lines:invoice.coding});
  const hash=Domain.codingHash(validated.lines);
  if(!invoice.codingSha256||hash!==invoice.codingSha256)throw flowError('Den sparade konteringen stämmer inte längre med den attesterade konteringen.','CODING_CHANGED_AFTER_APPROVAL',409);
  const liabilityNet=validated.lines.filter(line=>line.account==='2440').reduce((sum,line)=>sum+line.creditOre-line.debitOre,0);
  if(liabilityNet!==invoice.totalOre)throw flowError('Konteringen måste kreditera konto 2440 med hela fakturabeloppet.','INVALID_SUPPLIER_LIABILITY_CODING');
  const vatNet=validated.lines.filter(line=>line.account==='2641').reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
  if(vatNet!==invoice.vatOre)throw flowError('Konteringen måste bokföra fakturans ingående moms på konto 2641.','INVALID_INPUT_VAT_CODING');
  const costNet=validated.lines.filter(line=>!['2440','2641'].includes(line.account)).reduce((sum,line)=>sum+line.debitOre-line.creditOre,0);
  if(costNet!==invoice.totalOre-invoice.vatOre)throw flowError('Kostnadskonteringens nettobelopp stämmer inte med fakturans belopp exklusive moms.','INVALID_COST_CODING');
  return validated;
}

function postSupplierInvoice(db,{companyId,invoiceId,actorId}){
  initializeSupplierAccounting(db);
  return Db.transaction(db,()=>{
    let invoice=Payables.invoiceById(db,companyId,invoiceId);
    if(!invoice)throw flowError('Leverantörsfakturan hittades inte.','INVOICE_NOT_FOUND',404);
    const existingOperation=operationBySource(db,companyId,'invoice-post',invoice.id);
    if(existingOperation){
      const entry=Accounting.entryBySource(db,companyId,'supplier-invoice',invoice.id);
      if(!entry||entry.id!==existingOperation.accountingEntryId)throw flowError('Idempotensposten och bokföringsjournalen är inte synkroniserade.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
      return{invoice:{...invoice,accountingStatus:accountingStatus(db,companyId,invoice.id)},entry,duplicate:true};
    }
    if(invoice.status!=='approved')throw flowError('Leverantörsfakturan måste vara attesterad innan skulden bokförs.','INVOICE_NOT_APPROVED',409);
    if(!actorId)throw flowError('Personlig användaridentitet krävs för bokföring.','PERSONAL_IDENTITY_REQUIRED',401);
    const validated=assertSupplierInvoiceCoding(invoice);
    const posted=Accounting.postEntry(db,{
      companyId,
      postingDate:invoice.invoiceDate,
      description:`Leverantörsfaktura ${invoice.supplierInvoiceNumber} – ${invoice.supplierName}`,
      sourceType:'supplier-invoice',
      sourceId:invoice.id,
      createdBy:actorId,
      series:'B',
      lines:validated.lines
    });
    if(posted.duplicate)throw flowError('Journalen innehåller redan fakturaverifikationen utan motsvarande idempotenspost.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
    const postedAt=nowIso();
    const update=db.prepare(`UPDATE supplier_invoices SET liability_accounting_entry_id=?,liability_posted_at=?,open_amount_ore=?,accounting_status='posted',updated_at=? WHERE company_id=? AND id=? AND liability_accounting_entry_id IS NULL AND accounting_status='unposted'`).run(posted.entry.id,postedAt,invoice.totalOre,postedAt,companyId,invoice.id);
    if(update.changes!==1)throw flowError('Fakturan ändrades av någon annan under bokföringen.','SUPPLIER_INVOICE_POST_CONFLICT',409);
    saveOperation(db,{companyId,operationType:'invoice-post',sourceId:invoice.id,accountingEntryId:posted.entry.id});
    Db.appendAudit(db,{companyId,userId:actorId,action:'SUPPLIER_INVOICE_POSTED',entityType:'supplier-invoice',entityId:invoice.id,details:{accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number,totalOre:invoice.totalOre,openAmountOre:invoice.totalOre,accountingStatus:'posted'}});
    invoice=Payables.invoiceById(db,companyId,invoice.id);
    return{invoice:{...invoice,accountingStatus:'posted'},entry:posted.entry,duplicate:false};
  });
}

function paymentForConfirmation(db,companyId,paymentId){return db.prepare(`SELECT p.id,p.company_id AS companyId,p.supplier_invoice_id AS supplierInvoiceId,p.payment_date AS paymentDate,p.amount_ore AS amountOre,p.account,p.status,p.prepared_by AS preparedBy,p.released_by AS releasedBy,p.released_at AS releasedAt,p.confirmation_reference AS confirmationReference,p.accounting_entry_id AS accountingEntryId,p.paid_at AS paidAt,i.supplier_invoice_number AS supplierInvoiceNumber,i.status AS invoiceStatus,i.accounting_status AS invoiceAccountingStatus,i.open_amount_ore AS openAmountOre,i.liability_accounting_entry_id AS liabilityAccountingEntryId,s.name AS supplierName FROM supplier_payments p JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE p.company_id=? AND p.id=?`).get(companyId,paymentId)||null}

function confirmSupplierPayment(db,{companyId,paymentId,confirmationReference,postingDate,actorId}){
  initializeSupplierAccounting(db);
  return Db.transaction(db,()=>{
    let payment=paymentForConfirmation(db,companyId,paymentId);
    if(!payment)throw flowError('Betalningen hittades inte.','PAYMENT_NOT_FOUND',404);
    const reference=text(confirmationReference),date=text(postingDate||payment.paymentDate);
    if(payment.status==='paid'){
      const attempt=ensureCurrentPaymentAttempt(db,payment);
      if(!attempt)throw flowError('Den bokförda betalningens försökshistorik saknas.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
      const entry=assertSupplierPaymentEntry(payment,attempt,Accounting.entryById(db,companyId,attempt.accountingEntryId));
      if(reference!==attempt.confirmationReference||date!==attempt.postingDate)throw flowError('Betalningen är redan bokförd med en annan bankreferens eller ett annat bokföringsdatum. Ingen ändring gjordes.','IDEMPOTENCY_CONFLICT',409);
      return{payment,entry,attempt,duplicate:true};
    }
    if(payment.status!=='released')throw flowError('Endast en frisläppt betalning kan bekräftas som genomförd.','INVALID_PAYMENT_STATUS',409);
    if(!payment.liabilityAccountingEntryId||payment.invoiceAccountingStatus!=='posted')throw flowError('Leverantörsskulden måste vara bokförd innan betalningen kan bokföras.','INVOICE_LIABILITY_NOT_POSTED',409);
    if(payment.openAmountOre!==payment.amountOre)throw flowError('Betalningsbeloppet stämmer inte med fakturans öppna reskontrabelopp.','PAYMENT_OPEN_AMOUNT_MISMATCH',409);
    if(reference.length<3||reference.length>160)throw flowError('En bank- eller betalningsreferens på 3–160 tecken krävs.','CONFIRMATION_REFERENCE_REQUIRED');
    if(!Accounting.validDate(date))throw flowError('Bokföringsdatumet är ogiltigt.','INVALID_POSTING_DATE');
    reserveConfirmationReference(db,{companyId,paymentId:payment.id,confirmationReference:reference});
    const attemptNumber=nextPaymentAttemptNumber(db,companyId,payment.id);
    const firstAttempt=attemptNumber===1;
    const posted=Accounting.postEntry(db,{
      companyId,
      postingDate:date,
      description:`Betalning leverantörsfaktura ${payment.supplierInvoiceNumber} – ${payment.supplierName}`,
      sourceType:firstAttempt?'supplier-payment':'supplier-payment-repost',
      sourceId:firstAttempt?payment.id:`${payment.id}:attempt:${attemptNumber}`,
      createdBy:actorId,
      series:'A',
      lines:[
        {account:'2440',text:`Betald ${payment.supplierInvoiceNumber}`,debitOre:payment.amountOre,creditOre:0},
        {account:payment.account,text:`Bank ${reference}`,debitOre:0,creditOre:payment.amountOre}
      ]
    });
    if(posted.duplicate)throw flowError('Journalen innehåller redan betalningsverifikationen utan motsvarande aktivt betalningsförsök.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
    const paidAt=nowIso();
    const paymentUpdate=db.prepare(`UPDATE supplier_payments SET status='paid',confirmation_reference=?,accounting_entry_id=?,paid_at=?,updated_at=? WHERE company_id=? AND id=? AND status='released' AND accounting_entry_id IS NULL`).run(reference,posted.entry.id,paidAt,paidAt,companyId,payment.id);
    if(paymentUpdate.changes!==1)throw flowError('Betalningen ändrades av någon annan under bokföringen.','PAYMENT_CONFIRMATION_CONFLICT',409);
    const invoiceUpdate=db.prepare(`UPDATE supplier_invoices SET status='paid',accounting_status='paid',open_amount_ore=0,updated_at=? WHERE company_id=? AND id=? AND status='payment-prepared' AND accounting_status='posted' AND open_amount_ore=? AND liability_accounting_entry_id IS NOT NULL`).run(paidAt,companyId,payment.supplierInvoiceId,payment.amountOre);
    if(invoiceUpdate.changes!==1)throw flowError('Fakturans reskontrabelopp ändrades av någon annan under betalningsbokföringen.','SUPPLIER_INVOICE_PAYMENT_CONFLICT',409);
    const attempt=savePaymentAttempt(db,{companyId,paymentId:payment.id,attemptNumber,confirmationReference:reference,postingDate:date,account:payment.account,amountOre:payment.amountOre,accountingEntryId:posted.entry.id});
    if(firstAttempt)saveOperation(db,{companyId,operationType:'payment-post',sourceId:payment.id,accountingEntryId:posted.entry.id});
    Db.appendAudit(db,{companyId,userId:actorId,action:'SUPPLIER_PAYMENT_CONFIRMED_AND_POSTED',entityType:'supplier-payment',entityId:payment.id,details:{invoiceId:payment.supplierInvoiceId,attemptNumber,amountOre:payment.amountOre,confirmationReference:reference,accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number,openAmountOre:0,accountingStatus:'paid'}});
    payment=paymentForConfirmation(db,companyId,payment.id);
    return{payment,entry:posted.entry,attempt,duplicate:false};
  });
}

function correctSupplierPayment(db,{companyId,paymentId,requestId,correctionDate,reason,actorId}){
  initializeSupplierAccounting(db);
  return Db.transaction(db,()=>{
    const key=text(requestId),cleanReason=text(reason),date=text(correctionDate);
    if(!validRequestId(key))throw flowError('Ett giltigt request-id krävs för betalningsrättelsen.','INVALID_PAYMENT_CORRECTION_REQUEST_ID',422);
    if(cleanReason.length<5||cleanReason.length>500)throw flowError('Betalningsrättelsen kräver en tydlig orsak på 5–500 tecken.','PAYMENT_CORRECTION_REASON_REQUIRED',422);
    if(!Accounting.validDate(date))throw flowError('Rättelsens bokföringsdatum är ogiltigt.','INVALID_POSTING_DATE',422);
    if(!actorId)throw flowError('Personlig användaridentitet krävs för rättelsen.','PERSONAL_IDENTITY_REQUIRED',401);

    const previous=correctionAttemptByRequest(db,companyId,key);
    if(previous){
      if(previous.paymentId!==paymentId||previous.correctionReason!==cleanReason||previous.correctionDate!==date||previous.correctedBy!==actorId)throw flowError('Request-id är redan använt för en annan betalningsrättelse.','PAYMENT_CORRECTION_IDEMPOTENCY_CONFLICT',409);
      const reversal=Accounting.entryById(db,companyId,previous.reversalEntryId);
      if(!reversal)throw flowError('Rättelsens motverifikation saknas.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
      const payment=paymentForConfirmation(db,companyId,paymentId);return{payment,invoice:supplierInvoiceWithAccountingStatus(db,companyId,payment?.supplierInvoiceId),attempt:previous,reversal,duplicate:true};
    }

    let payment=paymentForConfirmation(db,companyId,paymentId);
    if(!payment)throw flowError('Betalningen hittades inte.','PAYMENT_NOT_FOUND',404);
    if(payment.status!=='paid')throw flowError('Endast en bokförd betalning kan rättas.','PAYMENT_NOT_POSTED',409);
    const attempt=ensureCurrentPaymentAttempt(db,payment);
    if(!attempt)throw flowError('Den bokförda betalningens försökshistorik saknas.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
    if(date<attempt.postingDate)throw flowError('Rättelsedatumet får inte ligga före den bokförda betalningen.','PAYMENT_CORRECTION_DATE_BEFORE_PAYMENT',409);
    const original=assertSupplierPaymentEntry(payment,attempt,Accounting.entryById(db,companyId,attempt.accountingEntryId));
    const reversed=Accounting.postEntry(db,{
      companyId,
      postingDate:date,
      description:`Rättelse betalning ${payment.supplierInvoiceNumber} – ${cleanReason}`.slice(0,240),
      sourceType:'supplier-payment-reversal',
      sourceId:`${payment.id}:attempt:${attempt.attemptNumber}`,
      createdBy:actorId,
      series:original.series,
      lines:original.lines.map(line=>({account:line.account,text:`Rättelse av ${original.number}: ${line.text||original.description}`,debitOre:line.creditOre,creditOre:line.debitOre}))
    });
    if(reversed.duplicate)throw flowError('Betalningsrättelsen finns redan utan motsvarande rättelsehistorik.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
    const correctedAt=nowIso();
    const attemptUpdate=db.prepare(`UPDATE supplier_payment_attempts SET status='reversed',reversal_entry_id=?,correction_reason=?,correction_date=?,correction_request_id=?,corrected_by=?,corrected_at=? WHERE company_id=? AND id=? AND status='posted'`).run(
      reversed.entry.id,cleanReason,date,key,actorId,correctedAt,companyId,attempt.id
    );
    if(attemptUpdate.changes!==1)throw flowError('Betalningsförsöket ändrades av någon annan under rättelsen.','PAYMENT_CORRECTION_CONFLICT',409);
    const paymentUpdate=db.prepare(`UPDATE supplier_payments SET status='released',confirmation_reference=NULL,accounting_entry_id=NULL,paid_at=NULL,updated_at=? WHERE company_id=? AND id=? AND status='paid' AND accounting_entry_id=?`).run(correctedAt,companyId,payment.id,attempt.accountingEntryId);
    if(paymentUpdate.changes!==1)throw flowError('Betalningsstatusen kunde inte återställas atomiskt.','PAYMENT_CORRECTION_CONFLICT',409);
    const invoiceUpdate=db.prepare(`UPDATE supplier_invoices SET status='payment-prepared',accounting_status='posted',open_amount_ore=?,updated_at=? WHERE company_id=? AND id=? AND status='paid' AND accounting_status='paid' AND open_amount_ore=0`).run(payment.amountOre,correctedAt,companyId,payment.supplierInvoiceId);
    if(invoiceUpdate.changes!==1)throw flowError('Leverantörsreskontran kunde inte öppnas igen atomiskt.','SUPPLIER_INVOICE_CORRECTION_CONFLICT',409);
    Db.appendAudit(db,{companyId,userId:actorId,action:'SUPPLIER_PAYMENT_CORRECTED',entityType:'supplier-payment',entityId:payment.id,details:{invoiceId:payment.supplierInvoiceId,attemptNumber:attempt.attemptNumber,reason:cleanReason,correctionDate:date,originalAccountingEntryId:original.id,reversalAccountingEntryId:reversed.entry.id,openAmountOre:payment.amountOre,accountingStatus:'posted'}});
    payment=paymentForConfirmation(db,companyId,payment.id);
    return{payment,invoice:supplierInvoiceWithAccountingStatus(db,companyId,payment.supplierInvoiceId),attempt:correctionAttemptByRequest(db,companyId,key),originalEntry:original,reversal:reversed.entry,duplicate:false};
  });
}

module.exports=Object.freeze({initializeSupplierAccounting,operationBySource,accountingStatus,paymentAttempts,activePaymentAttempt,correctionAttemptByRequest,assertSupplierInvoiceCoding,postSupplierInvoice,paymentForConfirmation,confirmSupplierPayment,correctSupplierPayment});
