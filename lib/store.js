'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const GENESIS_HASH = 'GENESIS';

class IntegrityError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'IntegrityError';
    this.code = 'STORE_INTEGRITY_ERROR';
    this.report = report;
  }
}

function resolveDataDir(env = process.env) {
  if (env.ROLLANDS_DATA_DIR) return path.resolve(env.ROLLANDS_DATA_DIR);
  if (process.platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'RollandsEkonomi');
  const base = env.XDG_DATA_HOME ? path.resolve(env.XDG_DATA_HOME) : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'rollands-ekonomi');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableAuditPayload(entry) {
  return JSON.stringify({
    id: String(entry.id || ''),
    at: String(entry.at || ''),
    actor: String(entry.actor || ''),
    action: String(entry.action || ''),
    details: String(entry.details || ''),
    previousHash: String(entry.previousHash || GENESIS_HASH)
  });
}

function auditHash(entry) {
  return sha256(stableAuditPayload(entry));
}

function ensureAuditChain(store) {
  store.auditLog ||= [];
  if (!store.auditLog.length) return false;
  const hasExistingChain = store.auditLog.some(entry => entry.hash || entry.previousHash);
  if (hasExistingChain) return false;
  let previousHash = GENESIS_HASH;
  for (const entry of [...store.auditLog].reverse()) {
    entry.previousHash = previousHash;
    entry.hash = auditHash(entry);
    previousHash = entry.hash;
  }
  return true;
}

function appendAudit(store, {id, at, actor, action, details}) {
  ensureAuditChain(store);
  const entry = {
    id,
    at,
    actor,
    action,
    details,
    previousHash: store.auditLog[0]?.hash || GENESIS_HASH
  };
  entry.hash = auditHash(entry);
  store.auditLog.unshift(entry);
  return entry;
}

function journalDifference(entry) {
  return (entry.rows || []).reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0);
}

