'use strict';

const crypto=require('node:crypto');
const Accounting=require('./accounting-store.js');
const Db=require('./database.js');
const {protectAppendOnly}=require('./history-guards.js');
function accountingAdminError(message,code='ACCOUNTING_ADMIN_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function validPeriod(v){return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(v))}
function validOpeningYear(v){return /^(19|20|21)\d{2}$/.test(text(v))}
const OPENING_BALANCE_CONTROL_ACCOUNTS=new Set(['1510','2440']);

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
`);protectAppendOnly(db,'accounting_corrections')}
function entryById(db,companyId,entryId){return Accounting.entryById(db,companyId,entryId)}
function periodStatus(db,companyId,period){if(!validPeriod(period))throw accountingAdminError('Perioden måste anges som ÅÅÅÅ-MM.','INVALID_PERIOD');return db.prepare(`SELECT period,status,locked_by AS lockedBy,locked_at AS lockedAt FROM accounting_periods WHERE company_id=? AND period=?`).get(companyId,period)||{period,status:'open',lockedBy:null,lockedAt:null}}
function listPeriods(db,companyId,{year=''}={}){const pattern=/^\d{4}$/.test(text(year))?`${year}-%`:'%';return db.prepare(`SELECT period,status,locked_by AS lockedBy,locked_at AS lockedAt FROM accounting_periods WHERE company_id=? AND period LIKE ? ORDER BY period DESC`).all(companyId,pattern)}
function lockPeriod(db,{companyId,period,lockedBy}){const current=periodStatus(db,companyId,period);if(current.status==='locked')throw accountingAdminError('Perioden är redan låst.','PERIOD_ALREADY_LOCKED',409);const lockedAt=now();db.prepare(`INSERT INTO accounting_periods(company_id,period,status,locked_by,locked_at) VALUES(?,?,'locked',?,?) ON CONFLICT(company_id,period) DO UPDATE SET status='locked',locked_by=excluded.locked_by,locked_at=excluded.locked_at`).run(companyId,period,lockedBy,lockedAt);return periodStatus(db,companyId,period)}
function requestUnlock(db,{companyId,period,reason,requestedBy}){if(periodStatus(db,companyId,period).status!=='locked')throw accountingAdminError('Endast en låst period kan begäras upplåst.','PERIOD_NOT_LOCKED',409);const clean=text(reason);if(clean.length<5||clean.length>500)throw accountingAdminError('En tydlig orsak på 5–500 tecken krävs.','UNLOCK_REASON_REQUIRED');if(db.prepare(`SELECT 1 FROM period_unlock_requests WHERE company_id=? AND period=? AND status='pending'`).get(companyId,period))throw accountingAdminError('Det finns redan en väntande upplåsningsbegäran.','UNLOCK_ALREADY_PENDING',409);const requestId=id('unlock'),requestedAt=now();db.prepare(`INSERT INTO period_unlock_requests(id,company_id,period,reason,status,requested_by,requested_at) VALUES(?,?,?,?,'pending',?,?)`).run(requestId,companyId,period,clean,requestedBy,requestedAt);return unlockRequestById(db,companyId,requestId)}
function unlockRequestById(db,companyId,requestId){return db.prepare(`SELECT id,company_id AS companyId,period,reason,status,requested_by AS requestedBy,requested_at AS requestedAt,decided_by AS decidedBy,decided_at AS decidedAt,decision_reason AS decisionReason FROM period_unlock_requests WHERE company_id=? AND id=?`).get(companyId,requestId)||null}
function listUnlockRequests(db,companyId,{status='pending'}={}){const filter=['pending','approved','rejected','all'].includes(status)?status:'pending';const sql=`SELECT id,period,reason,status,requested_by AS requestedBy,requested_at AS requestedAt,decided_by AS decidedBy,decided_at AS decidedAt,decision_reason AS decisionReason FROM period_unlock_requests WHERE company_id=?${filter==='all'?'':' AND status=?'} ORDER BY requested_at DESC`;return filter==='all'?db.prepare(sql).all(companyId):db.prepare(sql).all(companyId,filter)}
function decideUnlock(db,{companyId,requestId,decidedBy,decision,decisionReason=''}){const req=unlockRequestById(db,companyId,requestId);if(!req)throw accountingAdminError('Upplåsningsbegäran hittades inte.','UNLOCK_REQUEST_NOT_FOUND',404);if(req.status!=='pending')throw accountingAdminError('Begäran är redan behandlad.','UNLOCK_ALREADY_DECIDED',409);if(req.requestedBy===decidedBy)throw accountingAdminError('Den som begärde upplåsningen får inte godkänna den själv.','SEPARATION_OF_DUTIES_FAILED',409);if(!['approved','rejected'].includes(decision))throw accountingAdminError('Beslutet är ogiltigt.','INVALID_UNLOCK_DECISION');const decidedAt=now();if(decision==='approved')db.prepare(`UPDATE accounting_periods SET status='open',locked_by=NULL,locked_at=NULL WHERE company_id=? AND period=? AND status='locked'`).run(companyId,req.period);db.prepare(`UPDATE period_unlock_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE company_id=? AND id=? AND status='pending'`).run(decision,decidedBy,decidedAt,text(decisionReason).slice(0,500)||null,companyId,requestId);return{request:unlockRequestById(db,companyId,requestId),period:periodStatus(db,companyId,req.period)}}
function openingBalanceByYear(db,companyId,year){
  if(!validOpeningYear(year))throw accountingAdminError('Året för ingående balans måste anges med fyra siffror.','INVALID_OPENING_BALANCE_YEAR');
  return Accounting.entryBySource(db,companyId,'opening-balance',text(year));
}
function validateOpeningBalanceLines(lines){
  if(!Array.isArray(lines)||lines.length<2)throw accountingAdminError('Ingående balans måste innehålla minst två rader.','INVALID_OPENING_BALANCE');
  for(const [index,line] of lines.entries()){
    const account=text(line?.account);
    if(!/^[12]\d{3}$/.test(account))throw accountingAdminError(`Rad ${index+1}: ingående balans får endast använda balanskonton i klass 1–2.`,'OPENING_BALANCE_ACCOUNT_NOT_ALLOWED',409);
    if(OPENING_BALANCE_CONTROL_ACCOUNTS.has(account))throw accountingAdminError(`Konto ${account} kräver reskontraunderlag och får inte importeras som en fristående ingående balans.`,'OPENING_BALANCE_SUBLEDGER_REQUIRED',409);
  }
  return Accounting.validateLines(lines).lines;
}
function importOpeningBalance(db,{companyId,year,postingDate,lines,createdBy}){
  const fiscalYear=text(year);
  if(!validOpeningYear(fiscalYear))throw accountingAdminError('Året för ingående balans måste anges med fyra siffror.','INVALID_OPENING_BALANCE_YEAR');
  const expectedDate=`${fiscalYear}-01-01`;
  if(text(postingDate)!==expectedDate)throw accountingAdminError(`Ingående balans för ${fiscalYear} måste bokföras ${expectedDate}.`,'INVALID_OPENING_BALANCE_DATE',409);
  const normalized=validateOpeningBalanceLines(lines);
  return Accounting.postEntry(db,{
    companyId,
    postingDate:expectedDate,
    description:`Ingående balans ${fiscalYear}`,
    sourceType:'opening-balance',
    sourceId:fiscalYear,
    createdBy,
    series:'IB',
    lines:normalized
  });
}
function correctionByOriginal(db,companyId,entryId){return db.prepare(`SELECT id,original_entry_id AS originalEntryId,reversal_entry_id AS reversalEntryId,replacement_entry_id AS replacementEntryId,reason,created_by AS createdBy,created_at AS createdAt FROM accounting_corrections WHERE company_id=? AND original_entry_id=?`).get(companyId,entryId)||null}
function listCorrections(db,companyId){return db.prepare(`SELECT id,original_entry_id AS originalEntryId,reversal_entry_id AS reversalEntryId,replacement_entry_id AS replacementEntryId,reason,created_by AS createdBy,created_at AS createdAt FROM accounting_corrections WHERE company_id=? ORDER BY created_at DESC`).all(companyId)}
function correctionPolicy(db, companyId, entryId, replacementLines = null) {
  const entry = entryById(db, companyId, entryId);
  if (!entry) throw accountingAdminError('Verifikationen hittades inte.', 'ENTRY_NOT_FOUND', 404);
  const denied = {allowed:false, code:'SOURCE_CORRECTION_REQUIRED', reason:'Denna post h\u00f6r till ett annat arbetsfl\u00f6de eller ber\u00f6r reskontran. En frist\u00e5ende motverifikation kan ge fel restbelopp. R\u00e4ttelsen m\u00e5ste hantera faktura eller betalning tillsammans med bokf\u00f6ringen. Den v\u00e4gen \u00e4r \u00e4nnu inte klar f\u00f6r pilot; kontakta redovisningsansvarig. Ingen bokf\u00f6ring gjordes.'};
  const affectsLedger = lines => (lines || []).some(line => /^(151|244)\d$/.test(String(line.account)));
  if (affectsLedger(entry.lines) || affectsLedger(replacementLines)) return denied;
  const visited = new Set();
  let current = entry;
  for (let depth = 0; depth < 100; depth++) {
    if (visited.has(current.id)) return denied;
    visited.add(current.id);
    if (['manual', 'manual-journal'].includes(current.sourceType)) return {allowed:true};
    if (!['accounting-correction-reversal','accounting-correction-replacement'].includes(current.sourceType)) return denied;
    const parent = db.prepare(`SELECT original_entry_id AS originalId FROM accounting_corrections
      WHERE company_id=? AND (reversal_entry_id=? OR replacement_entry_id=?)`).all(companyId, current.id, current.id);
    if (parent.length !== 1) return denied;
    current = entryById(db, companyId, parent[0].originalId);
    if (!current || affectsLedger(current.lines)) return denied;
  }
  return denied;
}
function correctEntry(db, {companyId,entryId,postingDate,reason,replacementLines=null,createdBy}) {
  const savepoint = `correction_${crypto.randomBytes(8).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const original = entryById(db, companyId, entryId);
    if (!original) throw accountingAdminError('Verifikationen hittades inte.', 'ENTRY_NOT_FOUND', 404);
    if (correctionByOriginal(db, companyId, entryId)) throw accountingAdminError('Verifikationen har redan r\u00e4ttats. Granska den senaste r\u00e4ttelsen ist\u00e4llet.', 'ENTRY_ALREADY_CORRECTED', 409);
    const clean = text(reason);
    if (clean.length < 5 || clean.length > 500) throw accountingAdminError('R\u00e4ttelsen kr\u00e4ver en orsak p\u00e5 5\u2013500 tecken.', 'CORRECTION_REASON_REQUIRED');
    if (replacementLines !== null && (!Array.isArray(replacementLines) || !replacementLines.length)) throw accountingAdminError('Ers\u00e4ttningsposten m\u00e5ste vara en komplett kontering eller utel\u00e4mnas.', 'INVALID_REPLACEMENT');
    if (replacementLines !== null) Accounting.validateLines(replacementLines);
    const policy = correctionPolicy(db, companyId, entryId, replacementLines);
    if (!policy.allowed) throw accountingAdminError(policy.reason, policy.code, 409);
    const correctionId = id('corr');
    const reversal = Accounting.postEntry(db, {
      companyId, postingDate, description:`Motverifikation ${original.number} - ${clean}`.slice(0,240),
      sourceType:'accounting-correction-reversal', sourceId:`${correctionId}:reversal`, createdBy, series:original.series,
      lines:original.lines.map(line => ({account:line.account, text:`R\u00e4ttelse av ${original.number}: ${line.text || original.description}`, debitOre:line.creditOre, creditOre:line.debitOre}))
    });
    const replacement = replacementLines === null ? null : Accounting.postEntry(db, {
      companyId, postingDate, description:`R\u00e4ttelse ${original.number} - ${clean}`.slice(0,240),
      sourceType:'accounting-correction-replacement', sourceId:`${correctionId}:replacement`, createdBy, series:original.series, lines:replacementLines
    });
    db.prepare(`INSERT INTO accounting_corrections(id,company_id,original_entry_id,reversal_entry_id,replacement_entry_id,reason,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(correctionId,companyId,original.id,reversal.entry.id,replacement?.entry.id || null,clean,createdBy,now());
    Db.appendAudit(db, {companyId,userId:createdBy,action:'ACCOUNTING_ENTRY_CORRECTED',entityType:'accounting-entry',entityId:original.id,
      details:{correctionId,reversalEntryId:reversal.entry.id,replacementEntryId:replacement?.entry.id || null,reason:clean}});
    const result={correction:correctionByOriginal(db,companyId,original.id),original,reversal:reversal.entry,replacement:replacement?.entry || null};
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);} catch {}
    try {db.exec(`RELEASE SAVEPOINT ${savepoint}`);} catch {}
    throw error;
  }
}
module.exports=Object.freeze({initializeAccountingAdmin,entryById,periodStatus,listPeriods,lockPeriod,requestUnlock,unlockRequestById,listUnlockRequests,decideUnlock,openingBalanceByYear,importOpeningBalance,validateOpeningBalanceLines,correctionByOriginal,listCorrections,correctEntry,correctionPolicy,validPeriod,validOpeningYear});
