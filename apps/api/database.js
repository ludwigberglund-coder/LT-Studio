'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const SchemaMigrations = require('./schema-migrations.js');

const CORE_SCHEMA_MIGRATION_ID=SchemaMigrations.CORE_SCHEMA_MIGRATION_ID;

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
    if (db.prepare('PRAGMA table_info(memberships)').all().some(column => column.name === 'roles_json')) {
      transaction(db, () => {
        db.exec('ALTER TABLE memberships DROP COLUMN roles_json');
        db.exec('DELETE FROM sessions');
      });
    }
    require('./tenant-integrity.js').installTenantGuards(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeSchema(db) {
  transaction(db, () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK(version>0),
      name TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL CHECK(length(checksum_sha256)=64),
      applied_at TEXT NOT NULL
    ) STRICT;

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

    CREATE TABLE IF NOT EXISTS login_attempts (
      key_hash TEXT PRIMARY KEY,
      failure_count INTEGER NOT NULL CHECK(failure_count >= 0),
      reset_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
      fingerprint_hash TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS platform_operators (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      mfa_secret_encrypted TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS platform_operator_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      operator_id TEXT NOT NULL REFERENCES platform_operators(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS platform_operator_mfa_used_steps (
      operator_id TEXT NOT NULL REFERENCES platform_operators(id) ON DELETE CASCADE,
      totp_counter INTEGER NOT NULL,
      used_at TEXT NOT NULL,
      PRIMARY KEY(operator_id,totp_counter)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS platform_operator_audit_events (
      id TEXT PRIMARY KEY,
      operator_id TEXT REFERENCES platform_operators(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS security_incident_states (
      security_event_id TEXT PRIMARY KEY REFERENCES security_events(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('reviewed','investigating','resolved')),
      updated_by_operator_id TEXT REFERENCES platform_operators(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS security_alert_states (
      fingerprint_hash TEXT PRIMARY KEY CHECK(length(fingerprint_hash)=64),
      code TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
      last_status TEXT NOT NULL DEFAULT 'pending' CHECK(last_status IN ('pending','delivered','failed')),
      last_attempt_at TEXT,
      last_delivered_at TEXT,
      next_retry_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),
      is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1)),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_security_alert_states_active_retry
      ON security_alert_states(is_test,active,last_status,next_retry_at);

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
      request_fingerprint TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL,
      reminder_date TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'not-sent' CHECK(delivery_status IN ('not-sent','queued','sent','failed')),
      delivered_at TEXT,
      rate_config_version TEXT NOT NULL DEFAULT '',
      rate_verified_at TEXT NOT NULL DEFAULT '',
      principal_ore INTEGER NOT NULL,
      reminder_fee_ore INTEGER NOT NULL DEFAULT 0,
      interest_ore INTEGER NOT NULL DEFAULT 0,
      business_compensation_ore INTEGER NOT NULL DEFAULT 0,
      total_due_ore INTEGER NOT NULL,
      annual_rate_basis_points INTEGER NOT NULL,
      interest_start_basis TEXT NOT NULL DEFAULT 'none' CHECK(interest_start_basis IN ('none','predetermined-due-date')),
      interest_start_evidence_source TEXT NOT NULL DEFAULT '',
      interest_start_verified_at TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_mfa_used_steps_used_at ON mfa_used_steps(used_at);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_reset ON login_attempts(reset_at);
    CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_security_events_fingerprint_created ON security_events(fingerprint_hash,created_at);
    CREATE INDEX IF NOT EXISTS idx_platform_operator_sessions_expiry ON platform_operator_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_platform_operator_sessions_absolute_expiry ON platform_operator_sessions(absolute_expires_at);
    CREATE INDEX IF NOT EXISTS idx_security_incident_states_status_updated ON security_incident_states(status,updated_at);
    CREATE INDEX IF NOT EXISTS idx_platform_operator_mfa_used_steps_used_at ON platform_operator_mfa_used_steps(used_at);
    CREATE INDEX IF NOT EXISTS idx_platform_operator_audit_created ON platform_operator_audit_events(created_at);
  `);
  if (!hasColumn(db,'sessions','absolute_expires_at')) {
    db.exec("ALTER TABLE sessions ADD COLUMN absolute_expires_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE sessions SET absolute_expires_at=expires_at WHERE absolute_expires_at=''");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_absolute_expiry ON sessions(absolute_expires_at)');
  if (!hasColumn(db,'invoice_reminders','request_fingerprint')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_request_fingerprint ON invoice_reminders(company_id,invoice_id,request_fingerprint) WHERE request_fingerprint<>''");
  if (!hasColumn(db,'invoice_reminders','reminder_date')) db.exec('ALTER TABLE invoice_reminders ADD COLUMN reminder_date TEXT');
  if (!hasColumn(db,'invoice_reminders','delivery_status')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not-sent'");
  if (!hasColumn(db,'invoice_reminders','delivered_at')) db.exec('ALTER TABLE invoice_reminders ADD COLUMN delivered_at TEXT');
  if (!hasColumn(db,'invoice_reminders','rate_config_version')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN rate_config_version TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db,'invoice_reminders','rate_verified_at')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN rate_verified_at TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db,'invoice_reminders','interest_start_basis')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN interest_start_basis TEXT NOT NULL DEFAULT 'none'");
  if (!hasColumn(db,'invoice_reminders','interest_start_evidence_source')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN interest_start_evidence_source TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db,'invoice_reminders','interest_start_verified_at')) db.exec("ALTER TABLE invoice_reminders ADD COLUMN interest_start_verified_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE invoice_reminders SET reminder_date=substr(sent_at,1,10) WHERE reminder_date IS NULL OR reminder_date=''");
  if (!hasColumn(db,'customers','archived_at')) db.exec('ALTER TABLE customers ADD COLUMN archived_at TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_company_archived ON customers(company_id,archived_at,customer_number)');
  if (!hasColumn(db,'memberships','role')) db.exec("ALTER TABLE memberships ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','accountant','approver','readonly'))");
  if (!hasColumn(db,'users','platform_admin')) db.exec("ALTER TABLE users ADD COLUMN platform_admin INTEGER NOT NULL DEFAULT 0 CHECK(platform_admin IN (0,1))");
  if (!hasColumn(db,'users','session_duration_minutes')) db.exec("ALTER TABLE users ADD COLUMN session_duration_minutes INTEGER DEFAULT 480 CHECK(session_duration_minutes IS NULL OR session_duration_minutes IN (120,240,360,480))");
  const {protectAppendOnly}=require('./history-guards.js');
  protectAppendOnly(db,'audit_events');
  protectAppendOnly(db,'security_events');
  protectAppendOnly(db,'platform_operator_audit_events');
  SchemaMigrations.initialize(db);
  });
}

function schemaMigrationStatus(db) {
  return SchemaMigrations.status(db);
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

function listCompanies(db) {
  return db.prepare('SELECT id,legal_name AS legalName,org_number AS orgNumber,display_name AS displayName,created_at AS createdAt FROM companies ORDER BY display_name,legal_name,id').all();
}

function createUser(db, {id: userId = id('user'), username, displayName, passwordHash, mfaSecretEncrypted = null, disabled = false, platformAdmin = false, sessionDurationMinutes = 480}) {
  const createdAt = nowIso();
  const duration=normalizeSessionDuration(sessionDurationMinutes);
  db.prepare('INSERT INTO users(id,username,display_name,password_hash,mfa_secret_encrypted,disabled,platform_admin,session_duration_minutes,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(userId, username, String(displayName || '').trim(), passwordHash, mfaSecretEncrypted, disabled ? 1 : 0, platformAdmin ? 1 : 0, duration, createdAt);
  return userById(db, userId);
}

function userById(db, userId) {
  const row=db.prepare('SELECT id,username,display_name AS displayName,password_hash AS passwordHash,mfa_secret_encrypted AS mfaSecretEncrypted,disabled,platform_admin AS platformAdmin,session_duration_minutes AS sessionDurationMinutes,created_at AS createdAt FROM users WHERE id=?').get(userId) || null;
  return row?{...row,disabled:Boolean(row.disabled),platformAdmin:Boolean(row.platformAdmin)}:null;
}

function userByUsername(db, username) {
  const row=db.prepare('SELECT id,username,display_name AS displayName,password_hash AS passwordHash,mfa_secret_encrypted AS mfaSecretEncrypted,disabled,platform_admin AS platformAdmin,session_duration_minutes AS sessionDurationMinutes,created_at AS createdAt FROM users WHERE username=?').get(username) || null;
  return row?{...row,disabled:Boolean(row.disabled),platformAdmin:Boolean(row.platformAdmin)}:null;
}

const SESSION_DURATION_MINUTES=Object.freeze([120,240,360,480]);
function normalizeSessionDuration(value) {
  if(value===null||value==='session') return null;
  const minutes=Number(value);
  if(!Number.isSafeInteger(minutes)||!SESSION_DURATION_MINUTES.includes(minutes)) throw databaseError('Inloggningstiden måste vara varje gång, 2, 4, 6 eller 8 timmar.','INVALID_SESSION_DURATION',400);
  return minutes;
}

function setUserSessionDuration(db,{userId,sessionDurationMinutes}) {
  const duration=normalizeSessionDuration(sessionDurationMinutes);
  const result=db.prepare('UPDATE users SET session_duration_minutes=? WHERE id=? AND disabled=0').run(duration,String(userId||'').trim());
  if(Number(result.changes||0)!==1) throw databaseError('Användarkontot hittades inte.','USER_NOT_FOUND',404);
  return userById(db,userId);
}

function setUserPlatformAdmin(db,{userId,enabled}) {
  const result=db.prepare('UPDATE users SET platform_admin=? WHERE id=? AND disabled=0').run(enabled?1:0,String(userId||'').trim());
  if(Number(result.changes||0)!==1) throw databaseError('Användarkontot hittades inte.','USER_NOT_FOUND',404);
  return userById(db,userId);
}

function deleteSessionsForUser(db,userId) {
  return Number(db.prepare('DELETE FROM sessions WHERE user_id=?').run(String(userId||'').trim()).changes||0);
}

function deleteSessionsForUserCompany(db,{userId,companyId}) {
  return Number(db.prepare('DELETE FROM sessions WHERE user_id=? AND company_id=?')
    .run(String(userId||'').trim(),String(companyId||'').trim()).changes||0);
}

function updateUserPasswordHash(db,{userId,passwordHash}) {
  const idValue=String(userId||'').trim(),hash=String(passwordHash||'').trim();
  if(!idValue||!hash)throw databaseError('Lösenordsuppgraderingen saknar obligatoriska värden.','INVALID_PASSWORD_HASH_UPDATE',500);
  const result=db.prepare('UPDATE users SET password_hash=? WHERE id=? AND disabled=0').run(hash,idValue);
  if(Number(result.changes||0)!==1)throw databaseError('Användarens lösenordshash kunde inte uppdateras.','PASSWORD_HASH_UPDATE_FAILED',409);
  return userById(db,idValue);
}

const MEMBERSHIP_ROLES=Object.freeze(['admin','accountant','approver','readonly']);
function membershipRole(value) {
  const role=String(value||'').trim();
  if(!MEMBERSHIP_ROLES.includes(role)) throw databaseError('Ogiltig företagsroll.','INVALID_MEMBERSHIP_ROLE',400);
  return role;
}

function addMembership(db, {companyId,userId,role='admin'}) {
  const normalizedRole=membershipRole(role);
  db.prepare('INSERT INTO memberships(company_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(company_id,user_id) DO NOTHING')
    .run(companyId,userId,normalizedRole,nowIso());
  return membership(db, companyId, userId);
}

function setMembershipRole(db,{companyId,userId,role}) {
  const normalizedRole=membershipRole(role);
  const result=db.prepare('UPDATE memberships SET role=? WHERE company_id=? AND user_id=?').run(normalizedRole,companyId,userId);
  if(Number(result.changes||0)!==1) throw databaseError('Företagsmedlemskapet hittades inte.','MEMBERSHIP_NOT_FOUND',404);
  return membership(db,companyId,userId);
}

function membership(db, companyId, userId) {
  return db.prepare('SELECT company_id AS companyId,user_id AS userId,role,created_at AS createdAt FROM memberships WHERE company_id=? AND user_id=?').get(companyId,userId) || null;
}

function membershipsForUser(db, userId) {
  return db.prepare(`SELECT m.company_id AS companyId,m.role,c.legal_name AS legalName,c.display_name AS displayName
    FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=? ORDER BY c.display_name`).all(userId);
}

function membershipsForCompany(db,companyId) {
  return db.prepare(`SELECT m.company_id AS companyId,m.user_id AS userId,m.role,m.created_at AS createdAt,
    u.username,u.display_name AS displayName,u.disabled,u.platform_admin AS platformAdmin
    FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY u.display_name,u.username,u.id`).all(companyId)
    .map(row=>({...row,disabled:Boolean(row.disabled),platformAdmin:Boolean(row.platformAdmin)}));
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
      u.username,u.display_name AS displayName,u.disabled,u.platform_admin AS platformAdmin,u.session_duration_minutes AS sessionDurationMinutes,
      CASE WHEN u.platform_admin=1 THEN 'admin' ELSE m.role END AS role
    FROM sessions s JOIN users u ON u.id=s.user_id
    LEFT JOIN memberships m ON m.user_id=s.user_id AND m.company_id=s.company_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.absolute_expires_at>? AND (u.platform_admin=1 OR m.user_id IS NOT NULL)`).get(tokenHash,now,now);
  if (!row) return null;
  return row;
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
  db.prepare("DELETE FROM mfa_used_steps WHERE used_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')").run();
  try {
    db.prepare('INSERT INTO mfa_used_steps(user_id,totp_counter,used_at) VALUES(?,?,?)').run(userId,totpCounter,now);
  } catch (error) {
    const detail=`${error.code||''} ${error.message||''} ${error.errstr||''}`;
    if (/CONSTRAINT|UNIQUE constraint failed|constraint failed/i.test(detail)) {
      throw databaseError('MFA-koden har redan använts. Vänta på nästa kod och försök igen.','MFA_CODE_REPLAYED',409);
    }
    throw error;
  }
  return {userId,totpCounter,usedAt:now};
}

function noteLoginFailure(db,{keyHash,windowMinutes=15,nowMs=Date.now()}) {
  if(!/^[a-f0-9]{64}$/.test(String(keyHash||''))) throw databaseError('Ogiltig inloggningsnyckel.','INVALID_LOGIN_ATTEMPT_KEY',500);
  const now=new Date(nowMs).toISOString(),resetAt=new Date(nowMs+windowMinutes*60*1000).toISOString();
  db.prepare('DELETE FROM login_attempts WHERE reset_at<=?').run(now);
  const row=db.prepare('SELECT failure_count AS failureCount,reset_at AS resetAt FROM login_attempts WHERE key_hash=?').get(keyHash);
  if(!row){
    db.prepare('INSERT INTO login_attempts(key_hash,failure_count,reset_at,updated_at) VALUES(?,?,?,?)').run(keyHash,1,resetAt,now);
    return{failureCount:1,resetAt};
  }
  const failureCount=Number(row.failureCount)+1;
  db.prepare('UPDATE login_attempts SET failure_count=?,updated_at=? WHERE key_hash=?').run(failureCount,now,keyHash);
  return{failureCount,resetAt:row.resetAt};
}

function loginAttemptState(db,{keyHash,nowMs=Date.now()}) {
  if(!/^[a-f0-9]{64}$/.test(String(keyHash||''))) return null;
  const now=new Date(nowMs).toISOString();
  db.prepare('DELETE FROM login_attempts WHERE reset_at<=?').run(now);
  return db.prepare('SELECT failure_count AS failureCount,reset_at AS resetAt,updated_at AS updatedAt FROM login_attempts WHERE key_hash=?').get(keyHash)||null;
}

function clearLoginAttempts(db,keyHash) {
  if(/^[a-f0-9]{64}$/.test(String(keyHash||''))) db.prepare('DELETE FROM login_attempts WHERE key_hash=?').run(keyHash);
}

function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
}

function appendSecurityEvent(db,{kind,severity='warning',fingerprintHash,details={}}) {
  const safeKind=String(kind||'').trim();
  const safeSeverity=String(severity||'').trim();
  const safeFingerprint=String(fingerprintHash||'').toLowerCase();
  if(!safeKind) throw databaseError('Säkerhetshändelsen saknar typ.','INVALID_SECURITY_EVENT_KIND',500);
  if(!['info','warning','critical'].includes(safeSeverity)) throw databaseError('Ogiltig allvarlighetsgrad för säkerhetshändelse.','INVALID_SECURITY_EVENT_SEVERITY',500);
  if(!/^[a-f0-9]{64}$/.test(safeFingerprint)) throw databaseError('Ogiltigt säkerhetsfingeravtryck.','INVALID_SECURITY_FINGERPRINT',500);
  const record={id:id('security'),kind:safeKind,severity:safeSeverity,fingerprintHash:safeFingerprint,details,createdAt:nowIso()};
  db.prepare('INSERT INTO security_events(id,kind,severity,fingerprint_hash,details_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(record.id,record.kind,record.severity,record.fingerprintHash,JSON.stringify(details||{}),record.createdAt);
  return record;
}

function securityEvents(db,{limit=100}={}) {
  const safeLimit=Math.max(1,Math.min(1000,Number(limit)||100));
  return db.prepare(`SELECT id,kind,severity,fingerprint_hash AS fingerprintHash,details_json AS detailsJson,created_at AS createdAt
    FROM security_events ORDER BY created_at DESC,id DESC LIMIT ?`).all(safeLimit)
    .map(row=>({...row,details:jsonParse(row.detailsJson,{})}));
}

function securityEventById(db,eventId) {
  const row=db.prepare(`SELECT id,kind,severity,fingerprint_hash AS fingerprintHash,details_json AS detailsJson,created_at AS createdAt
    FROM security_events WHERE id=?`).get(String(eventId||'').trim());
  return row?{...row,details:jsonParse(row.detailsJson,{})}:null;
}

const SECURITY_INCIDENT_STATUSES=Object.freeze(['new','reviewed','investigating','resolved']);

function securityIncidentState(db,eventId) {
  const idValue=String(eventId||'').trim();
  if(!idValue)return null;
  const row=db.prepare(`SELECT s.security_event_id AS securityEventId,s.status,s.updated_by_operator_id AS updatedByOperatorId,
    s.updated_at AS updatedAt,o.display_name AS updatedByDisplayName,o.username AS updatedByUsername
    FROM security_incident_states s
    LEFT JOIN platform_operators o ON o.id=s.updated_by_operator_id
    WHERE s.security_event_id=?`).get(idValue);
  return row||null;
}

function setSecurityIncidentStatus(db,{eventId,status,operatorId}) {
  const idValue=String(eventId||'').trim();
  const safeStatus=String(status||'').trim();
  if(!idValue)throw databaseError('Incidenten saknar säkerhetshändelse.','INVALID_SECURITY_INCIDENT_EVENT',422);
  if(!SECURITY_INCIDENT_STATUSES.includes(safeStatus))throw databaseError('Ogiltig incidentstatus.','INVALID_SECURITY_INCIDENT_STATUS',422);
  if(!securityEventById(db,idValue))throw databaseError('Säkerhetshändelsen hittades inte.','SECURITY_EVENT_NOT_FOUND',404);
  if(safeStatus==='new'){
    db.prepare('DELETE FROM security_incident_states WHERE security_event_id=?').run(idValue);
    return{securityEventId:idValue,status:'new',updatedByOperatorId:operatorId||null,updatedAt:nowIso()};
  }
  const updatedAt=nowIso();
  db.prepare(`INSERT INTO security_incident_states(security_event_id,status,updated_by_operator_id,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(security_event_id) DO UPDATE SET status=excluded.status,updated_by_operator_id=excluded.updated_by_operator_id,updated_at=excluded.updated_at`)
    .run(idValue,safeStatus,operatorId||null,updatedAt);
  return securityIncidentState(db,idValue);
}

function createPlatformOperator(db,{id:operatorId=id('operator'),username,displayName,passwordHash,mfaSecretEncrypted,disabled=false}) {
  const normalizedUsername=String(username||'').trim().toLocaleLowerCase('sv');
  const normalizedDisplayName=String(displayName||'').trim();
  if(!normalizedUsername||!normalizedDisplayName||!passwordHash||!mfaSecretEncrypted) throw databaseError('Operatörsuppgifterna är ofullständiga.','INVALID_PLATFORM_OPERATOR',422);
  const createdAt=nowIso();
  db.prepare('INSERT INTO platform_operators(id,username,display_name,password_hash,mfa_secret_encrypted,disabled,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(operatorId,normalizedUsername,normalizedDisplayName,passwordHash,mfaSecretEncrypted,disabled?1:0,createdAt);
  return platformOperatorById(db,operatorId);
}

function platformOperatorById(db,operatorId) {
  return db.prepare(`SELECT id,username,display_name AS displayName,password_hash AS passwordHash,
    mfa_secret_encrypted AS mfaSecretEncrypted,disabled,created_at AS createdAt
    FROM platform_operators WHERE id=?`).get(operatorId)||null;
}

function platformOperatorByUsername(db,username) {
  return db.prepare(`SELECT id,username,display_name AS displayName,password_hash AS passwordHash,
    mfa_secret_encrypted AS mfaSecretEncrypted,disabled,created_at AS createdAt
    FROM platform_operators WHERE username=?`).get(String(username||'').trim().toLocaleLowerCase('sv'))||null;
}

function updatePlatformOperatorPasswordHash(db,{operatorId,passwordHash}) {
  const idValue=String(operatorId||'').trim(),hash=String(passwordHash||'').trim();
  if(!idValue||!hash)throw databaseError('Operatörens lösenordsuppgradering saknar obligatoriska värden.','INVALID_OPERATOR_PASSWORD_HASH_UPDATE',500);
  const result=db.prepare('UPDATE platform_operators SET password_hash=? WHERE id=? AND disabled=0').run(hash,idValue);
  if(Number(result.changes||0)!==1)throw databaseError('Operatörens lösenordshash kunde inte uppdateras.','OPERATOR_PASSWORD_HASH_UPDATE_FAILED',409);
  return platformOperatorById(db,idValue);
}

function createPlatformOperatorSession(db,{tokenHash,csrfHash,operatorId,expiresAt,absoluteExpiresAt=expiresAt}) {
  const now=nowIso();
  if(!absoluteExpiresAt||absoluteExpiresAt<expiresAt) throw databaseError('Operatörssessionens absoluta sluttid måste vara minst lika sen som inaktivitetsgränsen.','INVALID_OPERATOR_SESSION_EXPIRY',500);
  db.prepare('DELETE FROM platform_operator_sessions WHERE expires_at<=? OR absolute_expires_at<=?').run(now,now);
  db.prepare(`INSERT INTO platform_operator_sessions(token_hash,csrf_hash,operator_id,created_at,expires_at,absolute_expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?)`).run(tokenHash,csrfHash,operatorId,now,expiresAt,absoluteExpiresAt,now);
}

function platformOperatorSessionByTokenHash(db,tokenHash) {
  const now=nowIso();
  return db.prepare(`SELECT s.token_hash AS tokenHash,s.csrf_hash AS csrfHash,s.operator_id AS operatorId,
    s.expires_at AS expiresAt,s.absolute_expires_at AS absoluteExpiresAt,s.created_at AS createdAt,s.last_seen_at AS lastSeenAt,
    o.username,o.display_name AS displayName,o.disabled
    FROM platform_operator_sessions s JOIN platform_operators o ON o.id=s.operator_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.absolute_expires_at>?`).get(tokenHash,now,now)||null;
}

function touchPlatformOperatorSession(db,tokenHash,requestedExpiresAt) {
  const now=nowIso();
  db.prepare(`UPDATE platform_operator_sessions
    SET last_seen_at=?,
        expires_at=CASE WHEN absolute_expires_at<? THEN absolute_expires_at ELSE ? END
    WHERE token_hash=? AND expires_at>? AND absolute_expires_at>?`)
    .run(now,requestedExpiresAt,requestedExpiresAt,tokenHash,now,now);
}

function deletePlatformOperatorSession(db,tokenHash) {
  db.prepare('DELETE FROM platform_operator_sessions WHERE token_hash=?').run(tokenHash);
}

function consumePlatformOperatorMfaStep(db,{operatorId,totpCounter}) {
  if(!operatorId||!Number.isSafeInteger(totpCounter)||totpCounter<0) throw databaseError('Ogiltig operatörs-MFA-tidslucka.','INVALID_OPERATOR_MFA_COUNTER',500);
  const now=nowIso();
  db.prepare("DELETE FROM platform_operator_mfa_used_steps WHERE used_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')").run();
  try{
    db.prepare('INSERT INTO platform_operator_mfa_used_steps(operator_id,totp_counter,used_at) VALUES(?,?,?)').run(operatorId,totpCounter,now);
  }catch(error){
    const detail=`${error.code||''} ${error.message||''} ${error.errstr||''}`;
    if(/CONSTRAINT|UNIQUE constraint failed|constraint failed/i.test(detail)) throw databaseError('Operatörens MFA-kod har redan använts.','OPERATOR_MFA_CODE_REPLAYED',409);
    throw error;
  }
  return{operatorId,totpCounter,usedAt:now};
}

function appendPlatformOperatorAudit(db,{operatorId=null,action,details={}}) {
  const safeAction=String(action||'').trim();
  if(!safeAction) throw databaseError('Operatörsaudit saknar åtgärd.','INVALID_OPERATOR_AUDIT_ACTION',500);
  const record={id:id('operator_audit'),operatorId,action:safeAction,details,createdAt:nowIso()};
  db.prepare('INSERT INTO platform_operator_audit_events(id,operator_id,action,details_json,created_at) VALUES(?,?,?,?,?)')
    .run(record.id,record.operatorId,record.action,JSON.stringify(details||{}),record.createdAt);
  return record;
}

function platformOperatorAudit(db,{limit=200}={}) {
  const safeLimit=Math.max(1,Math.min(1000,Number(limit)||200));
  return db.prepare(`SELECT id,operator_id AS operatorId,action,details_json AS detailsJson,created_at AS createdAt
    FROM platform_operator_audit_events ORDER BY created_at DESC,id DESC LIMIT ?`).all(safeLimit)
    .map(row=>({...row,details:jsonParse(row.detailsJson,{})}));
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
    customer_type AS customerType,reminder_fee_agreed AS reminderFeeAgreed,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt,
    (SELECT COUNT(*) FROM invoices i WHERE i.company_id=customers.company_id AND i.customer_id=customers.id) AS invoiceCount
    FROM customers WHERE company_id=? AND id=?`).get(companyId,customerId);
  return row ? {...row,address:jsonParse(row.addressJson,{}),reminderFeeAgreed:Boolean(row.reminderFeeAgreed),invoiceCount:Number(row.invoiceCount||0)} : null;
}

function updateCustomer(db,input) {
  const existing=customerById(db,input.companyId,input.id);
  if(!existing)return null;
  const updatedAt=nowIso();
  db.prepare(`UPDATE customers SET name=?,org_number=?,email=?,address_json=?,reminder_fee_agreed=?,updated_at=?
    WHERE company_id=? AND id=?`).run(
      String(input.name||'').trim(),input.orgNumber||null,input.email||null,JSON.stringify(input.address||{}),
      input.reminderFeeAgreed?1:0,updatedAt,input.companyId,input.id
    );
  return customerById(db,input.companyId,input.id);
}

function listCustomers(db,companyId,{includeArchived=true}={}) {
  const rows=db.prepare(`SELECT id,company_id AS companyId,customer_number AS customerNumber,name,org_number AS orgNumber,email,address_json AS addressJson,
    customer_type AS customerType,reminder_fee_agreed AS reminderFeeAgreed,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt,
    (SELECT COUNT(*) FROM invoices i WHERE i.company_id=customers.company_id AND i.customer_id=customers.id) AS invoiceCount
    FROM customers WHERE company_id=? ${includeArchived?'':'AND archived_at IS NULL '}ORDER BY customer_number,name`).all(companyId);
  return rows.map(row => ({...row,address:jsonParse(row.addressJson,{}),reminderFeeAgreed:Boolean(row.reminderFeeAgreed),invoiceCount:Number(row.invoiceCount||0)}));
}

function archiveCustomer(db,{companyId,id:customerId,archived=true}) {
  const existing=customerById(db,companyId,customerId);
  if(!existing)return null;
  const archivedAt=archived?nowIso():null,updatedAt=nowIso();
  db.prepare('UPDATE customers SET archived_at=?,updated_at=? WHERE company_id=? AND id=?')
    .run(archivedAt,updatedAt,companyId,customerId);
  return customerById(db,companyId,customerId);
}

function deleteCustomer(db,{companyId,id:customerId}) {
  const existing=customerById(db,companyId,customerId);
  if(!existing)return{deleted:false,customer:null,reason:'not-found'};
  if(existing.invoiceCount>0)return{deleted:false,customer:existing,reason:'has-invoices'};
  const result=db.prepare('DELETE FROM customers WHERE company_id=? AND id=?').run(companyId,customerId);
  return{deleted:Number(result.changes||0)>0,customer:existing,reason:Number(result.changes||0)>0?'deleted':'not-found'};
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
  const reminderStmt = db.prepare(`SELECT id,kind,reminder_date AS reminderDate,delivery_status AS deliveryStatus,delivered_at AS deliveredAt,
    rate_config_version AS rateConfigVersion,rate_verified_at AS rateVerifiedAt,principal_ore AS principalOre,reminder_fee_ore AS reminderFeeOre,interest_ore AS interestOre,
    business_compensation_ore AS businessCompensationOre,total_due_ore AS totalDueOre,annual_rate_basis_points AS annualRateBasisPoints,
    interest_start_basis AS interestStartBasis,interest_start_evidence_source AS interestStartEvidenceSource,interest_start_verified_at AS interestStartVerifiedAt,
    note,created_at AS createdAt
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
  db.prepare(`INSERT INTO invoice_reminders(id,company_id,invoice_id,user_id,kind,request_fingerprint,sent_at,reminder_date,delivery_status,delivered_at,rate_config_version,rate_verified_at,principal_ore,reminder_fee_ore,interest_ore,business_compensation_ore,total_due_ore,annual_rate_basis_points,interest_start_basis,interest_start_evidence_source,interest_start_verified_at,interest_segments_json,note,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      reminder.id,reminder.companyId,reminder.invoiceId,reminder.createdBy,reminder.kind,reminder.requestFingerprint||'',reminder.sentAt,
      reminder.reminderDate || String(reminder.sentAt || '').slice(0,10),reminder.deliveryStatus || 'not-sent',reminder.deliveredAt || null,
      reminder.rateConfigVersion || '',reminder.rateVerifiedAt || '',reminder.principalOre,reminder.reminderFeeOre,reminder.interestOre,
      reminder.businessLatePaymentCompensationOre,reminder.totalDueOre,reminder.annualRateBasisPoints,
      reminder.interestStartBasis || 'none',reminder.interestStartEvidenceSource || '',reminder.interestStartVerifiedAt || '',
      JSON.stringify(reminder.interestSegments),reminder.note,reminder.createdAt
    );
  return reminder;
}

function remindersForInvoice(db, companyId, invoiceId) {
  return db.prepare(`SELECT id,kind,request_fingerprint AS requestFingerprint,sent_at AS sentAt,reminder_date AS reminderDate,delivery_status AS deliveryStatus,delivered_at AS deliveredAt,
    rate_config_version AS rateConfigVersion,rate_verified_at AS rateVerifiedAt,principal_ore AS principalOre,reminder_fee_ore AS reminderFeeOre,interest_ore AS interestOre,
    business_compensation_ore AS businessLatePaymentCompensationOre,total_due_ore AS totalDueOre,annual_rate_basis_points AS annualRateBasisPoints,
    interest_start_basis AS interestStartBasis,interest_start_evidence_source AS interestStartEvidenceSource,interest_start_verified_at AS interestStartVerifiedAt,
    interest_segments_json AS interestSegmentsJson,note,created_at AS createdAt,user_id AS createdBy
    FROM invoice_reminders WHERE company_id=? AND invoice_id=? ORDER BY sent_at,id`).all(companyId,invoiceId)
    .map(row => ({...row,interestSegments:jsonParse(row.interestSegmentsJson,[])}));
}

function reminderByFingerprint(db,companyId,invoiceId,requestFingerprint) {
  const fingerprint=String(requestFingerprint||'').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(fingerprint)) return null;
  const row=db.prepare(`SELECT id,kind,request_fingerprint AS requestFingerprint,sent_at AS sentAt,reminder_date AS reminderDate,
    delivery_status AS deliveryStatus,delivered_at AS deliveredAt,rate_config_version AS rateConfigVersion,rate_verified_at AS rateVerifiedAt,
    principal_ore AS principalOre,reminder_fee_ore AS reminderFeeOre,interest_ore AS interestOre,business_compensation_ore AS businessLatePaymentCompensationOre,
    total_due_ore AS totalDueOre,annual_rate_basis_points AS annualRateBasisPoints,interest_start_basis AS interestStartBasis,
    interest_start_evidence_source AS interestStartEvidenceSource,interest_start_verified_at AS interestStartVerifiedAt,
    interest_segments_json AS interestSegmentsJson,note,created_at AS createdAt,user_id AS createdBy
    FROM invoice_reminders WHERE company_id=? AND invoice_id=? AND request_fingerprint=?`).get(companyId,invoiceId,fingerprint);
  return row?{...row,interestSegments:jsonParse(row.interestSegmentsJson,[])}:null;
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
  CORE_SCHEMA_MIGRATION_ID,
  openDatabase,
  initializeSchema,
  schemaMigrationStatus,
  transaction,
  createCompany,
  companyById,
  listCompanies,
  createUser,
  userById,
  userByUsername,
  SESSION_DURATION_MINUTES,
  normalizeSessionDuration,
  setUserSessionDuration,
  setUserPlatformAdmin,
  deleteSessionsForUser,
  deleteSessionsForUserCompany,
  updateUserPasswordHash,
  MEMBERSHIP_ROLES,
  membershipRole,
  addMembership,
  setMembershipRole,
  membership,
  membershipsForUser,
  membershipsForCompany,
  createSession,
  sessionByTokenHash,
  touchSession,
  consumeMfaStep,
  noteLoginFailure,
  loginAttemptState,
  clearLoginAttempts,
  deleteSession,
  appendSecurityEvent,
  securityEvents,
  securityEventById,
  SECURITY_INCIDENT_STATUSES,
  securityIncidentState,
  setSecurityIncidentStatus,
  createPlatformOperator,
  platformOperatorById,
  platformOperatorByUsername,
  updatePlatformOperatorPasswordHash,
  createPlatformOperatorSession,
  platformOperatorSessionByTokenHash,
  touchPlatformOperatorSession,
  deletePlatformOperatorSession,
  consumePlatformOperatorMfaStep,
  appendPlatformOperatorAudit,
  platformOperatorAudit,
  createCustomer,
  customerById,
  updateCustomer,
  listCustomers,
  archiveCustomer,
  deleteCustomer,
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
  reminderByFingerprint,
  appendAudit,
  auditForCompany,
  databaseError
});