function duplicateValues(items, selector) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items || []) {
    const value = selector(item);
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isWholeAmount(value) {
  return Number.isSafeInteger(Number(value));
}

function detectDemoRecords(store) {
  const knownIds = new Set([
    'inv_1002', 'inv_1003', 'inv_1004', 'inv_1005',
    'sup_110', 'sup_111', 'sup_112',
    'bank_001', 'bank_002', 'bank_003', 'bank_004',
    'ver_A23', 'ver_A24', 'ver_A25'
  ]);
  const collections = ['invoices', 'supplierInvoices', 'bankTransactions', 'journal'];
  const found = [];
  for (const collection of collections) {
    for (const item of store[collection] || []) {
      if (String(item.id || '').startsWith('test_') || knownIds.has(item.id)) found.push({collection, id: item.id});
    }
  }
  return found;
}

function validateStore(store) {
  const errors = [];
  const warnings = [];
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    return {ok: false, errors: ['Datalagret är inte ett giltigt objekt.'], warnings, summary: {}};
  }

  for (const key of ['invoices', 'supplierInvoices', 'bankTransactions', 'journal', 'activity', 'auditLog']) {
    if (!Array.isArray(store[key])) errors.push(`${key} måste vara en lista.`);
  }
  if (!store.business || typeof store.business !== 'object') errors.push('Företagsuppgifter saknas.');
  if (!store.settings || typeof store.settings !== 'object') errors.push('Inställningar saknas.');

  const invoices = [...(store.invoices || []), ...(store.supplierInvoices || [])];
  for (const collection of ['invoices', 'supplierInvoices', 'bankTransactions', 'journal', 'auditLog']) {
    for (const item of store[collection] || []) if (!String(item.id || '').trim()) errors.push(`${collection} innehåller en post utan id.`);
    for (const value of duplicateValues(store[collection], item => String(item.id || ''))) errors.push(`Dubblett av id i ${collection}: ${value}.`);
  }
  for (const value of duplicateValues(invoices, item => String(item.id || ''))) errors.push(`Dubblett av post-id mellan reskontror: ${value}.`);
  for (const value of duplicateValues(store.invoices, item => String(item.number || ''))) errors.push(`Dubblett av kundfakturanummer: ${value}.`);
  for (const value of duplicateValues(store.supplierInvoices, item => `${String(item.supplier || '').trim().toLocaleLowerCase('sv')}::${String(item.invoiceNumber || '').trim().toLocaleLowerCase('sv')}`)) errors.push(`Dubblett av leverantör och fakturanummer: ${value}.`);
  for (const value of duplicateValues(store.bankTransactions, item => String(item.transactionRef || ''))) errors.push(`Dubblett av bankreferens: ${value}.`);
  for (const value of duplicateValues(store.journal, item => String(item.number || ''))) errors.push(`Dubblett av verifikationsnummer: ${value}.`);
  for (const value of duplicateValues(store.journal, item => String(item.batchNumber || ''))) errors.push(`Dubblett av buntnummer: ${value}.`);

  const paymentItems = [];
  for (const [kind, list] of [['kundfaktura', store.invoices || []], ['leverantörsfaktura', store.supplierInvoices || []]]) {
    for (const invoice of list) {
      const label = invoice.number || invoice.invoiceNumber || invoice.id || 'utan nummer';
      const invoiceDate = invoice.date || invoice.received;
      if (kind === 'kundfaktura' && (!String(invoice.number || '').trim() || !String(invoice.customer || '').trim())) errors.push(`${kind} ${label}: fakturanummer eller kund saknas.`);
      if (kind === 'leverantörsfaktura' && (!String(invoice.invoiceNumber || '').trim() || !String(invoice.supplier || '').trim())) errors.push(`${kind} ${label}: fakturanummer eller leverantör saknas.`);
      if (!validIsoDate(invoiceDate)) errors.push(`${kind} ${label}: ogiltigt fakturadatum.`);
      if (!validIsoDate(invoice.dueDate)) errors.push(`${kind} ${label}: ogiltigt förfallodatum.`);
      if (validIsoDate(invoiceDate) && validIsoDate(invoice.dueDate) && invoice.dueDate < invoiceDate) errors.push(`${kind} ${label}: förfallodatum ligger före fakturadatum.`);
      if (invoice.postingDate && !validIsoDate(invoice.postingDate)) errors.push(`${kind} ${label}: ogiltig bokföringsdag.`);
      for (const field of ['net', 'vat', 'total']) {
        if (invoice[field] == null) errors.push(`${kind} ${label}: ${field} saknas.`);
        else if (!isWholeAmount(invoice[field])) errors.push(`${kind} ${label}: ${field} måste vara ett heltal i kronor.`);
      }
      if (invoice.net != null && invoice.vat != null && invoice.total != null && Number(invoice.net) + Number(invoice.vat) !== Number(invoice.total)) errors.push(`${kind} ${label}: netto plus moms stämmer inte med totalen.`);
      for (const [entryType, items] of [['betalning', invoice.payments || []], ['utbetalning', invoice.payouts || []]]) {
        for (const payment of items) {
          if (!String(payment.id || '').trim()) errors.push(`${kind} ${label}: ${entryType} saknar id.`);
          if (!isWholeAmount(payment.amount) || Number(payment.amount) <= 0) errors.push(`${kind} ${label}: betalningsbelopp måste vara ett positivt heltal.`);
          if (payment.date && !validIsoDate(payment.date)) errors.push(`${kind} ${label}: ${entryType} har ogiltigt datum.`);
          paymentItems.push({id: String(payment.id || ''), reference: payment.reclassified || payment.reversed ? '' : String(payment.reference || '').trim(), label: `${kind} ${label}`});
        }
      }
    }
  }
  for (const value of duplicateValues(paymentItems, item => item.id)) errors.push(`Dubblett av betalnings-id: ${value}.`);
  for (const value of duplicateValues(paymentItems, item => item.reference)) errors.push(`Dubblett av betalningsreferens: ${value}.`);

  for (const transaction of store.bankTransactions || []) {
    const label = transaction.transactionRef || transaction.id || 'utan referens';
    if (!validIsoDate(transaction.date)) errors.push(`Bankhändelse ${label}: ogiltigt datum.`);
    if (!isWholeAmount(transaction.amount) || Number(transaction.amount) === 0) errors.push(`Bankhändelse ${label}: belopp måste vara ett heltal som inte är noll.`);
    if (transaction.direction && !['in', 'out'].includes(transaction.direction)) errors.push(`Bankhändelse ${label}: ogiltig riktning.`);
    if (transaction.direction === 'in' && Number(transaction.amount) <= 0) errors.push(`Bankhändelse ${label}: inbetalning måste ha positivt belopp.`);
    if (transaction.direction === 'out' && Number(transaction.amount) >= 0) errors.push(`Bankhändelse ${label}: utbetalning måste ha negativt belopp.`);
  }
  for (const period of store.settings?.lockedPeriods || []) if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(period))) errors.push(`Ogiltig låst period: ${period}.`);

  for (const entry of store.journal || []) {
    const label = entry.number || entry.id || 'utan nummer';
    if (!String(entry.number || '').trim()) errors.push(`Verifikation ${label}: verifikationsnummer saknas.`);
    if (!String(entry.description || '').trim()) errors.push(`Verifikation ${label}: beskrivning saknas.`);
    if (!validIsoDate(entry.date)) errors.push(`Verifikation ${label}: ogiltigt datum.`);
    if (entry.postingDate && !validIsoDate(entry.postingDate)) errors.push(`Verifikation ${label}: ogiltig bokföringsdag.`);
    if (!/^\d{4}$/.test(String(entry.batchNumber || ''))) errors.push(`Verifikation ${label}: buntnummer måste vara fyrsiffrigt.`);
    if (!Array.isArray(entry.rows) || entry.rows.length < 2) {
      errors.push(`Verifikation ${label} måste ha minst två konteringsrader.`);
      continue;
    }
    for (const [index, row] of entry.rows.entries()) {
      if (!/^\d{4}(?:\s|$)/.test(String(row.account || ''))) errors.push(`Verifikation ${label}, rad ${index + 1}: ogiltigt konto.`);
      for (const field of ['debit', 'credit']) {
        const value = Number(row[field] || 0);
        if (!Number.isSafeInteger(value) || value < 0) errors.push(`Verifikation ${label}, rad ${index + 1}: ${field} måste vara ett icke-negativt heltal.`);
      }
      if (Number(row.debit || 0) > 0 && Number(row.credit || 0) > 0) errors.push(`Verifikation ${label}, rad ${index + 1}: samma rad får inte ha både debet och kredit.`);
      if (Number(row.debit || 0) === 0 && Number(row.credit || 0) === 0) errors.push(`Verifikation ${label}, rad ${index + 1}: raden saknar belopp.`);
    }
    const difference = journalDifference(entry);
    if (!Number.isSafeInteger(difference) || difference !== 0) errors.push(`Verifikation ${label} balanserar inte (differens ${difference} kr).`);
  }

  const auditLog = store.auditLog || [];
  for (let index = 0; index < auditLog.length; index += 1) {
    const entry = auditLog[index];
    if (!String(entry.action || '').trim()) errors.push(`Revisionspost ${entry.id || index + 1}: händelsetyp saknas.`);
    if (!entry.at || Number.isNaN(Date.parse(entry.at))) errors.push(`Revisionspost ${entry.id || index + 1}: ogiltig tidsstämpel.`);
    const expectedPrevious = index === auditLog.length - 1 ? GENESIS_HASH : auditLog[index + 1].hash;
    if (entry.previousHash !== expectedPrevious || entry.hash !== auditHash(entry)) {
      errors.push(`Revisionskedjan är bruten vid ${entry.id || `rad ${index + 1}`}.`);
      break;
    }
  }

  const demoRecords = detectDemoRecords(store);
  if (demoRecords.length) warnings.push(`${demoRecords.length} kända demo-/testposter finns i datalagret.`);
  if (!store.settings?.lockedPeriods?.length) warnings.push('Ingen bokföringsperiod är låst.');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      customerInvoices: (store.invoices || []).length,
      supplierInvoices: (store.supplierInvoices || []).length,
      bankTransactions: (store.bankTransactions || []).length,
      journalEntries: (store.journal || []).length,
      auditEntries: auditLog.length,
      demoRecords: demoRecords.length
    }
  };
}

