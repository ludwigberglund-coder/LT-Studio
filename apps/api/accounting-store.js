'use strict';

const crypto=require('node:crypto');

function accountingError(message,code='ACCOUNTING_STORE_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(value)))return false;const [y,m,d]=value.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d}
function initializeAccountingStore(db){db.exec(`
  CREATE TABLE IF NOT EXISTS accounting_periods(
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','locked')),
    locked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    locked_at TEXT,
    PRIMARY KEY(company_id,period)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS accounting_sequences(
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    series TEXT NOT NULL,
    fiscal_year TEXT NOT NULL,
    last_number INTEGER NOT NULL CHECK(last_number>=0),
    PRIMARY KEY(company_id,series,fiscal_year)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS accounting_entries(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    fiscal_year TEXT NOT NULL,
    series TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence>0),
    number TEXT NOT NULL,
    posting_date TEXT NOT NULL,
    description TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    UNIQUE(company_id,series,fiscal_year,sequence),
    UNIQUE(company_id,source_type,source_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS accounting_entry_lines(
    entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL CHECK(line_number>0),
    account TEXT NOT NULL,
    line_text TEXT NOT NULL DEFAULT '',
    debit_ore INTEGER NOT NULL DEFAULT 0 CHECK(debit_ore>=0),
    credit_ore INTEGER NOT NULL DEFAULT 0 CHECK(credit_ore>=0),
    PRIMARY KEY(entry_id,line_number),
    CHECK((debit_ore>0 AND credit_ore=0) OR (credit_ore>0 AND debit_ore=0))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_accounting_entries_company_date ON accounting_entries(company_id,posting_date,series,sequence);
`)}
function validateLines(lines){if(!Array.isArray(lines)||lines.length<2)throw accountingError('Verifikationen måste innehålla minst två rader.','INVALID_ENTRY');let debit=0,credit=0;const normalized=lines.map((line,index)=>{const account=text(line?.account);const debitOre=Number(line?.debitOre||0),creditOre=Number(line?.creditOre||0);if(!/^\d{4}$/.test(account))throw accountingError(`Rad ${index+1} har ogiltigt konto.`,'INVALID_ACCOUNT');if(!Number.isSafeInteger(debitOre)||!Number.isSafeInteger(creditOre)||debitOre<0||creditOre<0||(debitOre===0&&creditOre===0)||(debitOre>0&&creditOre>0))throw accountingError(`Rad ${index+1} har ogiltigt belopp.`,'INVALID_ENTRY_AMOUNT');debit+=debitOre;credit+=creditOre;return{account,text:text(line?.text).slice(0,240),debitOre,creditOre}});if(debit!==credit||debit<=0)throw accountingError('Verifikationen måste balansera i debet och kredit.','UNBALANCED_ENTRY');return{lines:normalized,debitOre:debit,creditOre:credit}}
function entryBySource(db,companyId,sourceType,sourceId){const row=db.prepare(`SELECT id,company_id AS companyId,fiscal_year AS fiscalYear,series,sequence,number,posting_date AS postingDate,description,source_type AS sourceType,source_id AS sourceId,created_by AS createdBy,created_at AS createdAt FROM accounting_entries WHERE company_id=? AND source_type=? AND source_id=?`).get(companyId,sourceType,sourceId);if(!row)return null;return{...row,lines:db.prepare(`SELECT line_number AS lineNumber,account,line_text AS text,debit_ore AS debitOre,credit_ore AS creditOre FROM accounting_entry_lines WHERE entry_id=? ORDER BY line_number`).all(row.id)}}
function postEntry(db,input){const companyId=text(input?.companyId),postingDate=text(input?.postingDate),description=text(input?.description),sourceType=text(input?.sourceType),sourceId=text(input?.sourceId),createdBy=text(input?.createdBy),series=text(input?.series||'A').toUpperCase();if(!companyId||!createdBy||!sourceType||!sourceId)throw accountingError('Företag, användare och källreferens krävs.','INVALID_ENTRY');if(!validDate(postingDate))throw accountingError('Bokföringsdatumet är ogiltigt.','INVALID_POSTING_DATE');if(description.length<3||description.length>240)throw accountingError('Verifikationstexten måste vara 3–240 tecken.','INVALID_DESCRIPTION');if(!/^[A-Z][A-Z0-9]{0,3}$/.test(series))throw accountingError('Verifikationsserien är ogiltig.','INVALID_SERIES');const existing=entryBySource(db,companyId,sourceType,sourceId);if(existing)return{entry:existing,duplicate:true};const period=postingDate.slice(0,7);const periodRow=db.prepare(`SELECT status FROM accounting_periods WHERE company_id=? AND period=?`).get(companyId,period);if(periodRow?.status==='locked')throw accountingError(`Bokföringsperioden ${period} är låst.`,'PERIOD_LOCKED',409);const validated=validateLines(input.lines);const year=postingDate.slice(0,4);const sequenceRow=db.prepare(`SELECT last_number AS lastNumber FROM accounting_sequences WHERE company_id=? AND series=? AND fiscal_year=?`).get(companyId,series,year);const sequence=Number(sequenceRow?.lastNumber||0)+1;if(sequenceRow)db.prepare(`UPDATE accounting_sequences SET last_number=? WHERE company_id=? AND series=? AND fiscal_year=?`).run(sequence,companyId,series,year);else db.prepare(`INSERT INTO accounting_sequences(company_id,series,fiscal_year,last_number) VALUES(?,?,?,?)`).run(companyId,series,year,sequence);const entryId=id('entry'),number=`${series}${sequence}`,createdAt=new Date().toISOString();db.prepare(`INSERT INTO accounting_entries(id,company_id,fiscal_year,series,sequence,number,posting_date,description,source_type,source_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId,companyId,year,series,sequence,number,postingDate,description,sourceType,sourceId,createdBy,createdAt);const stmt=db.prepare(`INSERT INTO accounting_entry_lines(entry_id,line_number,account,line_text,debit_ore,credit_ore) VALUES(?,?,?,?,?,?)`);validated.lines.forEach((line,index)=>stmt.run(entryId,index+1,line.account,line.text,line.debitOre,line.creditOre));return{entry:entryBySource(db,companyId,sourceType,sourceId),duplicate:false}}
function listEntries(db,companyId,{limit=200}={}){const safe=Math.max(1,Math.min(1000,Number(limit)||200));return db.prepare(`SELECT id,fiscal_year AS fiscalYear,series,sequence,number,posting_date AS postingDate,description,source_type AS sourceType,source_id AS sourceId,created_by AS createdBy,created_at AS createdAt FROM accounting_entries WHERE company_id=? ORDER BY posting_date DESC,series DESC,sequence DESC LIMIT ?`).all(companyId,safe)}
module.exports=Object.freeze({initializeAccountingStore,validateLines,entryBySource,postEntry,listEntries,validDate});
