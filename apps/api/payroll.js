'use strict';

const crypto=require('node:crypto');
const Accounting=require('./accounting-store.js');

function payrollError(message,code='PAYROLL_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function nowIso(){return new Date().toISOString()}
function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(text(v)))return false;const [y,m,d]=text(v).split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d}
function validPeriod(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(v))}

function initializePayroll(db){Accounting.initializeAccountingStore(db);db.exec(`
  CREATE TABLE IF NOT EXISTS payroll_runs(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    pay_date TEXT NOT NULL,
    source_name TEXT NOT NULL,
    gross_salary_ore INTEGER NOT NULL CHECK(gross_salary_ore>=0),
    withheld_tax_ore INTEGER NOT NULL CHECK(withheld_tax_ore>=0),
    employer_contributions_ore INTEGER NOT NULL CHECK(employer_contributions_ore>=0),
    net_pay_ore INTEGER NOT NULL CHECK(net_pay_ore>=0),
    vacation_liability_change_ore INTEGER NOT NULL DEFAULT 0,
    lines_json TEXT NOT NULL,
    journal_sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('validated','posted','rejected')),
    imported_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    imported_at TEXT NOT NULL,
    posted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    posted_at TEXT,
    accounting_entry_id TEXT,
    UNIQUE(company_id,period,source_name,journal_sha256)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_period ON payroll_runs(company_id,period,status);
`)}
function normalizeLines(lines){if(!Array.isArray(lines)||lines.length<2)throw payrollError('Lönejournalen måste innehålla minst två konteringsrader.','INVALID_PAYROLL_LINES');let debit=0,credit=0;const normalized=lines.map((line,index)=>{const account=text(line?.account),debitOre=Number(line?.debitOre||0),creditOre=Number(line?.creditOre||0);if(!/^\d{4}$/.test(account))throw payrollError(`Rad ${index+1} har ogiltigt konto.`,'INVALID_PAYROLL_ACCOUNT');if(!Number.isSafeInteger(debitOre)||!Number.isSafeInteger(creditOre)||debitOre<0||creditOre<0||(debitOre===0&&creditOre===0)||(debitOre>0&&creditOre>0))throw payrollError(`Rad ${index+1} har ogiltigt belopp.`,'INVALID_PAYROLL_AMOUNT');debit+=debitOre;credit+=creditOre;return{account,text:text(line?.text).slice(0,240),debitOre,creditOre}});if(debit!==credit||debit<=0)throw payrollError('Lönejournalen måste balansera exakt i debet och kredit.','UNBALANCED_PAYROLL_JOURNAL');return normalized}
function hashLines(lines){return crypto.createHash('sha256').update(JSON.stringify(lines)).digest('hex')}
function validateSummary(input){for(const key of ['grossSalaryOre','withheldTaxOre','employerContributionsOre','netPayOre','vacationLiabilityChangeOre']){const value=Number(input[key]||0);if(!Number.isSafeInteger(value)||(key!=='vacationLiabilityChangeOre'&&value<0))throw payrollError('Lönebelopp måste anges som heltal i ören.','INVALID_PAYROLL_SUMMARY')}if(Number(input.withheldTaxOre||0)>Number(input.grossSalaryOre||0))throw payrollError('Preliminär skatt kan inte vara större än bruttolönen.','INVALID_PAYROLL_SUMMARY');if(Number(input.netPayOre||0)>Number(input.grossSalaryOre||0))throw payrollError('Nettolön kan inte vara större än bruttolönen.','INVALID_PAYROLL_SUMMARY')}
function importRun(db,input){const companyId=text(input.companyId),period=text(input.period),payDate=text(input.payDate),sourceName=text(input.sourceName);if(!companyId||!validPeriod(period)||!validDate(payDate)||!sourceName||sourceName.length>120)throw payrollError('Företag, löneperiod, utbetalningsdatum och källa krävs.','INVALID_PAYROLL_RUN');validateSummary(input);const lines=normalizeLines(input.lines),journalSha256=hashLines(lines);const existing=db.prepare(`SELECT id FROM payroll_runs WHERE company_id=? AND period=? AND source_name=? AND journal_sha256=?`).get(companyId,period,sourceName,journalSha256);if(existing)throw payrollError('Samma lönejournal är redan importerad för perioden.','DUPLICATE_PAYROLL_RUN',409);const runId=input.id||id('payroll'),importedAt=nowIso();db.prepare(`INSERT INTO payroll_runs(id,company_id,period,pay_date,source_name,gross_salary_ore,withheld_tax_ore,employer_contributions_ore,net_pay_ore,vacation_liability_change_ore,lines_json,journal_sha256,status,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'validated',?,?)`).run(runId,companyId,period,payDate,sourceName,input.grossSalaryOre||0,input.withheldTaxOre||0,input.employerContributionsOre||0,input.netPayOre||0,input.vacationLiabilityChangeOre||0,JSON.stringify(lines),journalSha256,input.importedBy,importedAt);return runById(db,companyId,runId)}
function runById(db,companyId,runId){const row=db.prepare(`SELECT id,company_id AS companyId,period,pay_date AS payDate,source_name AS sourceName,gross_salary_ore AS grossSalaryOre,withheld_tax_ore AS withheldTaxOre,employer_contributions_ore AS employerContributionsOre,net_pay_ore AS netPayOre,vacation_liability_change_ore AS vacationLiabilityChangeOre,lines_json AS linesJson,journal_sha256 AS journalSha256,status,imported_by AS importedBy,imported_at AS importedAt,posted_by AS postedBy,posted_at AS postedAt,accounting_entry_id AS accountingEntryId FROM payroll_runs WHERE company_id=? AND id=?`).get(companyId,runId);return row?{...row,lines:JSON.parse(row.linesJson)}:null}
function listRuns(db,companyId,{period=''}={}){const rows=period?db.prepare(`SELECT id FROM payroll_runs WHERE company_id=? AND period=? ORDER BY imported_at DESC`).all(companyId,period):db.prepare(`SELECT id FROM payroll_runs WHERE company_id=? ORDER BY period DESC,imported_at DESC`).all(companyId);return rows.map(row=>runById(db,companyId,row.id))}
function postRun(db,{companyId,runId,postedBy}){const run=runById(db,companyId,runId);if(!run)throw payrollError('Lönekörningen hittades inte.','PAYROLL_RUN_NOT_FOUND',404);if(run.status==='posted')throw payrollError('Lönejournalen är redan bokförd.','PAYROLL_ALREADY_POSTED',409);if(run.status!=='validated')throw payrollError('Endast validerad lönejournal kan bokföras.','INVALID_PAYROLL_STATUS',409);const result=Accounting.postEntry(db,{companyId,postingDate:run.payDate,description:`Lönejournal ${run.period} – ${run.sourceName}`,sourceType:'payroll-run',sourceId:run.id,createdBy:postedBy,series:'L',lines:run.lines});if(result.duplicate)throw payrollError('Lönejournalen har redan en bokföringspost.','PAYROLL_ALREADY_POSTED',409);const postedAt=nowIso();db.prepare(`UPDATE payroll_runs SET status='posted',posted_by=?,posted_at=?,accounting_entry_id=? WHERE company_id=? AND id=? AND status='validated'`).run(postedBy,postedAt,result.entry.id,companyId,runId);return{run:runById(db,companyId,runId),entry:result.entry}}

module.exports=Object.freeze({initializePayroll,normalizeLines,hashLines,importRun,runById,listRuns,postRun,validPeriod});
