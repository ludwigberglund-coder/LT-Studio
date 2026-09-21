'use strict';

const crypto=require('node:crypto');
const Protection=require('./journal-protection.js');

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
`);Protection.initialize(db,validateLines)}
function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 1000) {
    throw accountingError('Verifikationen m\u00e5ste inneh\u00e5lla 2\u20131 000 rader.', 'INVALID_ENTRY');
  }
  let debit = 0n, credit = 0n;
  const normalized = lines.map((line, index) => {
    const account = text(line?.account);
    const debitOre = line?.debitOre ?? 0, creditOre = line?.creditOre ?? 0;
    if (!/^\d{4}$/.test(account)) throw accountingError(`Rad ${index + 1} har ogiltigt konto.`, 'INVALID_ACCOUNT');
    if (!Number.isSafeInteger(debitOre) || !Number.isSafeInteger(creditOre) || debitOre < 0 || creditOre < 0 ||
        (debitOre === 0 && creditOre === 0) || (debitOre > 0 && creditOre > 0)) {
      throw accountingError(`Rad ${index + 1} har ogiltigt belopp.`, 'INVALID_ENTRY_AMOUNT');
    }
    debit += BigInt(debitOre);
    credit += BigInt(creditOre);
    return {account, text: text(line?.text).slice(0, 240), debitOre, creditOre};
  });
  if (debit > BigInt(Number.MAX_SAFE_INTEGER) || credit > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw accountingError('Verifikationens totalbelopp \u00e4r f\u00f6r stort f\u00f6r s\u00e4ker \u00f6resber\u00e4kning.', 'ENTRY_TOTAL_TOO_LARGE');
  }
  if (debit !== credit || debit <= 0n) throw accountingError('Verifikationen m\u00e5ste balansera i debet och kredit.', 'UNBALANCED_ENTRY');
  return {lines: normalized, debitOre: Number(debit), creditOre: Number(credit)};
}

// Standalone posting takes SQLite's write lock before reading the sequence.
// When a caller already owns a transaction, a savepoint preserves the caller's
// commit/rollback boundary instead of committing unrelated business work.
function atomicPosting(db, callback) {
  if (db.isTransaction !== true) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  const savepoint = `accounting_post_${crypto.randomBytes(12).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = callback();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    // Some I/O errors make SQLite roll back the whole transaction itself.
    // Preserve the original error if the savepoint no longer exists.
    try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
    try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
    throw error;
  }
}

function verifyRetry(existing, requested, validated) {
  let stored;
  try { stored = validateLines(existing.lines); }
  catch { throw accountingError('Den befintliga verifikationen \u00e4r ofullst\u00e4ndig eller obalanserad. Granskning kr\u00e4vs.', 'STORED_ENTRY_INTEGRITY_ERROR', 409); }
  if (existing.number !== `${existing.series}${existing.sequence}` || existing.fiscalYear !== existing.postingDate.slice(0, 4)) {
    throw accountingError('Den befintliga verifikationens nummer eller r\u00e4kenskaps\u00e5r \u00e4r inkonsekvent.', 'STORED_ENTRY_INTEGRITY_ERROR', 409);
  }
  if (existing.postingDate !== requested.postingDate || existing.series !== requested.series ||
      existing.description !== requested.description || JSON.stringify(stored.lines) !== JSON.stringify(validated.lines)) {
    throw accountingError('K\u00e4llan \u00e4r redan bokf\u00f6rd med andra uppgifter. Ingen ny bokf\u00f6ring gjordes. Kontrollera originalet och anv\u00e4nd r\u00e4ttelsefl\u00f6det.', 'IDEMPOTENCY_CONFLICT', 409);
  }
}

