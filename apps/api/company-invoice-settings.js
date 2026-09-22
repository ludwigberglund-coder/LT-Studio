'use strict';

function settingsError(message,code='INVOICE_SETTINGS_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function text(value){return String(value??'').trim()}
function hasColumn(db,name){return db.prepare('PRAGMA table_info(company_invoice_settings)').all().some(row=>row.name===name)}
function initializeInvoiceSettings(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_invoice_settings(
      company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      bankgiro TEXT NOT NULL,
      tax_status TEXT NOT NULL,
      vat_number TEXT,
      address TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  for(const [name,type] of [['vat_number','TEXT'],['address','TEXT'],['email','TEXT'],['phone','TEXT'],['website','TEXT']]){
    if(!hasColumn(db,name))db.exec(`ALTER TABLE company_invoice_settings ADD COLUMN ${name} ${type}`);
  }
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
function normalizeVatNumber(value){
  const normalized=text(value).toUpperCase().replace(/[\s-]+/g,'');
  if(!/^SE\d{12}$/.test(normalized))throw settingsError('Svenskt VAT-nummer måste anges som SE följt av 12 siffror.','INVALID_VAT_NUMBER');
  return normalized;
}
function expectedVatNumberForOrgNumber(orgNumber){
  const digits=text(orgNumber).replace(/\D/g,'');
  if(!/^\d{10}$/.test(digits))throw settingsError('Företagets organisationsnummer kan inte användas för VAT-verifiering.','INVALID_COMPANY_ORG_NUMBER');
  return `SE${digits}01`;
}
function vatNumberMatchesOrgNumber(vatNumber,orgNumber){
  try{return normalizeVatNumber(vatNumber)===expectedVatNumberForOrgNumber(orgNumber)}
  catch{return false}
}
function normalizeAddress(value){
  const result=text(value);
  if(result.length<5||result.length>500)throw settingsError('Företagets adress måste vara 5–500 tecken.','INVALID_COMPANY_ADDRESS');
  return result;
}
function normalizeEmail(value){
  const result=text(value);
  if(result.length>254||(result&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)))throw settingsError('Företagets e-postadress har ogiltigt format.','INVALID_COMPANY_EMAIL');
  return result;
}
function normalizePhone(value){
  const result=text(value);
  if(result.length>60)throw settingsError('Företagets telefonnummer är för långt.','INVALID_COMPANY_PHONE');
  return result;
}
function normalizeWebsite(value){
  const result=text(value);
  if(!result)return '';
  if(result.length>240)throw settingsError('Webbadressen är för lång.','INVALID_COMPANY_WEBSITE');
  let url;try{url=new URL(result)}catch{throw settingsError('Webbadressen måste vara en giltig http- eller https-adress.','INVALID_COMPANY_WEBSITE')}
  if(!['http:','https:'].includes(url.protocol))throw settingsError('Webbadressen måste börja med http:// eller https://.','INVALID_COMPANY_WEBSITE');
  return url.toString();
}
function getInvoiceSettings(db,companyId){
  initializeInvoiceSettings(db);
  return db.prepare(`SELECT company_id AS companyId,bankgiro,tax_status AS taxStatus,vat_number AS vatNumber,address,email,phone,website,updated_by AS updatedBy,updated_at AS updatedAt
    FROM company_invoice_settings WHERE company_id=?`).get(companyId)||null;
}
function checkedInvoiceValues(db,{companyId,bankgiro,taxStatus,vatNumber}){
  const company=db.prepare('SELECT org_number AS orgNumber FROM companies WHERE id=?').get(companyId);
  if(!company)throw settingsError('Företaget hittades inte.','COMPANY_NOT_FOUND',404);
  const normalizedBankgiro=normalizeBankgiro(bankgiro);
  const normalizedTaxStatus=normalizeTaxStatus(taxStatus);
  const normalizedVatNumber=normalizeVatNumber(vatNumber);
  const expectedVatNumber=expectedVatNumberForOrgNumber(company.orgNumber);
  if(normalizedVatNumber!==expectedVatNumber)throw settingsError('VAT-numret matchar inte företagets organisationsnummer.','VAT_NUMBER_COMPANY_MISMATCH');
  return{bankgiro:normalizedBankgiro,taxStatus:normalizedTaxStatus,vatNumber:normalizedVatNumber};
}
function setInvoiceSettings(db,{companyId,bankgiro,taxStatus,vatNumber,updatedBy}){
  initializeInvoiceSettings(db);
  const normalized=checkedInvoiceValues(db,{companyId,bankgiro,taxStatus,vatNumber});
  const updatedAt=new Date().toISOString();
  db.prepare(`INSERT INTO company_invoice_settings(company_id,bankgiro,tax_status,vat_number,updated_by,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET bankgiro=excluded.bankgiro,tax_status=excluded.tax_status,vat_number=excluded.vat_number,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(companyId,normalized.bankgiro,normalized.taxStatus,normalized.vatNumber,updatedBy,updatedAt);
  return getInvoiceSettings(db,companyId);
}
function setCompanySettings(db,{companyId,address,email='',phone='',website='',bankgiro,taxStatus,vatNumber,updatedBy}){
  initializeInvoiceSettings(db);
  const normalized=checkedInvoiceValues(db,{companyId,bankgiro,taxStatus,vatNumber});
  const values={
    address:normalizeAddress(address),
    email:normalizeEmail(email),
    phone:normalizePhone(phone),
    website:normalizeWebsite(website)
  };
  const updatedAt=new Date().toISOString();
  db.prepare(`INSERT INTO company_invoice_settings(company_id,bankgiro,tax_status,vat_number,address,email,phone,website,updated_by,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET
      bankgiro=excluded.bankgiro,tax_status=excluded.tax_status,vat_number=excluded.vat_number,address=excluded.address,
      email=excluded.email,phone=excluded.phone,website=excluded.website,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .run(companyId,normalized.bankgiro,normalized.taxStatus,normalized.vatNumber,values.address,values.email||null,values.phone||null,values.website||null,updatedBy,updatedAt);
  return getInvoiceSettings(db,companyId);
}
function privateProfile(db,companyId,publicProfile={}){
  const stored=getInvoiceSettings(db,companyId);
  const company=db.prepare('SELECT legal_name AS legalName,display_name AS displayName,org_number AS orgNumber FROM companies WHERE id=?').get(companyId);
  const base={
    ...publicProfile,
    legalName:company?.legalName||text(publicProfile.legalName),
    displayName:company?.displayName||text(publicProfile.displayName),
    orgNumber:company?.orgNumber||text(publicProfile.orgNumber),
    address:{...(typeof publicProfile.address==='object'?publicProfile.address:{})},
    contact:{...(publicProfile.contact||{})},
    invoice:{...(publicProfile.invoice||{})}
  };
  if(stored){
    base.invoice.bankgiro=stored.bankgiro;
    base.invoice.taxStatus=stored.taxStatus;
    base.vatNumber=stored.vatNumber||'';
    base.address={...base.address,full:stored.address||''};
    base.contact={...base.contact,email:stored.email||'',phone:stored.phone||''};
    base.website=stored.website||'';
  }else{
    base.invoice.bankgiro='';
    base.invoice.taxStatus='';
  }
  return{profile:base,configured:Boolean(stored&&stored.bankgiro&&stored.taxStatus&&stored.vatNumber&&stored.address)};
}
module.exports=Object.freeze({
  initializeInvoiceSettings,normalizeBankgiro,normalizeTaxStatus,normalizeVatNumber,expectedVatNumberForOrgNumber,vatNumberMatchesOrgNumber,
  normalizeAddress,normalizeEmail,normalizePhone,normalizeWebsite,getInvoiceSettings,setInvoiceSettings,setCompanySettings,privateProfile
});
