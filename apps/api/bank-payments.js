'use strict';

const crypto=require('node:crypto');

function error(message,code='BANK_PAYMENT_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function nowIso(){return new Date().toISOString()}
function id(){return `bank_${crypto.randomUUID()}`}
function text(value){return String(value??'').trim()}

function initializeBankPayments(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_payments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      value_date TEXT,
      amount_ore INTEGER NOT NULL CHECK(amount_ore > 0),
      currency TEXT NOT NULL DEFAULT 'SEK',
      reference TEXT,
      message TEXT,
      payer_name TEXT,
      payer_account TEXT,
      status TEXT NOT NULL CHECK(status IN ('unmatched','proposal-created','reviewed','posted','ignored')),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id,external_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_bank_payments_company_status ON bank_payments(company_id,status,booking_date);
  `);
}

const SELECT=`SELECT id,company_id AS companyId,external_id AS externalId,booking_date AS bookingDate,value_date AS valueDate,amount_ore AS amountOre,currency,reference,message,payer_name AS payerName,payer_account AS payerAccount,status,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt FROM bank_payments`;
function row(value){return value||null}
function byId(db,companyId,paymentId){return row(db.prepare(`${SELECT} WHERE company_id=? AND id=?`).get(companyId,paymentId))}
function byExternalId(db,companyId,externalId){return row(db.prepare(`${SELECT} WHERE company_id=? AND external_id=?`).get(companyId,externalId))}

function create(db,input){
  const companyId=text(input.companyId),externalId=text(input.externalId),bookingDate=text(input.bookingDate),currency=text(input.currency||'SEK').toUpperCase();
  const valueDate=text(input.valueDate)||null,reference=text(input.reference)||null,message=text(input.message)||null,payerName=text(input.payerName)||null,payerAccount=text(input.payerAccount)||null;
  if(!companyId||!externalId)throw error('Företag och bankens externa id krävs.','INVALID_BANK_ID');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate))throw error('Bokföringsdatum för bankhändelsen är ogiltigt.','INVALID_BANK_DATE');
  if(!Number.isSafeInteger(input.amountOre)||input.amountOre<=0)throw error('Inbetalningen måste vara ett positivt heltalsbelopp i ören.','INVALID_BANK_AMOUNT');
  if(currency!=='SEK')throw error('Den första versionen stöder endast SEK.','UNSUPPORTED_CURRENCY');
  const existing=byExternalId(db,companyId,externalId);
  if(existing){
    const matches=
      existing.bookingDate===bookingDate&&
      (existing.valueDate||null)===valueDate&&
      existing.amountOre===input.amountOre&&
      existing.currency===currency&&
      (existing.reference||null)===reference&&
      (existing.message||null)===message&&
      (existing.payerName||null)===payerName&&
      (existing.payerAccount||null)===payerAccount;
    if(!matches)throw error('Bankens externa id är redan importerat med andra uppgifter.','BANK_IDEMPOTENCY_CONFLICT',409);
    return {payment:existing,duplicate:true};
  }
  const createdAt=nowIso(),paymentId=input.id||id();
  db.prepare(`INSERT INTO bank_payments(id,company_id,external_id,booking_date,value_date,amount_ore,currency,reference,message,payer_name,payer_account,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    paymentId,companyId,externalId,bookingDate,valueDate,input.amountOre,currency,reference,message,payerName,payerAccount,'unmatched',text(input.createdBy)||null,createdAt,createdAt
  );
  return {payment:byId(db,companyId,paymentId),duplicate:false};
}

function list(db,companyId,{status='',limit=300}={}){
  const safe=Math.max(1,Math.min(1000,Number(limit)||300));
  return status?db.prepare(`${SELECT} WHERE company_id=? AND status=? ORDER BY booking_date DESC,created_at DESC LIMIT ?`).all(companyId,status,safe):db.prepare(`${SELECT} WHERE company_id=? ORDER BY booking_date DESC,created_at DESC LIMIT ?`).all(companyId,safe);
}
function setStatus(db,companyId,paymentId,status){
  if(!['unmatched','proposal-created','reviewed','posted','ignored'].includes(status))throw error('Ogiltig bankstatus.','INVALID_BANK_STATUS');
  const result=db.prepare('UPDATE bank_payments SET status=?,updated_at=? WHERE company_id=? AND id=?').run(status,nowIso(),companyId,paymentId);
  if(result.changes!==1)throw error('Bankhändelsen hittades inte.','BANK_PAYMENT_NOT_FOUND',404);
  return byId(db,companyId,paymentId);
}
module.exports=Object.freeze({initializeBankPayments,create,list,byId,byExternalId,setStatus});
