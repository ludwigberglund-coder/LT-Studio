'use strict';

const Accounting=require('./accounting-store.js');

function confirmationError(message,code='PAYMENT_CONFIRMATION_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(v){return String(v??'').trim()}
function hasColumn(db,table,column){return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column)}
function initializePaymentConfirmation(db){
  Accounting.initializeAccountingStore(db);
  if(!hasColumn(db,'supplier_payments','confirmation_reference'))db.exec('ALTER TABLE supplier_payments ADD COLUMN confirmation_reference TEXT');
  if(!hasColumn(db,'supplier_payments','accounting_entry_id'))db.exec('ALTER TABLE supplier_payments ADD COLUMN accounting_entry_id TEXT');
  if(!hasColumn(db,'supplier_payments','paid_at'))db.exec('ALTER TABLE supplier_payments ADD COLUMN paid_at TEXT');
}
function paymentForConfirmation(db,companyId,paymentId){return db.prepare(`SELECT p.id,p.company_id AS companyId,p.supplier_invoice_id AS supplierInvoiceId,p.payment_date AS paymentDate,p.amount_ore AS amountOre,p.account,p.status,p.prepared_by AS preparedBy,p.released_by AS releasedBy,p.released_at AS releasedAt,p.confirmation_reference AS confirmationReference,p.accounting_entry_id AS accountingEntryId,p.paid_at AS paidAt,i.supplier_invoice_number AS supplierInvoiceNumber,i.status AS invoiceStatus,s.name AS supplierName FROM supplier_payments p JOIN supplier_invoices i ON i.id=p.supplier_invoice_id AND i.company_id=p.company_id JOIN suppliers s ON s.id=i.supplier_id AND s.company_id=i.company_id WHERE p.company_id=? AND p.id=?`).get(companyId,paymentId)||null}
function confirmAndPost(db,{companyId,paymentId,confirmationReference,postingDate,actorId}){
  const payment=paymentForConfirmation(db,companyId,paymentId);
  if(!payment)throw confirmationError('Betalningen hittades inte.','PAYMENT_NOT_FOUND',404);
  if(payment.status!=='released')throw confirmationError('Endast en frisläppt betalning kan bekräftas som genomförd.','INVALID_PAYMENT_STATUS',409);
  const reference=text(confirmationReference);
  if(reference.length<3||reference.length>160)throw confirmationError('En bank- eller betalningsreferens på 3–160 tecken krävs.','CONFIRMATION_REFERENCE_REQUIRED');
  const date=text(postingDate||payment.paymentDate);
  if(!Accounting.validDate(date))throw confirmationError('Bokföringsdatumet är ogiltigt.','INVALID_POSTING_DATE');
  const result=Accounting.postEntry(db,{
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
  if(result.duplicate)throw confirmationError('Betalningen har redan en bokföringspost.','PAYMENT_ALREADY_POSTED',409);
  const paidAt=new Date().toISOString();
  const paymentUpdate=db.prepare(`UPDATE supplier_payments SET status='paid',confirmation_reference=?,accounting_entry_id=?,paid_at=?,updated_at=? WHERE company_id=? AND id=? AND status='released'`).run(reference,result.entry.id,paidAt,paidAt,companyId,payment.id);
  if(paymentUpdate.changes!==1)throw confirmationError('Betalningen ändrades av någon annan under bokföringen.','PAYMENT_CONFIRMATION_CONFLICT',409);
  db.prepare(`UPDATE supplier_invoices SET status='paid',updated_at=? WHERE company_id=? AND id=? AND status='payment-prepared'`).run(paidAt,companyId,payment.supplierInvoiceId);
  return{payment:paymentForConfirmation(db,companyId,payment.id),entry:result.entry};
}
module.exports=Object.freeze({initializePaymentConfirmation,paymentForConfirmation,confirmAndPost});
