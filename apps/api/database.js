'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');

function databaseError(message, code = 'DATABASE_ERROR', statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), {recursive:true, mode:0o700});
  }
  const db = new DatabaseSync(filename, {timeout:5000});
  db.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  try {
    initializeSchema(db);
    require('./tenant-integrity.js').installTenantGuards(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      legal_name TEXT NOT NULL,
      org_number TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      mfa_secret_encrypted TEXT,
      disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS memberships (
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      roles_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(company_id,user_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS mfa_used_steps (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      totp_counter INTEGER NOT NULL,
      used_at TEXT NOT NULL,
      PRIMARY KEY(user_id,totp_counter)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      customer_number TEXT NOT NULL,
      name TEXT NOT NULL,
      org_number TEXT,
      email TEXT,
      address_json TEXT NOT NULL DEFAULT '{}',
      customer_type TEXT NOT NULL DEFAULT 'business' CHECK(customer_type IN ('business','consumer','public-body')),
      reminder_fee_agreed INTEGER NOT NULL DEFAULT 0 CHECK(reminder_fee_agreed IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id,customer_number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      invoice_number TEXT NOT NULL,
      ocr TEXT,
      invoice_date TEXT NOT NULL,
      posting_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      total_ore INTEGER NOT NULL,
      remaining_ore INTEGER NOT NULL,
      vat_ore INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      payment_method TEXT,
      payment_account TEXT,
      invoice_account TEXT NOT NULL DEFAULT '1510',
      batch_number TEXT,
      journal_number TEXT,
      pdf_sha256 TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id,invoice_number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS invoice_transactions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      transaction_type TEXT NOT NULL,
      payment_method TEXT,
      payment_date TEXT,
      posting_date TEXT,
      batch_number TEXT,
      journal_number TEXT,
      amount_ore INTEGER,
      approved INTEGER NOT NULL DEFAULT 1 CHECK(approved IN (0,1)),
      account TEXT,
      bank_reference TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(company_id, bank_reference)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS invoice_comments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS invoice_reminders (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN ('payment-reminder','escalation')),
      sent_at TEXT NOT NULL,
      reminder_date TEXT,
      rate_config_version TEXT NOT NULL DEFAULT '',
      rate_verified_at TEXT NOT NULL DEFAULT '',
      principal_ore INTEGER NOT NULL,
      reminder_fee_ore INTEGER NOT NULL DEFAULT 0,
      interest_ore INTEGER NOT NULL DEFAULT 0,
      business_compensation_ore INTEGER NOT NULL DEFAULT 0,
      total_due_ore INTEGER NOT NULL,
      annual_rate_basis_points INTEGER NOT NULL,
      interest_segments_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_invoices_company_due ON invoices(company_id,due_date);
    CREATE INDEX IF NOT EXISTS idx_comments_invoice ON invoice_comments(company_id,invoice_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_invoice ON invoice_reminders(company_id,invoice_id,sent_at);
    CREATE INDEX IF NOT EXISTS idx_audit_company_created ON audit_events(company_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_absolute_expiry ON sessions(absolute_expires_at);
    CREATE INDEX IF NOT EXISTS idx_mfa_used_steps_used_at ON mfa_used_steps(used_at);
  `);
  if (!hasColumn(db,'sessions','absolute_expires_at')) {
    db.exec("ALTER TABLE sessions ADD COLUMN absolute_expires_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE sessions SET absolute_expires_at=expires_at WHERE absolute_expires_at=''");
  }
  if (!hasColumn(db,'invoice_reminders','reminder_date')) db.exec('ALTER TABLE invoice_reminders ADD COLUMN reminder_date TEXT');
  if (!hasColumn(db,'invoice_reminders','rate_config_version')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN rate_config_version TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db,'invoice_reminders','rate_verified_at')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN rate_verified_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE invoice_reminders SET reminder_date=substr(sent_at,1,10) WHERE reminder_date IS NULL OR reminder_date=''");
  require('./history-guards.js').protectAppendOnly(db, 'audit_events');
}

function hasColumn(db, tableName, columnName) {
  if (!/^[a-z_]+$/.test(tableName)) throw databaseError('Ogiltigt tabellnamn vid schemakontroll.','INVALID_SCHEMA_NAME');
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some(row => row.name === columnName);
}

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = callback();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function jsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function createCompany(db, {id: companyId = id('company'), legalName, displayName = legalName, orgNumber}) {
  const createdAt = nowIso();
  db.prepare('INSERT INTO companies(id,legal_name,org_number,display_name,created_at) VALUES(?,?,?,?,?)')
    .run(companyId, String(legalName || '').trim(), String(orgNumber || '').trim(), String(displayName || legalName || '').trim(), createdAt);
  return companyById(db, companyId);
}

function companyById(db, companyId) {
  return db.prepare('SELECT id,legal_name AS legalName,org_number AS orgNumber,display_name AS displayName,created_at AS createdAt FROM companies WHERE id=?').get(companyId) || null;
}

function createUser(db, {id: userId = id('user'), username, displayName, passwordHash, mfaSecretEncrypted = null, disabled = false}) {
  const createdAt = nowIso();
  db.prepare('INSERT INTO users(id,username,display_name,password_hash,mfa_secret_encrypted,disabled,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(userId, username, String(displayName || '').trim(), passwordHash, mfaSecretEncrypted, disabled ? 1 : 0, createdAt);
  return userById(db, userId);
}

function userById(db, userId) {
  return db.prepare('SELECT id,username,display_name AS displayName,password_hash AS passwordHash,mfa_secret_encrypted AS mfaSecretEncrypted,disabled,created_at AS createdAt FROM users WHERE id=?').get(userId) || null;
}

function userByUsername(db, username) {
  return db.prepare('SELECT id,username,display_name AS displayName,password_hash AS passwordHash,mfa_secret_encrypted AS mfaSecretEncrypted,disabled,created_at AS createdAt FROM users WHERE username=?').get(username) || null;
}

function addMembership(db, {companyId,userId,roles}) {
  const uniqueRoles = [...new Set((roles || []).map(String))];
  db.prepare('INSERT OR REPLACE INTO memberships(company_id,user_id,roles_json,created_at) VALUES(?,?,?,?)')
    .run(companyId,userId,JSON.stringify(uniqueRoles),nowIso());
  return membership(db, companyId, userId);
}

function membership(db, companyId, userId) {
  const row = db.prepare('SELECT company_id AS companyId,user_id AS userId,roles_json AS rolesJson,created_at AS createdAt FROM memberships WHERE company_id=? AND user_id=?').get(companyId,userId);
  return row ? {...row, roles:jsonParse(row.rolesJson,[])} : null;
}

function membershipsForUser(db, userId) {
  return db.prepare(`SELECT m.company_id AS companyId,c.legal_name AS legalName,c.display_name AS displayName,m.roles_json AS rolesJson
    FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=? ORDER BY c.display_name`).all(userId)
    .map(row => ({...row, roles:jsonParse(row.rolesJson,[])}));
}

function createSession(db, {tokenHash,csrfHash,userId,companyId,expiresAt,absoluteExpiresAt = expiresAt}) {
  const now = nowIso();
  if (!absoluteExpiresAt || absoluteExpiresAt < expiresAt) throw databaseError('Sessionens absoluta sluttid måste vara minst lika sen som inaktivitetsgränsen.','INVALID_SESSION_EXPIRY',500);
  db.prepare('DELETE FROM sessions WHERE expires_at<=? OR absolute_expires_at<=?').run(now,now);
  db.prepare('INSERT INTO sessions(token_hash,csrf_hash,user_id,company_id,created_at,expires_at,absolute_expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(tokenHash,csrfHash,userId,companyId,now,expiresAt,absoluteExpiresAt,now);
}

function sessionByTokenHash(db, tokenHash) {
  const now = nowIso();
  const row = db.prepare(`SELECT s.token_hash AS tokenHash,s.csrf_hash AS csrfHash,s.user_id AS userId,s.company_id AS companyId,
      s.expires_at AS expiresAt,s.absolute_expires_at AS absoluteExpiresAt,s.created_at AS createdAt,s.last_seen_at AS lastSeenAt,
      u.username,u.display_name AS displayName,u.disabled,m.roles_json AS rolesJson
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.company_id=s.company_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.absolute_expires_at>?`).get(tokenHash,now,now);
  if (!row) return null;
  return {...row, roles:jsonParse(row.rolesJson,[])};
}

function touchSession(db, tokenHash, requestedExpiresAt) {
  const now=nowIso();
  db.prepare(`UPDATE sessions
    SET last_seen_at=?,
        expires_at=CASE WHEN absolute_expires_at<? THEN absolute_expires_at ELSE ? END
    WHERE token_hash=? AND absolute_expires_at>?`).run(now,requestedExpiresAt,requestedExpiresAt,tokenHash,now);
}

function consumeMfaStep(db,{userId,totpCounter}) {
  if (!userId || !Number.isSafeInteger(totpCounter) || totpCounter < 0) throw databaseError('Ogiltig MFA-tidslucka.','INVALID_MFA_COUNTER',500);
  const now=nowIso();
  db.prepare("DELETE FROM mfa_used_steps WHERE used_at < datetime('now','-2 days')").run();
  try {
    db.prepare('INSERT INTO mfa_used_steps(user_id,totp_counter,used_at) VALUES(?,?,?)').run(userId,totpCounter,now);
  } catch (error) {
    if (String(error.code||'').includes('CONSTRAINT')) throw databaseError('MFA-koden har redan använts. Vänta på nästa kod och försök igen.','MFA_CODE_REPLAYED',409);
    throw error;
  }
  return {userId,totpCounter,usedAt:now};
}

function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
}

function createCustomer(db, input) {
  const createdAt = nowIso();
  const customerId = input.id || id('customer');
  db.prepare(`INSERT INTO customers(id,company_id,customer_number,name,org_number,email,address_json,customer_type,reminder_fee_agreed,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      customerId,input.companyId,String(input.customerNumber || '').trim(),String(input.name || '').trim(),input.orgNumber || null,input.email || null,
      JSON.stringify(input.address || {}),input.customerType || 'business',input.reminderFeeAgreed ? 1 : 0,createdAt,createdAt
    );
  return customerById(db,input.companyId,customerId);
}

function customerById(db, companyId, customerId) {
  const row = db.prepare(`SELECT id,company_id AS companyId,customer_number AS customerNumber,name,org_number AS orgNumber,email,address_json AS addressJson,
    customer_type AS customerType,reminder_fee_agreed AS reminderFeeAgreed,created_at AS createdAt,updated_at AS updatedAt
    FROM customers WHERE company_id=? AND id=?`).get(companyId,customerId);
  return row ? {...row,address:jsonParse(row.addressJson,{}),reminderFeeAgreed:Boolean(row.reminderFeeAgreed)} : null;
}

function listCustomers(db,companyId) {
  return db.prepare(`SELECT id,company_id AS companyId,customer_number AS customerNumber,name,org_number AS orgNumber,email,address_json AS addressJson,
    customer_type AS customerType,reminder_fee_agreed AS reminderFeeAgreed,created_at AS createdAt,updated_at AS updatedAt
    FROM customers WHERE company_id=? ORDER BY customer_number,name`).all(companyId)
    .map(row => ({...row,address:jsonParse(row.addressJson,{}),reminderFeeAgreed:Boolean(row.reminderFeeAgreed)}));
}

function nextCustomerNumber(db,companyId) {
  const rows=db.prepare('SELECT customer_number AS customerNumber FROM customers WHERE company_id=?').all(companyId);
  const highest=rows.reduce((max,row)=>Math.max(max,Number(String(row.customerNumber||'').replace(/\D/g,''))||0),1000);
  return 'K-'+String(highest+1).padStart(4,'0');
}

function createInvoice(db, input) {
  const createdAt = nowIso();
  const invoiceId = input.id || id('invoice');
  db.prepare(`INSERT INTO invoices(id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,total_ore,remaining_ore,vat_ore,status,payment_method,payment_account,invoice_account,batch_number,journal_number,pdf_sha256,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      invoiceId,input.companyId,input.customerId,String(input.invoiceNumber),input.ocr || null,input.invoiceDate,input.postingDate || input.invoiceDate,input.dueDate,
      input.totalOre,input.remainingOre ?? input.totalOre,input.vatOre || 0,input.status || 'Bokförd',input.paymentMethod || null,input.paymentAccount || null,input.invoiceAccount || '1510',
      input.batchNumber || null,input.journalNumber || null,input.pdfSha256 || null,createdAt,createdAt
    );
  return invoiceById(db,input.companyId,invoiceId);
}

function invoiceById(db, companyId, invoiceId) {
  const row = db.prepare(`SELECT i.id,i.company_id AS companyId,i.customer_id AS customerId,i.invoice_number AS invoiceNumber,i.ocr,i.invoice_date AS invoiceDate,
    i.posting_date AS postingDate,i.due_date AS dueDate,i.total_ore AS totalOre,i.remaining_ore AS remainingOre,i.vat_ore AS vatOre,i.status,
    i.payment_method AS paymentMethod,i.payment_account AS paymentAccount,i.invoice_account AS invoiceAccount,i.batch_number AS batchNumber,i.journal_number AS journalNumber,
    i.pdf_sha256 AS pdfSha256,i.created_at AS createdAt,i.updated_at AS updatedAt,c.customer_number AS customerNumber,c.name AS customerName,c.customer_type AS customerType,
    c.reminder_fee_agreed AS reminderFeeAgreed,c.email AS customerEmail,c.address_json AS customerAddressJson
    FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id WHERE i.company_id=? AND i.id=?`).get(companyId,invoiceId);
  return row ? {...row,reminderFeeAgreed:Boolean(row.reminderFeeAgreed),customerAddress:jsonParse(row.customerAddressJson,{})} : null;
}

function addInvoiceTransaction(db,input) {
  const transactionId = input.id || id('transaction');
  db.prepare(`INSERT INTO invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,batch_number,journal_number,amount_ore,approved,account,bank_reference,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      transactionId,input.companyId,input.invoiceId,input.transactionType,input.paymentMethod || null,input.paymentDate || null,input.postingDate || null,
      input.batchNumber || null,input.journalNumber || null,input.amountOre ?? null,input.approved === false ? 0 : 1,input.account || null,input.bankReference || null,nowIso()
    );
  return transactionById(db,input.companyId,transactionId);
}

function transactionById(db,companyId,transactionId) {
  const row = db.prepare(`SELECT id,company_id AS companyId,invoice_id AS invoiceId,transaction_type AS transactionType,payment_method AS paymentMethod,
    payment_date AS paymentDate,posting_date AS postingDate,batch_number AS batchNumber,journal_number AS journalNumber,amount_ore AS amountOre,
    approved,account,bank_reference AS bankReference,created_at AS createdAt FROM invoice_transactions WHERE company_id=? AND id=?`).get(companyId,transactionId);
  return row ? {...row,approved:Boolean(row.approved)} : null;
}

function transactionsForInvoice(db, companyId, invoiceId) {
  return db.prepare(`SELECT id,transaction_type AS transactionType,payment_method AS paymentMethod,payment_date AS paymentDate,posting_date AS postingDate,
    batch_number AS batchNumber,journal_number AS journalNumber,amount_ore AS amountOre,approved,account,bank_reference AS bankReference,created_at AS createdAt
    FROM invoice_transactions WHERE company_id=? AND invoice_id=? ORDER BY COALESCE(payment_date,posting_date,substr(created_at,1,10)),created_at,id`).all(companyId,invoiceId)
    .map(row => ({...row,approved:Boolean(row.approved)}));
}

function listReceivables(db,companyId) {
  const invoices = db.prepare(`SELECT i.id,i.company_id AS companyId,i.customer_id AS customerId,i.invoice_number AS invoiceNumber,i.ocr,i.invoice_date AS invoiceDate,
    i.posting_date AS postingDate,i.due_date AS dueDate,i.total_ore AS totalOre,i.remaining_ore AS remainingOre,i.vat_ore AS vatOre,i.status,
    i.payment_method AS paymentMethod,i.payment_account AS paymentAccount,i.invoice_account AS invoiceAccount,i.batch_number AS batchNumber,i.journal_number AS journalNumber,
    c.customer_number AS customerNumber,c.name AS customerName,c.customer_type AS customerType,c.reminder_fee_agreed AS reminderFeeAgreed
    FROM invoices i JOIN customers c ON c.id=i.customer_id AND c.company_id=i.company_id WHERE i.company_id=? ORDER BY c.name,i.invoice_date DESC,i.invoice_number DESC`).all(companyId);
  const transactionStmt = db.prepare(`SELECT id,transaction_type AS transactionType,payment_method AS paymentMethod,payment_date AS paymentDate,posting_date AS postingDate,
    batch_number AS batchNumber,journal_number AS journalNumber,amount_ore AS amountOre,approved,account,bank_reference AS bankReference,created_at AS createdAt
    FROM invoice_transactions WHERE company_id=? AND invoice_id=? ORDER BY created_at`);
  const reminderStmt = db.prepare(`SELECT id,kind,reminder_date AS reminderDate,
    rate_config_version AS rateConfigVersion,rate_verified_at AS rateVerifiedAt,principal_ore AS principalOre,reminder_fee_ore AS reminderFeeOre,interest_ore AS interestOre,
    business_compensation_ore AS businessCompensationOre,total_due_ore AS totalDueOre,annual_rate_basis_points AS annualRateBasisPoints,note,created_at AS createdAt
    FROM invoice_reminders WHERE company_id=? AND invoice_id=? ORDER BY sent_at`);
  const commentCountStmt = db.prepare('SELECT count(*) AS count FROM invoice_comments WHERE company_id=? AND invoice_id=?');
  return invoices.map(invoice => ({
    ...invoice,
    reminderFeeAgreed:Boolean(invoice.reminderFeeAgreed),
    transactions:transactionStmt.all(companyId,invoice.id).map(row => ({...row,approved:Boolean(row.approved)})),
    reminders:reminderStmt.all(companyId,invoice.id),
    commentCount:Number(commentCountStmt.get(companyId,invoice.id).count || 0)
  }));
}

function addComment(db, comment) {
  db.prepare('INSERT INTO invoice_comments(id,company_id,invoice_id,user_id,author_name,body,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(comment.id,comment.companyId,comment.invoiceId,comment.authorId,comment.authorName,comment.text,comment.createdAt);
  return comment;
}

function commentsForInvoice(db, companyId, invoiceId) {
  return db.prepare(`SELECT id,invoice_id AS invoiceId,user_id AS authorId,author_name AS authorName,body AS text,created_at AS createdAt
    FROM invoice_comments WHERE company_id=? AND invoice_id=? ORDER BY created_at,id`).all(companyId,invoiceId);
}

function addReminder(db, reminder) {
  db.prepare(`INSERT INTO invoice_reminders(id,company_id,invoice_id,user_id,kind,sent_at,reminder_date,rate_config_version,rate_verified_at,principal_ore,reminder_fee_ore,interest_ore,business_compensation_ore,total_due_ore,annual_rate_basis_points,interest_segments_json,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      reminder.id,reminder.companyId,reminder.invoiceId,reminder.createdBy,reminder.kind,reminder.sentAt,
      reminder.reminderDate || String(reminder.sentAt || '').slice(0,10),reminder.rateConfigVersion || '',reminder.rateVerifiedAt || '',reminder.principalOre,reminder.reminderFeeOre,reminder.interestOre,
      reminder.businessLatePaymentCompensationOre,reminder.totalDueOre,reminder.annualRateBasisPoints,JSON.stringify(reminder.interestSegments),reminder.note,reminder.createdAt
    );
  return reminder;
}

function remindersForInvoice(db, companyId, invoiceId) {
  return db.prepare(`SELECT id,kind,reminder_date AS reminderDate,
    rate_config_version AS rateConfigVersion,rate_verified_at AS rateVerifiedAt,principal_ore AS principalOre,reminder_fee_ore AS reminderFeeOre,interest_ore AS interestOre,
    business_compensation_ore AS businessLatePaymentCompensationOre,total_due_ore AS totalDueOre,annual_rate_basis_points AS annualRateBasisPoints,
    interest_segments_json AS interestSegmentsJson,note,created_at AS createdAt,user_id AS createdBy
    FROM invoice_reminders WHERE company_id=? AND invoice_id=? ORDER BY sent_at,id`).all(companyId,invoiceId)
    .map(row => ({...row,interestSegments:jsonParse(row.interestSegmentsJson,[])}));
}

function appendAudit(db,{companyId=null,userId=null,action,entityType,entityId=null,details={}}) {
  const record = {id:id('audit'),companyId,userId,action,entityType,entityId,details,createdAt:nowIso()};
  db.prepare('INSERT INTO audit_events(id,company_id,user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(record.id,companyId,userId,action,entityType,entityId,JSON.stringify(details),record.createdAt);
  return record;
}

function auditForCompany(db,companyId,limit=200) {
  const safeLimit = Math.max(1,Math.min(1000,Number(limit)||200));
  return db.prepare(`SELECT id,company_id AS companyId,user_id AS userId,action,entity_type AS entityType,entity_id AS entityId,details_json AS detailsJson,created_at AS createdAt
    FROM audit_events WHERE company_id=? ORDER BY created_at DESC LIMIT ?`).all(companyId,safeLimit)
    .map(row => ({...row,details:jsonParse(row.detailsJson,{})}));
}

module.exports = Object.freeze({
  openDatabase,
  initializeSchema,
  transaction,
  createCompany,
  companyById,
  createUser,
  userById,
  userByUsername,
  addMembership,
  membership,
  membershipsForUser,
  createSession,
  sessionByTokenHash,
  touchSession,
  consumeMfaStep,
  deleteSession,
  createCustomer,
  customerById,
  listCustomers,
  nextCustomerNumber,
  createInvoice,
  invoiceById,
  addInvoiceTransaction,
  transactionById,
  transactionsForInvoice,
  listReceivables,
  addComment,
  commentsForInvoice,
  addReminder,
  remindersForInvoice,
  appendAudit,
  auditForCompany,
  databaseError
});
