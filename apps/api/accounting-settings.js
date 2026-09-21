'use strict';

const PROTECTED_REFUND_ACCOUNTS=new Set(['2440','2611','2621','2631','2641','2710','2731','2910']);

function settingsError(message,code='ACCOUNTING_SETTINGS_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function initializeAccountingSettings(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_accounting_settings(
      company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      customer_refund_liability_account TEXT,
      customer_refund_decision_reference TEXT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
}
function normalizeCustomerRefundLiabilityAccount(value){
  const account=text(value);
  if(!/^2\d{3}$/.test(account))throw settingsError('Kundåterbetalningskontot måste vara ett fyrsiffrigt skuldkonto i klass 2.','INVALID_CUSTOMER_REFUND_LIABILITY_ACCOUNT');
  if(PROTECTED_REFUND_ACCOUNTS.has(account))throw settingsError(`Konto ${account} är ett skyddat kontrollkonto och får inte användas som generellt kundåterbetalningskonto.`,'PROTECTED_CUSTOMER_REFUND_LIABILITY_ACCOUNT',409);
  return account;
}
function normalizeDecisionReference(value){
  const reference=text(value);
  if(reference.length<5||reference.length>500)throw settingsError('Beslutsreferensen måste vara 5–500 tecken och ange varför kontot är verifierat.','CUSTOMER_REFUND_DECISION_REFERENCE_REQUIRED');
  return reference;
}
function getAccountingSettings(db,companyId){
  initializeAccountingSettings(db);
  return db.prepare(`SELECT company_id AS companyId,customer_refund_liability_account AS customerRefundLiabilityAccount,
    customer_refund_decision_reference AS customerRefundDecisionReference,updated_by AS updatedBy,updated_at AS updatedAt
    FROM company_accounting_settings WHERE company_id=?`).get(companyId)||null;
}
function setCustomerRefundLiabilityAccount(db,{companyId,account,decisionReference,updatedBy}){
  initializeAccountingSettings(db);
  if(!db.prepare('SELECT 1 FROM companies WHERE id=?').get(companyId))throw settingsError('Företaget hittades inte.','COMPANY_NOT_FOUND',404);
  if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(updatedBy))throw settingsError('Användaren hittades inte.','USER_NOT_FOUND',404);
  const normalizedAccount=normalizeCustomerRefundLiabilityAccount(account);
  const normalizedReference=normalizeDecisionReference(decisionReference);
  const updatedAt=new Date().toISOString();
  db.prepare(`INSERT INTO company_accounting_settings(company_id,customer_refund_liability_account,customer_refund_decision_reference,updated_by,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET customer_refund_liability_account=excluded.customer_refund_liability_account,
      customer_refund_decision_reference=excluded.customer_refund_decision_reference,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(companyId,normalizedAccount,normalizedReference,updatedBy,updatedAt);
  return getAccountingSettings(db,companyId);
}
module.exports=Object.freeze({
  PROTECTED_REFUND_ACCOUNTS,
  initializeAccountingSettings,
  normalizeCustomerRefundLiabilityAccount,
  normalizeDecisionReference,
  getAccountingSettings,
  setCustomerRefundLiabilityAccount
});
