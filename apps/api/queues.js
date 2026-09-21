'use strict';

const crypto = require('node:crypto');

function queueError(message, code = 'QUEUE_ERROR', statusCode = 422) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function jsonParse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function text(value) { return String(value ?? '').trim(); }

function initializeQueues(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      channel TEXT NOT NULL CHECK(channel IN ('email')),
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','processing','sent','failed','blocked')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
      next_attempt_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_until TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id,idempotency_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS automation_proposals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      proposal_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('manual-review','ready-for-approval','approved','rejected','superseded')),
      confidence_ppm INTEGER NOT NULL CHECK(confidence_ppm BETWEEN 0 AND 1000000),
      deterministic INTEGER NOT NULL DEFAULT 0 CHECK(deterministic IN (0,1)),
      ambiguous INTEGER NOT NULL DEFAULT 0 CHECK(ambiguous IN (0,1)),
      reason TEXT NOT NULL,
      decision_reason TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      suggestion_json TEXT NOT NULL,
      engine_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT,
      rejected_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      rejected_at TEXT,
      rejection_reason TEXT,
      idempotency_key TEXT NOT NULL,
      UNIQUE(company_id,idempotency_key)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_outbox_company_status ON notification_outbox(company_id,status,next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_delivery ON notification_outbox(status,next_attempt_at,created_at);
    CREATE INDEX IF NOT EXISTS idx_proposals_company_status ON automation_proposals(company_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_proposals_source ON automation_proposals(company_id,proposal_type,source_id);
  `);
}

function assertEmail(value) {
  const email = text(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw queueError('Mottagarens e-postadress är ogiltig.', 'INVALID_EMAIL');
  }
  return email;
}

function normalizeAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw queueError('Bilagor måste anges som en lista.', 'INVALID_ATTACHMENTS');
  return value.map((item, index) => {
    const ref = text(item?.ref);
    const name = text(item?.name);
    const sha256 = text(item?.sha256);
    if (!ref || !name) throw queueError(`Bilaga ${index + 1} saknar referens eller filnamn.`, 'INVALID_ATTACHMENT');
    if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) throw queueError(`Bilaga ${index + 1} har ogiltig SHA-256.`, 'INVALID_ATTACHMENT_HASH');
    return Object.freeze({ref, name, sha256});
  });
}

function outboxRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    entityType: row.entityType,
    entityId: row.entityId,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    bodyText: row.bodyText,
    attachments: jsonParse(row.attachmentsJson, []),
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.maxAttempts),
    nextAttemptAt: row.nextAttemptAt,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    providerMessageId: row.providerMessageId,
    lastError: row.lastError,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    updatedAt: row.updatedAt
  };
}

const OUTBOX_SELECT = `SELECT id,company_id AS companyId,entity_type AS entityType,entity_id AS entityId,channel,recipient,subject,body_text AS bodyText,
  attachments_json AS attachmentsJson,idempotency_key AS idempotencyKey,status,attempts,max_attempts AS maxAttempts,next_attempt_at AS nextAttemptAt,
  lease_owner AS leaseOwner,lease_until AS leaseUntil,provider_message_id AS providerMessageId,last_error AS lastError,created_by AS createdBy,
  created_at AS createdAt,sent_at AS sentAt,updated_at AS updatedAt FROM notification_outbox`;

function notificationById(db, companyId, notificationId) {
  return outboxRow(db.prepare(`${OUTBOX_SELECT} WHERE company_id=? AND id=?`).get(companyId, notificationId));
}

function notificationByIdempotencyKey(db, companyId, key) {
  return outboxRow(db.prepare(`${OUTBOX_SELECT} WHERE company_id=? AND idempotency_key=?`).get(companyId, key));
}

function enqueueEmail(db, input) {
  const companyId = text(input?.companyId);
  const entityType = text(input?.entityType);
  const entityId = text(input?.entityId) || null;
  const recipient = assertEmail(input?.recipient);
  const subject = text(input?.subject);
  const bodyText = text(input?.bodyText);
  const idempotencyKey = text(input?.idempotencyKey);
  const createdBy = text(input?.createdBy) || null;
  const attachments = normalizeAttachments(input?.attachments);
  const maxAttempts = Number(input?.maxAttempts ?? 5);
  if (!companyId) throw queueError('Företag saknas för utskicket.', 'MISSING_COMPANY');
  if (!entityType) throw queueError('Objekttyp saknas för utskicket.', 'MISSING_ENTITY_TYPE');
  if (!subject || subject.length > 200) throw queueError('Ämnesraden måste vara 1–200 tecken.', 'INVALID_SUBJECT');
  if (!bodyText || bodyText.length > 50000) throw queueError('Meddelandet måste vara 1–50 000 tecken.', 'INVALID_BODY');
  if (!idempotencyKey || idempotencyKey.length > 200) throw queueError('En stabil idempotensnyckel krävs.', 'INVALID_IDEMPOTENCY_KEY');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw queueError('maxAttempts måste vara mellan 1 och 20.', 'INVALID_MAX_ATTEMPTS');

  const existing = notificationByIdempotencyKey(db, companyId, idempotencyKey);
  if (existing) return {notification: existing, duplicate: true};

  const createdAt = nowIso();
  const notificationId = input.id || id('notify');
  db.prepare(`INSERT INTO notification_outbox(id,company_id,entity_type,entity_id,channel,recipient,subject,body_text,attachments_json,idempotency_key,status,attempts,max_attempts,next_attempt_at,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      notificationId, companyId, entityType, entityId, 'email', recipient, subject, bodyText, JSON.stringify(attachments), idempotencyKey,
      'queued', 0, maxAttempts, input.nextAttemptAt || createdAt, createdBy, createdAt, createdAt
    );
  return {notification: notificationById(db, companyId, notificationId), duplicate: false};
}

function listNotifications(db, companyId, {status = '', limit = 200} = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  if (status) {
    return db.prepare(`${OUTBOX_SELECT} WHERE company_id=? AND status=? ORDER BY created_at DESC LIMIT ?`).all(companyId, status, safeLimit).map(outboxRow);
  }
  return db.prepare(`${OUTBOX_SELECT} WHERE company_id=? ORDER BY created_at DESC LIMIT ?`).all(companyId, safeLimit).map(outboxRow);
}

function releaseExpiredLeases(db, now = nowIso()) {
  return db.prepare(`UPDATE notification_outbox SET status='queued',lease_owner=NULL,lease_until=NULL,updated_at=?
    WHERE status='processing' AND lease_until IS NOT NULL AND lease_until<=?`).run(now, now).changes;
}

function claimNextNotification(db, {workerId, now = nowIso(), leaseSeconds = 300} = {}) {
  const worker = text(workerId);
  if (!worker) throw queueError('Worker-id krävs.', 'MISSING_WORKER_ID');
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) throw queueError('Leasetiden måste vara 30–3600 sekunder.', 'INVALID_LEASE');
  const leaseUntil = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    releaseExpiredLeases(db, now);
    const row = db.prepare(`${OUTBOX_SELECT} WHERE status IN ('queued','failed') AND next_attempt_at<=? AND attempts<max_attempts ORDER BY next_attempt_at,created_at LIMIT 1`).get(now);
    if (!row) { db.exec('COMMIT'); return null; }
    const updated = db.prepare(`UPDATE notification_outbox SET status='processing',attempts=attempts+1,lease_owner=?,lease_until=?,last_error=NULL,updated_at=?
      WHERE id=? AND status IN ('queued','failed')`).run(worker, leaseUntil, now, row.id);
    if (updated.changes !== 1) throw queueError('Utskicket kunde inte låsas för behandling.', 'CLAIM_CONFLICT', 409);
    db.exec('COMMIT');
    return outboxRow(db.prepare(`${OUTBOX_SELECT} WHERE id=?`).get(row.id));
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function markNotificationSent(db, {notificationId, workerId, providerMessageId, sentAt = nowIso()}) {
  const result = db.prepare(`UPDATE notification_outbox SET status='sent',provider_message_id=?,sent_at=?,lease_owner=NULL,lease_until=NULL,last_error=NULL,updated_at=?
    WHERE id=? AND status='processing' AND lease_owner=?`).run(text(providerMessageId) || null, sentAt, sentAt, notificationId, text(workerId));
  if (result.changes !== 1) throw queueError('Utskicket är inte låst av denna worker.', 'OUTBOX_LEASE_MISMATCH', 409);
  return outboxRow(db.prepare(`${OUTBOX_SELECT} WHERE id=?`).get(notificationId));
}

function markNotificationFailed(db, {notificationId, workerId, errorMessage, now = nowIso()}) {
  const current = outboxRow(db.prepare(`${OUTBOX_SELECT} WHERE id=?`).get(notificationId));
  if (!current || current.status !== 'processing' || current.leaseOwner !== text(workerId)) throw queueError('Utskicket är inte låst av denna worker.', 'OUTBOX_LEASE_MISMATCH', 409);
  const terminal = current.attempts >= current.maxAttempts;
  const delayMinutes = Math.min(60, 2 ** Math.max(0, current.attempts - 1));
  const nextAttemptAt = new Date(Date.parse(now) + delayMinutes * 60 * 1000).toISOString();
  db.prepare(`UPDATE notification_outbox SET status=?,next_attempt_at=?,lease_owner=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE id=?`)
    .run(terminal ? 'blocked' : 'failed', nextAttemptAt, text(errorMessage).slice(0,2000) || 'Okänt leveransfel', now, notificationId);
  return outboxRow(db.prepare(`${OUTBOX_SELECT} WHERE id=?`).get(notificationId));
}

function proposalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    sourceId: row.sourceId,
    status: row.status,
    confidence: Number(row.confidencePpm) / 1000000,
    deterministic: Boolean(row.deterministic),
    ambiguous: Boolean(row.ambiguous),
    reason: row.reason,
    decisionReason: row.decisionReason,
    evidence: jsonParse(row.evidenceJson, []),
    suggestion: jsonParse(row.suggestionJson, {}),
    engine: jsonParse(row.engineJson, {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    rejectedBy: row.rejectedBy,
    rejectedAt: row.rejectedAt,
    rejectionReason: row.rejectionReason,
    idempotencyKey: row.idempotencyKey
  };
}

const PROPOSAL_SELECT = `SELECT id,company_id AS companyId,proposal_type AS type,source_id AS sourceId,status,confidence_ppm AS confidencePpm,
  deterministic,ambiguous,reason,decision_reason AS decisionReason,evidence_json AS evidenceJson,suggestion_json AS suggestionJson,engine_json AS engineJson,
  created_by AS createdBy,created_at AS createdAt,approved_by AS approvedBy,approved_at AS approvedAt,rejected_by AS rejectedBy,rejected_at AS rejectedAt,
  rejection_reason AS rejectionReason,idempotency_key AS idempotencyKey FROM automation_proposals`;

function automationProposalById(db, companyId, proposalId) {
  return proposalRow(db.prepare(`${PROPOSAL_SELECT} WHERE company_id=? AND id=?`).get(companyId, proposalId));
}

function automationProposalByKey(db, companyId, key) {
  return proposalRow(db.prepare(`${PROPOSAL_SELECT} WHERE company_id=? AND idempotency_key=?`).get(companyId, key));
}

function saveAutomationProposal(db, proposal, {idempotencyKey} = {}) {
  if (!proposal || typeof proposal !== 'object') throw queueError('Automationsförslaget saknas.', 'MISSING_PROPOSAL');
  const companyId = text(proposal.companyId);
  const key = text(idempotencyKey) || `${text(proposal.type)}:${text(proposal.sourceId)}:${text(proposal.engine?.name)}:${text(proposal.engine?.version)}`;
  if (!companyId || !key) throw queueError('Företag och idempotensnyckel krävs för automationsförslag.', 'INVALID_PROPOSAL_KEY');
  const existing = automationProposalByKey(db, companyId, key);
  if (existing) return {proposal: existing, duplicate: true};
  const confidencePpm = Math.round(Number(proposal.confidence) * 1000000);
  if (!Number.isSafeInteger(confidencePpm) || confidencePpm < 0 || confidencePpm > 1000000) throw queueError('Automationsförslaget har ogiltigt säkerhetsvärde.', 'INVALID_CONFIDENCE');
  db.prepare(`INSERT INTO automation_proposals(id,company_id,proposal_type,source_id,status,confidence_ppm,deterministic,ambiguous,reason,decision_reason,evidence_json,suggestion_json,engine_json,created_by,created_at,idempotency_key)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      proposal.id || id('proposal'), companyId, text(proposal.type), text(proposal.sourceId), text(proposal.status), confidencePpm,
      proposal.deterministic ? 1 : 0, proposal.ambiguous ? 1 : 0, text(proposal.reason), text(proposal.decisionReason), JSON.stringify(proposal.evidence || []),
      JSON.stringify(proposal.suggestion || {}), JSON.stringify(proposal.engine || {}), text(proposal.createdBy) || 'system', proposal.createdAt || nowIso(), key
    );
  return {proposal: automationProposalByKey(db, companyId, key), duplicate: false};
}

function listAutomationProposals(db, companyId, {status = '', limit = 200} = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  if (status) return db.prepare(`${PROPOSAL_SELECT} WHERE company_id=? AND status=? ORDER BY created_at DESC LIMIT ?`).all(companyId, status, safeLimit).map(proposalRow);
  return db.prepare(`${PROPOSAL_SELECT} WHERE company_id=? ORDER BY created_at DESC LIMIT ?`).all(companyId, safeLimit).map(proposalRow);
}

function approveAutomationProposal(db, {companyId, proposalId, userId, approvedAt = nowIso()}) {
  const result = db.prepare(`UPDATE automation_proposals SET status='approved',approved_by=?,approved_at=?,rejected_by=NULL,rejected_at=NULL,rejection_reason=NULL
    WHERE company_id=? AND id=? AND status IN ('manual-review','ready-for-approval')`).run(userId, approvedAt, companyId, proposalId);
  if (result.changes !== 1) throw queueError('Automationsförslaget kan inte godkännas i nuvarande status.', 'INVALID_PROPOSAL_STATUS', 409);
  return automationProposalById(db, companyId, proposalId);
}
function approveAutomationProposalIdempotent(db,input) {
  try { return {proposal:approveAutomationProposal(db,input),duplicate:false}; }
  catch (error) {
    if (error?.code !== 'INVALID_PROPOSAL_STATUS') throw error;
    const current=automationProposalById(db,input.companyId,input.proposalId);
    if (current?.status==='approved' && current.approvedBy===input.userId) return {proposal:current,duplicate:true};
    throw error;
  }
}

function rejectAutomationProposal(db, {companyId, proposalId, userId, reason, rejectedAt = nowIso()}) {
  const why = text(reason);
  if (!why) throw queueError('Ange varför förslaget avvisas.', 'MISSING_REJECTION_REASON');
  const result = db.prepare(`UPDATE automation_proposals SET status='rejected',rejected_by=?,rejected_at=?,rejection_reason=?,approved_by=NULL,approved_at=NULL
    WHERE company_id=? AND id=? AND status IN ('manual-review','ready-for-approval')`).run(userId, rejectedAt, why.slice(0,2000), companyId, proposalId);
  if (result.changes !== 1) throw queueError('Automationsförslaget kan inte avvisas i nuvarande status.', 'INVALID_PROPOSAL_STATUS', 409);
  return automationProposalById(db, companyId, proposalId);
}
function rejectAutomationProposalIdempotent(db,input) {
  const why=text(input.reason);
  if (!why) throw queueError('Ange varför förslaget avvisas.', 'MISSING_REJECTION_REASON');
  try { return {proposal:rejectAutomationProposal(db,{...input,reason:why}),duplicate:false}; }
  catch (error) {
    if (error?.code !== 'INVALID_PROPOSAL_STATUS') throw error;
    const current=automationProposalById(db,input.companyId,input.proposalId);
    if (current?.status==='rejected' && current.rejectedBy===input.userId && current.rejectionReason===why.slice(0,2000)) {
      return {proposal:current,duplicate:true};
    }
    throw error;
  }
}

module.exports = Object.freeze({
  initializeQueues,
  assertEmail,
  normalizeAttachments,
  enqueueEmail,
  notificationById,
  notificationByIdempotencyKey,
  listNotifications,
  releaseExpiredLeases,
  claimNextNotification,
  markNotificationSent,
  markNotificationFailed,
  saveAutomationProposal,
  automationProposalById,
  automationProposalByKey,
  listAutomationProposals,
  approveAutomationProposal,
  approveAutomationProposalIdempotent,
  rejectAutomationProposal,
  rejectAutomationProposalIdempotent
});