function entryById(db, companyId, entryId) {
  const owned = db.prepare('SELECT id FROM accounting_entries WHERE company_id=? AND id=?').get(companyId, entryId);
  return owned ? Protection.verifyEntry(db, Protection.readEntry(db, owned.id), validateLines) : null;
}
function entryBySource(db, companyId, sourceType, sourceId) {
  const row = db.prepare('SELECT id FROM accounting_entries WHERE company_id=? AND source_type=? AND source_id=?').get(companyId, sourceType, sourceId);
  return row ? entryById(db, companyId, row.id) : null;
}
function postEntry(db, input) {
  const companyId = text(input?.companyId), postingDate = text(input?.postingDate), description = text(input?.description);
  const sourceType = text(input?.sourceType), sourceId = text(input?.sourceId), createdBy = text(input?.createdBy);
  const series = text(input?.series || 'A').toUpperCase();
  if (!companyId || !createdBy || !sourceType || !sourceId) throw accountingError('F\u00f6retag, anv\u00e4ndare och k\u00e4llreferens kr\u00e4vs.', 'INVALID_ENTRY');
  if (!validDate(postingDate)) throw accountingError('Bokf\u00f6ringsdatumet \u00e4r ogiltigt.', 'INVALID_POSTING_DATE');
  if (description.length < 3 || description.length > 240) throw accountingError('Verifikationstexten m\u00e5ste vara 3\u2013240 tecken.', 'INVALID_DESCRIPTION');
  if (!/^[A-Z][A-Z0-9]{0,3}$/.test(series)) throw accountingError('Verifikationsserien \u00e4r ogiltig.', 'INVALID_SERIES');
  const validated = validateLines(input.lines);
  return atomicPosting(db, () => {
    const existing = entryBySource(db, companyId, sourceType, sourceId);
    if (existing) {
      verifyRetry(existing, {postingDate, description, series}, validated);
      return {entry: existing, duplicate: true};
    }
    const period = postingDate.slice(0, 7);
    const periodRow = db.prepare('SELECT status FROM accounting_periods WHERE company_id=? AND period=?').get(companyId, period);
    if (periodRow?.status === 'locked') throw accountingError(`Bokf\u00f6ringsperioden ${period} \u00e4r l\u00e5st.`, 'PERIOD_LOCKED', 409);
    const year = postingDate.slice(0, 4);
    const sequenceRow = db.prepare('SELECT last_number AS lastNumber FROM accounting_sequences WHERE company_id=? AND series=? AND fiscal_year=?').get(companyId, series, year);
    const lastNumber = sequenceRow?.lastNumber ?? 0;
    if (!Number.isSafeInteger(lastNumber) || lastNumber < 0 || lastNumber >= Number.MAX_SAFE_INTEGER) {
      throw accountingError('Verifikationsserien kan inte r\u00e4knas upp s\u00e4kert.', 'INVALID_SEQUENCE', 409);
    }
    const sequence = lastNumber + 1;
    if (sequenceRow) db.prepare('UPDATE accounting_sequences SET last_number=? WHERE company_id=? AND series=? AND fiscal_year=?').run(sequence, companyId, series, year);
    else db.prepare('INSERT INTO accounting_sequences(company_id,series,fiscal_year,last_number) VALUES(?,?,?,?)').run(companyId, series, year, sequence);
    const entryId = id('entry'), number = `${series}${sequence}`, createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO accounting_entries(id,company_id,fiscal_year,series,sequence,number,posting_date,description,source_type,source_id,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId, companyId, year, series, sequence, number, postingDate, description, sourceType, sourceId, createdBy, createdAt);
    const statement = db.prepare('INSERT INTO accounting_entry_lines(entry_id,line_number,account,line_text,debit_ore,credit_ore) VALUES(?,?,?,?,?,?)');
    validated.lines.forEach((line, index) => statement.run(entryId, index + 1, line.account, line.text, line.debitOre, line.creditOre));
    Protection.sealEntry(db, entryId, validateLines);
    return {entry: entryBySource(db, companyId, sourceType, sourceId), duplicate: false};
  });
}
function listEntries(db,companyId,{limit=200}={}){const safe=Math.max(1,Math.min(1000,Number(limit)||200));return db.prepare(`SELECT id,fiscal_year AS fiscalYear,series,sequence,number,posting_date AS postingDate,description,source_type AS sourceType,source_id AS sourceId,created_by AS createdBy,created_at AS createdAt FROM accounting_entries WHERE company_id=? ORDER BY posting_date DESC,series DESC,sequence DESC LIMIT ?`).all(companyId,safe)}
module.exports=Object.freeze({initializeAccountingStore,validateLines,entryById,entryBySource,postEntry,listEntries,validDate});
