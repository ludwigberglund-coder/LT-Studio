'use strict';

const Accounting=require('../apps/api/accounting-store.js');
const SIE=require('./sie4i.js');
const accountConfig=require('../config/accounting-accounts.json');

function sieSourceError(message,code='SIE_SOURCE_ERROR'){
  const error=new Error(message);
  error.code=code;
  return error;
}
function text(value){return String(value??'').trim()}
function fiscalYear(value){
  const year=text(value);
  if(!/^\d{4}$/.test(year))throw sieSourceError('SIE-export kräver ett räkenskapsår med fyra siffror.','SIE_INVALID_FISCAL_YEAR');
  return year;
}
function companyType(value){
  const type=text(value).toUpperCase();
  if(!/^(?:AB|E|HB|KB|EK|KHF|BRF|BF|SF|I|S|X)$/.test(type)){
    throw sieSourceError('SIE-export kräver en uttrycklig giltig företagsform.','SIE_COMPANY_TYPE_REQUIRED');
  }
  return type;
}
function accountNames(){
  return Object.fromEntries((accountConfig.accounts||[]).map(row=>[String(row.number),String(row.name||'').trim()]).filter(([,name])=>name));
}
function assertDatabaseIntegrity(db){
  const row=db.prepare('PRAGMA integrity_check').get();
  if(!row||row.integrity_check!=='ok')throw sieSourceError('SQLite-databasen klarade inte integrity_check. SIE-export stoppades.','SIE_DATABASE_INTEGRITY_ERROR');
}
function storeFromDatabase(db,{companyId,fiscalYear:year,companyType:type}={}){
  const safeCompanyId=text(companyId);
  if(!safeCompanyId)throw sieSourceError('SIE-export kräver ett explicit företags-ID.','SIE_COMPANY_REQUIRED');
  const safeYear=fiscalYear(year);
  const safeType=companyType(type);
  assertDatabaseIntegrity(db);

  const company=db.prepare('SELECT id,legal_name AS legalName,org_number AS orgNumber FROM companies WHERE id=?').get(safeCompanyId);
  if(!company)throw sieSourceError('Företaget hittades inte i databasen.','SIE_COMPANY_NOT_FOUND');

  const entryIds=db.prepare(`SELECT id FROM accounting_entries
    WHERE company_id=? AND fiscal_year=?
    ORDER BY posting_date,series,sequence`).all(safeCompanyId,safeYear);
  if(!entryIds.length)throw sieSourceError('Det finns inga verifierade verifikationer för valt företag och räkenskapsår.','SIE_NO_ENTRIES');

  const journal=entryIds.map(({id})=>{
    const entry=Accounting.entryById(db,safeCompanyId,id);
    if(!entry)throw sieSourceError('En bokföringspost försvann under SIE-exporten. Export stoppades.','SIE_ENTRY_NOT_FOUND');
    if(entry.fiscalYear!==safeYear)throw sieSourceError('En verifierad bokföringspost ligger utanför valt räkenskapsår.','SIE_ENTRY_YEAR_MISMATCH');
    return {
      id:entry.id,
      series:entry.series,
      number:entry.number,
      date:entry.postingDate,
      description:entry.description,
      rows:entry.lines.map(line=>({
        account:line.account,
        text:line.text,
        debitOre:line.debitOre,
        creditOre:line.creditOre
      }))
    };
  });

  return Object.freeze({
    business:Object.freeze({
      name:company.legalName,
      orgNumber:company.orgNumber,
      companyType:safeType
    }),
    journal:Object.freeze(journal)
  });
}
function buildSie4iFromDatabase(db,options={}){
  const store=storeFromDatabase(db,options);
  return SIE.buildSie4i(store,{
    generatedAt:options.generatedAt,
    signature:options.signature||'LT Studio',
    programName:options.programName||'LT Studio',
    programVersion:options.programVersion||'0.1.0',
    currency:options.currency||'SEK',
    fiscalYear:fiscalYear(options.fiscalYear),
    companyType:companyType(options.companyType),
    accountNames:accountNames()
  });
}

module.exports=Object.freeze({
  assertDatabaseIntegrity,
  storeFromDatabase,
  buildSie4iFromDatabase,
  fiscalYear,
  companyType,
  accountNames
});
