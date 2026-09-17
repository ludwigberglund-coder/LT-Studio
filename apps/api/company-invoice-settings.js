'use strict';

function settingsError(message,code='INVOICE_SETTINGS_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function initializeInvoiceSettings(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_invoice_settings(
      company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      bankgiro TEXT NOT NULL,
      tax_status TEXT NOT NULL,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
}
function normalizeBankgiro(value){
  const raw=text(value).replace(/^BG\s*/i,'').replace(/\s+/g,'');
  if(/demo|ej-betalning/i.test(raw))throw settingsError('Bankgiro får inte vara ett demo- eller testvärde.','INVALID_BANKGIRO');
  const digits=raw.replace(/-/g,'');
  if(!/^\d{7,8}$/.test(digits))throw settingsError('Bankgiro måste innehålla 7–8 siffror.','INVALID_BANKGIRO');
  return digits.length===7?`${digits.slice(0,3)}-${digits.slice(3)}`:`${digits.slice(0,4)}-${digits.slice(4)}`;
}
function normalizeTaxStatus(value){
  const result=text(value);
  if(result.length<3||result.length>120)throw settingsError('Skattestatus måste vara 3–120 tecken.','INVALID_TAX_STATUS');
  if(/demo|verifiera/i.test(result))throw settingsError('Skattestatus får inte vara markerad som demo eller overifierad.','INVALID_TAX_STATUS');
  return result;
}
function getInvoiceSettings(db,companyId){
  initializeInvoiceSettings(db);
  return db.prepare(`SELECT company_id AS companyId,bankgiro,tax_status AS taxStatus,updated_by AS updatedBy,updated_at AS updatedAt
    FROM company_invoice_settings WHERE company_id=?`).get(companyId)||null;
}
function setInvoiceSettings(db,{companyId,bankgiro,taxStatus,updatedBy}){
  initializeInvoiceSettings(db);
  const normalizedBankgiro=normalizeBankgiro(bankgiro),normalizedTaxStatus=normalizeTaxStatus(taxStatus),updatedAt=new Date().toISOString();
  db.prepare(`INSERT INTO company_invoice_settings(company_id,bankgiro,tax_status,updated_by,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET bankgiro=excluded.bankgiro,tax_status=excluded.tax_status,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(companyId,normalizedBankgiro,normalizedTaxStatus,updatedBy,updatedAt);
  return getInvoiceSettings(db,companyId);
}
function privateProfile(db,companyId,publicProfile={}){
  const stored=getInvoiceSettings(db,companyId);
  const base={...publicProfile,invoice:{...(publicProfile.invoice||{})}};
  if(stored){base.invoice.bankgiro=stored.bankgiro;base.invoice.taxStatus=stored.taxStatus;}
  else{base.invoice.bankgiro='';base.invoice.taxStatus='';}
  return{profile:base,configured:Boolean(stored)};
}
module.exports=Object.freeze({initializeInvoiceSettings,normalizeBankgiro,normalizeTaxStatus,getInvoiceSettings,setInvoiceSettings,privateProfile});
