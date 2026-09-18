'use strict';

const crypto = require('node:crypto');
const {protectAppendOnly} = require('./history-guards.js');
function integrityError() {
  const error = new Error('Bokf\u00f6ringshistoriken klarade inte integritetskontrollen. Ingen historik har skrivits om. Kontakta systemansvarig.');
  error.code = 'STORED_ENTRY_INTEGRITY_ERROR';
  error.statusCode = 409;
  return error;
}
function readEntry(db, entryId) {
  const row = db.prepare(`SELECT id,company_id AS companyId,fiscal_year AS fiscalYear,series,sequence,number,
    posting_date AS postingDate,description,source_type AS sourceType,source_id AS sourceId,
    created_by AS createdBy,created_at AS createdAt FROM accounting_entries WHERE id=?`).get(entryId);
  if (!row) return null;
  return {...row, lines:db.prepare(`SELECT line_number AS lineNumber,account,line_text AS text,
    debit_ore AS debitOre,credit_ore AS creditOre FROM accounting_entry_lines WHERE entry_id=? ORDER BY line_number`).all(entryId)};
}
function digest(entry, validateLines) {
  if (!entry || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1 ||
      !/^[A-Z][A-Z0-9]{0,3}$/.test(entry.series) || entry.number !== `${entry.series}${entry.sequence}` ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.postingDate) || entry.fiscalYear !== entry.postingDate.slice(0, 4)) throw integrityError();
  const parsed = new Date(`${entry.postingDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== entry.postingDate) throw integrityError();
  if (!entry.id || !entry.companyId || !entry.createdBy || !entry.sourceType || !entry.sourceId || !entry.description ||
      !Number.isFinite(Date.parse(entry.createdAt))) throw integrityError();
  try { validateLines(entry.lines); } catch { throw integrityError(); }
  if (entry.lines.some((line, i) => line.lineNumber !== i + 1)) throw integrityError();
  // readEntry constructs properties in a fixed order. Hash the exact stored
  // values, including line text, not a re-normalized / re-trimmed rendition.
  return crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
}
function verifyEntry(db, entry, validateLines) {
  if (!entry) return null;
  const seal = db.prepare('SELECT line_count,content_sha256 FROM accounting_entry_seals WHERE entry_id=?').get(entry.id);
  if (!seal || seal.line_count !== entry.lines.length || seal.content_sha256 !== digest(entry, validateLines)) throw integrityError();
  return entry;
}
function sealEntry(db, entryId, validateLines) {
  const entry = readEntry(db, entryId);
  const hash = digest(entry, validateLines);
  db.prepare('INSERT INTO accounting_entry_seals(entry_id,line_count,content_sha256,sealed_at) VALUES(?,?,?,?)')
    .run(entryId, entry.lines.length, hash, new Date().toISOString());
  return entry;
}
function initialize(db, validateLines) {
  const savepoint = `history_install_${crypto.randomBytes(8).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const previouslyProtected = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounting_entry_seals'").get());
    db.exec(`CREATE TABLE IF NOT EXISTS accounting_entry_seals(
      entry_id TEXT PRIMARY KEY REFERENCES accounting_entries(id) ON DELETE RESTRICT,
      line_count INTEGER NOT NULL CHECK(line_count BETWEEN 2 AND 1000),
      content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
      sealed_at TEXT NOT NULL
    ) STRICT`);
    for (const {id} of db.prepare('SELECT id FROM accounting_entries').all()) {
      const entry = readEntry(db, id);
      const sealed = db.prepare('SELECT 1 FROM accounting_entry_seals WHERE entry_id=?').get(id);
      if (sealed) verifyEntry(db, entry, validateLines);
      else if (previouslyProtected) throw integrityError();
      else sealEntry(db, id, validateLines); // One-time, validated legacy baseline.
    }
    for (const table of ['accounting_entries', 'accounting_entry_lines', 'accounting_entry_seals']) protectAppendOnly(db, table);
    db.exec(`CREATE TRIGGER IF NOT EXISTS history_accounting_lines_sealed BEFORE INSERT ON accounting_entry_lines
      WHEN EXISTS (SELECT 1 FROM accounting_entry_seals WHERE entry_id=NEW.entry_id)
      BEGIN SELECT RAISE(ABORT, 'POSTED_LINES_IMMUTABLE'); END;`);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
    try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
    throw error;
  }
}
module.exports = Object.freeze({initialize, readEntry, sealEntry, verifyEntry});