function assertStoreIntegrity(store) {
  const report = validateStore(store);
  if (!report.ok) throw new IntegrityError(`Datalagret kunde inte sparas: ${report.errors[0]}`, report);
  return report;
}

function fsyncFile(file) {
  const descriptor = fs.openSync(file, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  let descriptor;
  try { descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); }
  catch {}
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function replaceFile(source, target) {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(target, {force: true});
    fs.renameSync(source, target);
  }
}

function atomicWriteJson(file, data) {
  assertStoreIntegrity(data);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  try { fs.chmodSync(directory, 0o700); } catch {}

  const serialized = JSON.stringify(data, null, 2) + '\n';
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const backup = `${file}.bak`;
  const backupTemp = `${backup}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(temp, serialized, {encoding: 'utf8', flag: 'wx', mode: 0o600});
    fsyncFile(temp);
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, backupTemp);
      try { fs.chmodSync(backupTemp, 0o600); } catch {}
      fsyncFile(backupTemp);
      replaceFile(backupTemp, backup);
    }
    replaceFile(temp, file);
    fsyncDirectory(directory);
    try { fs.chmodSync(file, 0o600); } catch {}
  } finally {
    fs.rmSync(temp, {force: true});
    fs.rmSync(backupTemp, {force: true});
  }
  return {file, backup, sha256: sha256(serialized)};
}

function parseJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadJsonWithBackup(file) {
  try {
    return {data: parseJsonFile(file), recovered: false, source: file};
  } catch (primaryError) {
    const backup = `${file}.bak`;
    try {
      return {data: parseJsonFile(backup), recovered: true, source: backup, primaryError};
    } catch (backupError) {
      const error = new Error(`Datalagret kan inte läsas. Primärfil: ${primaryError.message}. Säkerhetskopia: ${backupError.message}.`);
      error.code = 'STORE_READ_ERROR';
      error.primaryError = primaryError;
      error.backupError = backupError;
      throw error;
    }
  }
}

function stripKnownDemoData(store) {
  const exactIds = new Set([
    'inv_1002', 'inv_1003', 'inv_1004', 'inv_1005',
    'sup_110', 'sup_111', 'sup_112',
    'bank_001', 'bank_002', 'bank_003', 'bank_004',
    'ver_A23', 'ver_A24', 'ver_A25'
  ]);
  const removed = {};
  for (const collection of ['invoices', 'supplierInvoices', 'bankTransactions', 'journal']) {
    const before = store[collection] || [];
    const after = before.filter(item => !String(item.id || '').startsWith('test_') && !exactIds.has(item.id));
    removed[collection] = before.length - after.length;
    store[collection] = after;
  }
  const beforeActivity = store.activity || [];
  store.activity = beforeActivity.filter(item => !/testdata|AI matchade inbetalning 4 375|Västkustens Fruktgrossist|Två bankhändelser/i.test(String(item.text || '')));
  removed.activity = beforeActivity.length - store.activity.length;
  delete store.settings.testDataVersion;
  return removed;
}

function createBackup(file, backupDirectory = path.join(path.dirname(file), 'backups')) {
  if (!fs.existsSync(file)) throw new Error(`Datalagret saknas: ${file}`);
  fs.mkdirSync(backupDirectory, {recursive: true, mode: 0o700});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDirectory, `store-${stamp}.json`);
  fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(target, 0o600); } catch {}
  fsyncFile(target);
  fsyncDirectory(backupDirectory);
  const content = fs.readFileSync(target);
  return {target, bytes: content.length, sha256: sha256(content)};
}

module.exports = {
  GENESIS_HASH,
  IntegrityError,
  resolveDataDir,
  sha256,
  auditHash,
  ensureAuditChain,
  appendAudit,
  journalDifference,
  detectDemoRecords,
  validateStore,
  assertStoreIntegrity,
  atomicWriteJson,
  loadJsonWithBackup,
  stripKnownDemoData,
  createBackup
};
