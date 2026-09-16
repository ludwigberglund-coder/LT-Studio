'use strict';

const crypto=require('node:crypto');
const Accounting=require('./accounting-store.js');
function accountingAdminError(message,code='ACCOUNTING_ADMIN_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function validPeriod(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(v))}

function initializeAccountingAdmin(db){Accounting.initializeAccountingStore(db);db.exec(`
CREATE TABLE IF NOT EXISTS accounting_corrections(
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 original_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
 reversal_entry_id TEXT NOT NULL REFERENCES accounting_entries(id) ON DELETE RESTRICT,
 replacement_entry_id TEXT REFERENCES accounting_entries(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 UNIQUE(company_id,original_entry_id)
) STRICT;
CREATE TABLE IF NOT EXISTS period_unlock_requests(
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 period TEXT NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 requested_at TEXT NOT NULL,
 decided_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 decided_at TEXT,
 decision_reason TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_unlock_requests_company_status ON period_unlock_requests(company_id,status,requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unlock_requests_one_pending ON period_unlock_requests(company_id,period) WHERE status='pending';
`)}
function entryById(db,companyId,entryId){const row=db.prepare(`SELECT id,company_id AS companyId,fiscal_year AS fiscalYear,series,sequence,number,posting_date AS postingDate,description,source_type AS sourceType,source_id AS sourceId,created_by AS createdBy,created_at AS createdAt FROM accounting_entries WHERE company_id=? AND id=?`).get(companyId,entryId);if(!row)return null;return{...row,lines:db.prepare(`SELECT line_number AS lineNumber,account,line_text AS text,debit_ore AS debitOre,credit_ore AS creditOre FROM accounting_entry_lines WHERE entry_id=? ORDER BY line_number`).all(row.id)}}
function periodStatus(db,companyId,period){if(!validPeriod(period))throw accountingAdminError('Perioden måste anges som ÅÅÅÅ-MM.','INVALID_PERIOD');return db.prepare(`SELECT period,status,locked_by AS lockedBy,locked_at AS lockedAt FROM accounting_periods WHERE company_id=? AND period=?`).get(companyId,period)||{period,status:'open',lockedBy:null,lockedAt:null}}
function listPeriods(db,companyId,{year=''}={}){const pattern=/^\d{4}$/.test(text(year))?`${year}-%`:'%';return db.prepare(`SELECT period,status,locked_by AS lockedBy,locked_at AS lockedAt FROM accounting_periods WHERE company_id=? AND period LIKE ? ORDER BY period DESC`).all(companyId,pattern)}
function lockPeriod(db,{companyId,period,lockedBy}){const current=periodStatus(db,companyId,period);if(current.status==='locked')throw accountingAdminError('Perioden är redan låst.','PERIOD_ALREADY_LOCKED',409);const lockedAt=now();db.prepare(`INSERT INTO accounting_periods(company_id,period,status,locked_by,locked_at) VALUES(?,?,'locked',?,?) ON CONFLICT(company_id,period) DO UPDATE SET status='locked',locked_by=excluded.locked_by,locked_at=excluded.locked_at`).run(companyId,period,lockedBy,lockedAt);return periodStatus(db,companyId,period)}
function requestUnlock(db,{companyId,period,reason,requestedBy}){if(periodStatus(db,companyId,period).status!=='locked')throw accountingAdminError('Endast en låst period kan begäras upplåst.','PERIOD_NOT_LOCKED',409);const clean=text(reason);if(clean.length<5||clean.length>500)throw accountingAdminError('En tydlig orsak på 5–500 tecken krävs.','UNLOCK_REASON_REQUIRED');if(db.prepare(`SELECT 1 FROM period_unlock_requests WHERE company_id=? AND period=? AND status='pending'`).get(companyId,period))throw accountingAdminError('Det finns redan en väntande upplåsningsbegäran.','UNLOCK_ALREADY_PENDING',409);const requestId=id('unlock'),requestedAt=now();db.prepare(`INSERT INTO period_unlock_requests(id,company_id,period,reason,status,requested_by,requested_at) VALUES(?,?,?,?,'pending',?,?)`).run(requestId,companyId,period,clean,requestedBy,requestedAt);return unlockRequestById(db,companyId,requestId)}
function unlockRequestById(db,companyId,requestId){return db.prepare(`SELECT id,company_id AS companyId,period,reason,status,requested_by AS requestedBy,requested_at AS requestedAt,decided_by AS decidedBy,decided_at AS decidedAt,decision_reason AS decisionReason FROM period_unlock_requests WHERE company_id=? AND id=?`).get(companyId,requestId)||null}
function listUnlockRequests(db,companyId,{status='pending'}={}){const filter=['pending','approved','rejected','all'].includes(status)?status:'pending';const sql=`SELECT id,period,reason,status,requested_by AS requestedBy,requested_at AS requestedAt,decided_by AS decidedBy,decided_at AS decidedAt,decision_reason AS decisionReason FROM period_unlock_requests WHERE company_id=?${filter==='all'?'':' AND status=?'} ORDER BY requested_at DESC`;return filter==='all'?db.prepare(sql).all(companyId):db.prepare(sql).all(companyId,filter)}
function decideUnlock(db,{companyId,requestId,decidedBy,decision,decisionReason=''}){const req=unlockRequestById(db,companyId,requestId);if(!req)throw accountingAdminError('Upplåsningsbegäran hittades inte.','UNLOCK_REQUEST_NOT_FOUND',404);if(req.status!=='pending')throw accountingAdminError('Begäran är redan behandlad.','UNLOCK_ALREADY_DECIDED',409);if(req.requestedBy===decidedBy)throw accountingAdminError('Den som begärde upplåsningen får inte godkänna den själv.','SEPARATION_OF_DUTIES_FAILED',409);if(!['approved','rejected'].includes(decision))throw accountingAdminError('Beslutet är ogiltigt.','INVALID_UNLOCK_DECISION');const decidedAt=now();if(decision==='approved')db.prepare(`UPDATE accounting_periods SET status='open',locked_by=NULL,locked_at=NULL WHERE company_id=? AND period=? AND status='locked'`).run(companyId,req.period);db.prepare(`UPDATE period_unlock_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE company_id=? AND id=? AND status='pending'`).run(decision,decidedBy,decidedAt,text(decisionReason).slice(0,500)||null,companyId,requestId);return{request:unlockRequestById(db,companyId,requestId),period:periodStatus(db,companyId,req.period)}}
function correctionByOriginal(db,companyId,entryId){return db.prepare(`SELECT id,original_entry_id AS originalEntryId,reversal_entry_id AS reversalEntryId,replacement_entry_id AS replacementEntryId,reason,created_by AS createdBy,created_at AS createdAt FROM accounting_corrections WHERE company_id=? AND original_entry_id=?`).get(companyId,entryId)||null}
function listCorrections(db,companyId){return db.prepare(`SELECT id,original_entry_id AS originalEntryId,reversal_entry_id AS reversalEntryId,replacement_entry_id AS replacementEntryId,reason,created_by AS createdBy,created_at AS createdAt FROM accounting_corrections WHERE company_id=? ORDER BY created_at DESC`).all(companyId)}
function correctEntry(db,{companyId,entryId,postingDate,reason,replacementLines=null,createdBy}){const original=entryById(db,companyId,entryId);if(!original)throw accountingAdminError('Verifikationen hittades inte.','ENTRY_NOT_FOUND',404);if(correctionByOriginal(db,companyId,entryId))throw accountingAdminError('Verifikationen har redan rättats. Rätta i så fall den senaste rättelseverifikationen.','ENTRY_ALREADY_CORRECTED',409);const clean=text(reason);if(clean.length<5||clean.length>500)throw accountingAdminError('Rättelsen kräver en orsak på 5–500 tecken.','CORRECTION_REASON_REQUIRED');const correctionId=id('corr');const reversalLines=original.lines.map(line=>({account:line.account,text:`Rättelse av ${original.number}: ${line.text||original.description}`,debitOre:line.creditOre,creditOre:line.debitOre}));const reversal=Accounting.postEntry(db,{companyId,postingDate,description:`Motverifikation ${original.number} – ${clean}`,sourceType:'accounting-correction-reversal',sourceId:`${correctionId}:reversal`,createdBy,series:original.series,lines:reversalLines});let replacement=null;if(Array.isArray(replacementLines)&&replacementLines.length)replacement=Accounting.postEntry(db,{companyId,postingDate,description:`Rättelse ${original.number} – ${clean}`,sourceType:'accounting-correction-replacement',sourceId:`${correctionId}:replacement`,createdBy,series:original.series,lines:replacementLines});const createdAt=now();db.prepare(`INSERT INTO accounting_corrections(id,company_id,original_entry_id,reversal_entry_id,replacement_entry_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(correctionId,companyId,original.id,reversal.entry.id,replacement?.entry.id||null,clean,createdBy,createdAt);return{correction:correctionByOriginal(db,companyId,original.id),original,reversal:reversal.entry,replacement:replacement?.entry||null}}
module.exports=Object.freeze({initializeAccountingAdmin,entryById,periodStatus,listPeriods,lockPeriod,requestUnlock,unlockRequestById,listUnlockRequests,decideUnlock,correctionByOriginal,listCorrections,correctEntry,validPeriod});
