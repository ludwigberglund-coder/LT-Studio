'use strict';

const crypto=require('node:crypto');
const Bank=require('./bank-payments.js');
const Accounting=require('./accounting-store.js');
const Db=require('./database.js');

function flowError(message,code='UNPLACED_PAYMENT_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function nowIso(){return new Date().toISOString()}
function validRequestId(value){return /^[A-Za-z0-9._:-]{8,180}$/.test(text(value))}

function initializeUnplacedPayments(db){
  Bank.initializeBankPayments(db);
  Accounting.initializeAccountingStore(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS unplaced_payment_resolutions(
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      bank_payment_id TEXT NOT NULL REFERENCES bank_payments(id) ON DELETE RESTRICT,
      resolution_type TEXT NOT NULL CHECK(resolution_type IN ('other-income','outgoing')),
      counter_account TEXT NOT NULL,
      description TEXT NOT NULL,
      accounting_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      request_id TEXT NOT NULL,
      resolved_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      resolved_at TEXT NOT NULL,
      UNIQUE(company_id,bank_payment_id),
      UNIQUE(company_id,request_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_unplaced_payment_resolutions_company
      ON unplaced_payment_resolutions(company_id,resolved_at);
  `);
}

function byRequest(db,companyId,requestId){
  return db.prepare(`SELECT id,company_id AS companyId,bank_payment_id AS bankPaymentId,resolution_type AS resolutionType,
    counter_account AS counterAccount,description,accounting_entry_id AS accountingEntryId,request_id AS requestId,
    resolved_by AS resolvedBy,resolved_at AS resolvedAt
    FROM unplaced_payment_resolutions WHERE company_id=? AND request_id=?`).get(companyId,requestId)||null;
}
function byBankPayment(db,companyId,paymentId){
  return db.prepare(`SELECT id,company_id AS companyId,bank_payment_id AS bankPaymentId,resolution_type AS resolutionType,
    counter_account AS counterAccount,description,accounting_entry_id AS accountingEntryId,request_id AS requestId,
    resolved_by AS resolvedBy,resolved_at AS resolvedAt
    FROM unplaced_payment_resolutions WHERE company_id=? AND bank_payment_id=?`).get(companyId,paymentId)||null;
}

function resolveOther(db,{companyId,paymentId,resolutionType,counterAccount,description,requestId,actorId}){
  initializeUnplacedPayments(db);
  const cleanType=text(resolutionType),account=text(counterAccount),cleanDescription=text(description),key=text(requestId);
  if(!['other-income','outgoing'].includes(cleanType))throw flowError('Välj om bankhändelsen är en annan inbetalning eller en utbetalning.','INVALID_RESOLUTION_TYPE');
  if(!/^\d{4}$/.test(account))throw flowError('Motkontot måste vara ett fyrsiffrigt bokföringskonto.','INVALID_COUNTER_ACCOUNT');
  if(['1510','1930','2440'].includes(account))throw flowError('Kontot 1510, 1930 eller 2440 måste hanteras i sitt särskilda reskontra- eller bankflöde.','SUBLEDGER_ACCOUNT_BLOCKED',409);
  if(cleanDescription.length<3||cleanDescription.length>240)throw flowError('Beskrivningen måste vara 3–240 tecken.','INVALID_DESCRIPTION');
  if(!validRequestId(key))throw flowError('Ett giltigt request-id krävs.','INVALID_REQUEST_ID');
  if(!text(actorId))throw flowError('Personlig användaridentitet krävs.','PERSONAL_IDENTITY_REQUIRED',401);

  return Db.transaction(db,()=>{
    const previous=byRequest(db,companyId,key);
    if(previous){
      if(previous.bankPaymentId!==paymentId||previous.resolutionType!==cleanType||previous.counterAccount!==account||previous.description!==cleanDescription){
        throw flowError('Request-id är redan använt för en annan hantering.','IDEMPOTENCY_CONFLICT',409);
      }
      return{resolution:previous,entry:Accounting.entryById(db,companyId,previous.accountingEntryId),payment:Bank.byId(db,companyId,paymentId),duplicate:true};
    }
    const existing=byBankPayment(db,companyId,paymentId);
    if(existing)throw flowError('Bankhändelsen är redan hanterad.','BANK_PAYMENT_ALREADY_RESOLVED',409);
    const payment=Bank.byId(db,companyId,paymentId);
    if(!payment)throw flowError('Bankhändelsen hittades inte.','BANK_PAYMENT_NOT_FOUND',404);
    if(payment.status!=='unmatched')throw flowError('Endast oplacerade bankhändelser kan bokföras här.','INVALID_BANK_PAYMENT_STATUS',409);
    if(payment.currency!=='SEK')throw flowError('Den här versionen stöder endast SEK.','UNSUPPORTED_CURRENCY',409);
    const amount=Number(payment.amountOre);
    const lines=cleanType==='outgoing'
      ?[{account,text:cleanDescription,debitOre:amount,creditOre:0},{account:'1930',text:'Utbetalning från bank',debitOre:0,creditOre:amount}]
      :[{account:'1930',text:'Bankinbetalning',debitOre:amount,creditOre:0},{account,text:cleanDescription,debitOre:0,creditOre:amount}];
    const posted=Accounting.postEntry(db,{companyId,postingDate:payment.bookingDate,description:cleanDescription,sourceType:'unplaced-bank-payment',sourceId:payment.id,createdBy:actorId,series:'A',lines});
    if(posted.duplicate)throw flowError('Bankhändelsen har redan en bokföringspost men saknar hanteringshistorik.','RESOLUTION_INTEGRITY_ERROR',500);
    Bank.setStatus(db,companyId,payment.id,'posted');
    const resolutionId=`unplaced_${crypto.randomUUID()}`,resolvedAt=nowIso();
    db.prepare(`INSERT INTO unplaced_payment_resolutions(id,company_id,bank_payment_id,resolution_type,counter_account,description,accounting_entry_id,request_id,resolved_by,resolved_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(resolutionId,companyId,payment.id,cleanType,account,cleanDescription,posted.entry.id,key,actorId,resolvedAt);
    Db.appendAudit(db,{companyId,userId:actorId,action:'UNPLACED_BANK_PAYMENT_RESOLVED',entityType:'bank-payment',entityId:payment.id,details:{resolutionType:cleanType,counterAccount:account,description:cleanDescription,amountOre:amount,accountingEntryId:posted.entry.id,accountingNumber:posted.entry.number}});
    return{resolution:byRequest(db,companyId,key),entry:posted.entry,payment:Bank.byId(db,companyId,payment.id),duplicate:false};
  });
}

module.exports=Object.freeze({initializeUnplacedPayments,byRequest,byBankPayment,resolveOther});
