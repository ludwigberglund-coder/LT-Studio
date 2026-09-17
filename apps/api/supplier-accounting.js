'use strict';

const Db=require('./database.js');
const Accounting=require('./accounting-store.js');
const Payables=require('./payables.js');
const Domain=require('../../packages/payables/supplier-invoices.js');

function flowError(message,code='SUPPLIER_ACCOUNTING_ERROR',statusCode=422){const error=new Error(message);error.code=code;error.statusCode=statusCode;return error}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}
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
  `);
}

function operationBySource(db,companyId,operationType,sourceId){return db.prepare(`SELECT company_id AS companyId,operation_type AS operationType,source_id AS sourceId,accounting_entry_id AS accountingEntryId,created_at AS createdAt FROM supplier_accounting_operations WHERE company_id=? AND operation_type=? AND source_id=?`).get(companyId,operationType,sourceId)||null}
function saveOperation(db,{companyId,operationType,sourceId,accountingEntryId}){db.prepare(`INSERT INTO supplier_accounting_operations(company_id,operation_type,source_id,accounting_entry_id,created_at) VALUES(?,?,?,?,?)`).run(companyId,operationType,sourceId,accountingEntryId,nowIso());return operationBySource(db,companyId,operationType,sourceId)}
function accountingStatus(db,companyId,invoiceId){return db.prepare(`SELECT accounting_status AS accountingStatus FROM supplier_invoices WHERE company_id=? AND id=?`).get(companyId,invoiceId)?.accountingStatus||null}

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
    const reference=text(confirmationReference);
    const existingOperation=operationBySource(db,companyId,'payment-post',payment.id);
    if(existingOperation){
      if(reference&&payment.confirmationReference&&reference!==payment.confirmationReference)throw flowError('Betalningen är redan bokförd med en annan bankreferens.','IDEMPOTENCY_CONFLICT',409);
      const entry=Accounting.entryBySource(db,companyId,'supplier-payment',payment.id);
      if(!entry||entry.id!==existingOperation.accountingEntryId)throw flowError('Idempotensposten och betalningsjournalen är inte synkroniserade.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
      return{payment,entry,duplicate:true};
    }
    if(payment.status!=='released')throw flowError('Endast en frisläppt betalning kan bekräftas som genomförd.','INVALID_PAYMENT_STATUS',409);
    if(!payment.liabilityAccountingEntryId||payment.invoiceAccountingStatus!=='posted')throw flowError('Leverantörsskulden måste vara bokförd innan betalningen kan bokföras.','INVOICE_LIABILITY_NOT_POSTED',409);
    if(payment.openAmountOre!==payment.amountOre)throw flowError('Betalningsbeloppet stämmer inte med fakturans öppna reskontrabelopp.','PAYMENT_OPEN_AMOUNT_MISMATCH',409);
    if(reference.length<3||reference.length>160)throw flowError('En bank- eller betalningsreferens på 3–160 tecken krävs.','CONFIRMATION_REFERENCE_REQUIRED');
    const used=db.prepare(`SELECT id FROM supplier_payments WHERE company_id=? AND confirmation_reference=? AND id<>?`).get(companyId,reference,payment.id);
    if(used)throw flowError('Bankreferensen är redan kopplad till en annan betalning.','DUPLICATE_CONFIRMATION_REFERENCE',409);
    const date=text(postingDate||payment.paymentDate);
    if(!Accounting.validDate(date))throw flowError('Bokföringsdatumet är ogiltigt.','INVALID_POSTING_DATE');
    const posted=Accounting.postEntry(db,{
      companyId,
      postingDate:date,
      description:`Betalning leverantörsfaktura ${payment.supplierInvoiceNumber} – ${payment.supplierName}`,
      sourceType:'supplier-payment',
      sourceId:payment.id,
      createdBy:actorId,
      series:'A',
      lines:[
        {account:'2440',text:`Betald ${payment.supplierInvoiceNumber}`,debitOre:payment.amountOre,creditOre:0},
        {account:payment.account,text:`Bank ${reference}`,debitOre:0,creditOre:payment.amountOre}
      ]
    });
    if(posted.duplicate)throw flowError('Journalen innehåller redan betalningsverifikationen utan motsvarande idempotenspost.','SUPPLIER_ACCOUNTING_INTEGRITY_ERROR',500);
    const paidAt=nowIso();
    const paymentUpdate=db.prepare(`UPDATE supplier_payments SET status='paid',confirmation_reference=?,accounting_entry_id=?,paid_at=?,updated_at=? WHERE company_id=? AND id=? AND status='released'`).run(reference,posted.entry.id,paidAt,paidAt,companyId,payment.id);
    if(paymentUpdate.changes!==1)throw flowError('Betalningen ändrades av någon annan under bokföringen.','PAYMENT_CONFIRMATION_CONFLICT',409);
    const invoiceUpdate=db.prepare(`UPDATE supplier_invoices SET status='paid',accounting_status='paid',open_amount_ore=0,updated_at=? WHERE company_id=? AND id=? AND status='payment-prepared' AND accounting_status='posted' AND open_amount_ore=? AND liability_accounting_entry_id IS NOT NULL`).run(paidAt,companyId,payment.supplierInvoiceId,payment.amountOre);
    if(invoiceUpdate.changes!==1)throw flowError('Fakturans reskontrabelopp ändrades av någon annan under betalningsbokföringen.','SUPPLIER_INVOICE_PAYMENT_CONFLICT',409);
    saveOperation(db,{companyId,operationType:'payment-post',sourceId:payment.id,accountingEntryId:posted.entry.id});
    Db.appendAudit(db,{companyId,userId:actorId,action:'SUPPLIER_PAYMENT_CONFIRMED_AND_POSTED',entityType:'supplier-payment',entityId:payment.id,details:{invoiceId:payment.supplierInvoiceId,amountOre:payment.amountOre,confirmationReference:reference,accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number,openAmountOre:0,accountingStatus:'paid'}});
    payment=paymentForConfirmation(db,companyId,payment.id);
    return{payment,entry:posted.entry,duplicate:false};
  });
}

module.exports=Object.freeze({initializeSupplierAccounting,operationBySource,accountingStatus,assertSupplierInvoiceCoding,postSupplierInvoice,paymentForConfirmation,confirmSupplierPayment});
