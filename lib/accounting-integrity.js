'use strict';

const crypto = require('node:crypto');

const INTEGRITY_VERSION = 1;
const GENESIS_HASH = 'GENESIS';
const DEMO_SEED_JOURNAL_IDS = new Set(['ver_A23', 'ver_A24', 'ver_A25']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key] === undefined ? null : value[key])]));
  }
  if (value === undefined) return null;
  return value;
}

function stableStringify(value) {
  return JSON.stringify(normalize(value));
}

function journalCore(entry) {
  return {
    id: String(entry.id || ''),
    date: String(entry.date || ''),
    postingDate: String(entry.postingDate || entry.date || ''),
    series: String(entry.series || ''),
    number: String(entry.number || ''),
    batchNumber: String(entry.batchNumber || ''),
    description: String(entry.description || ''),
    source: String(entry.source || ''),
    rows: (entry.rows || []).map(row => ({
      account: String(row.account || ''),
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0)
    }))
  };
}

function journalHash(entry, previousHash) {
  return sha256(stableStringify({
    version: INTEGRITY_VERSION,
    previousHash: String(previousHash || GENESIS_HASH),
    journal: journalCore(entry)
  }));
}

function customerSourceCore(invoice) {
  return {
    kind: 'customer',
    id: String(invoice.id || ''),
    number: String(invoice.number || ''),
    ocr: String(invoice.ocr || ''),
    customerNumber: String(invoice.customerNumber || ''),
    customer: String(invoice.customer || ''),
    address: String(invoice.address || ''),
    reference: String(invoice.reference || ''),
    ourContact: String(invoice.ourContact || ''),
    paymentTerms: invoice.paymentTerms == null ? null : Number(invoice.paymentTerms),
    date: String(invoice.date || ''),
    dueDate: String(invoice.dueDate || ''),
    postingDate: String(invoice.postingDate || ''),
    net: Number(invoice.net || 0),
    vat: Number(invoice.vat || 0),
    total: Number(invoice.total || 0),
    vatRate: invoice.vatRate == null ? null : Number(invoice.vatRate),
    credit: Boolean(invoice.credit),
    lines: Array.isArray(invoice.lines) ? invoice.lines : [],
    vatSummary: Array.isArray(invoice.vatSummary) ? invoice.vatSummary : [],
    seller: invoice.seller && typeof invoice.seller === 'object' ? invoice.seller : {},
    interestText: String(invoice.interestText || ''),
    pdfSha256: invoice.pdfBase64 ? sha256(String(invoice.pdfBase64)) : ''
  };
}

function supplierSourceCore(invoice) {
  return {
    kind: 'supplier',
    id: String(invoice.id || ''),
    supplierNumber: String(invoice.supplierNumber || ''),
    supplier: String(invoice.supplier || ''),
    invoiceNumber: String(invoice.invoiceNumber || ''),
    received: String(invoice.received || ''),
    dueDate: String(invoice.dueDate || ''),
    net: Number(invoice.net || 0),
    vat: Number(invoice.vat || 0),
    total: Number(invoice.total || 0),
    source: String(invoice.source || '')
  };
}

function invoiceSourceHash(invoice, kind) {
  const core = kind === 'supplier' ? supplierSourceCore(invoice) : customerSourceCore(invoice);
  return sha256(stableStringify({version: INTEGRITY_VERSION, invoice: core}));
}

function invoiceBookingCore(invoice, kind) {
  return {
    kind,
    id: String(invoice.id || ''),
    sourceHash: invoiceSourceHash(invoice, kind),
    journalNumber: String(invoice.journalNumber || ''),
    batchNumber: String(invoice.batchNumber || ''),
    bookedDate: String(invoice.bookedDate || ''),
    postingDate: String(invoice.postingDate || ''),
    account: kind === 'supplier' ? String(invoice.suggestedAccount || '') : '',
    journalLink: String(invoice.journalNumber || '')
  };
}

function invoiceBookingHash(invoice, kind) {
  return sha256(stableStringify({version: INTEGRITY_VERSION, booking: invoiceBookingCore(invoice, kind)}));
}

function hasJournalSeal(entry) {
  return Boolean(entry?.integrity && (entry.integrity.hash || entry.integrity.previousHash || entry.integrity.version));
}

function controlledDemoBootstrap(store, firstSealed, lastSealed) {
  const journal = store.journal || [];
  if (Number(store.settings?.testDataVersion || 0) < 2 || firstSealed < 0 || lastSealed < 0 || lastSealed === journal.length - 1) return false;
  const sealed = journal.slice(firstSealed, lastSealed + 1);
  const appended = journal.slice(lastSealed + 1);
  return sealed.length > 0 &&
    sealed.every(entry => DEMO_SEED_JOURNAL_IDS.has(String(entry.id || ''))) &&
    appended.length > 0 &&
    appended.every(entry => !hasJournalSeal(entry) && String(entry.id || '').startsWith('test_v'));
}

function validateJournalIntegrity(store) {
  const journal = store.journal || [];
  const errors = [];
  const warnings = [];
  const firstSealed = journal.findIndex(hasJournalSeal);
  const lastSealed = journal.findLastIndex(hasJournalSeal);
  const anchor = store.accountingIntegrity;

  if (firstSealed < 0) {
    if (journal.length) warnings.push(`${journal.length} verifikationer väntar på integritetsförsegling.`);
    if (anchor && (anchor.journalHeadHash !== GENESIS_HASH || Number(anchor.journalEntryCount || 0) !== 0)) {
      errors.push('Bokföringens integritetsankare finns men verifikationernas försegling saknas.');
    }
    return {ok: errors.length === 0, errors, warnings, sealed: 0, pending: journal.length, requiresRebuild: false};
  }

  for (let index = firstSealed; index <= lastSealed; index += 1) {
    if (!hasJournalSeal(journal[index])) {
      errors.push(`Integritetskedjan har ett oskyddat avbrott vid verifikation ${journal[index].number || journal[index].id || index + 1}.`);
      return {ok: false, errors, warnings, sealed: 0, pending: journal.length, requiresRebuild: false};
    }
  }

  const demoRebuild = controlledDemoBootstrap(store, firstSealed, lastSealed);
  if (lastSealed !== journal.length - 1 && !demoRebuild) {
    const entry = journal[lastSealed + 1];
    errors.push(`Integritetskedjan har ett oskyddat avbrott vid verifikation ${entry.number || entry.id || lastSealed + 2}.`);
    return {ok: false, errors, warnings, sealed: lastSealed - firstSealed + 1, pending: journal.length - (lastSealed - firstSealed + 1), requiresRebuild: false};
  }

  for (let index = lastSealed; index >= firstSealed; index -= 1) {
    const entry = journal[index];
    const integrity = entry.integrity || {};
    const expectedPrevious = index === lastSealed ? GENESIS_HASH : journal[index + 1].integrity.hash;
    if (Number(integrity.version) !== INTEGRITY_VERSION) {
      errors.push(`Verifikation ${entry.number || entry.id}: okänd integritetsversion.`);
      break;
    }
    if (integrity.previousHash !== expectedPrevious || integrity.hash !== journalHash(entry, expectedPrevious)) {
      errors.push(`Verifikation ${entry.number || entry.id}: integritetskontrollen visar att bokföringsposten eller kedjan har ändrats.`);
      break;
    }
  }

  const pendingFront = firstSealed;
  const pendingTail = journal.length - 1 - lastSealed;
  const pending = pendingFront + pendingTail;
  const sealed = lastSealed - firstSealed + 1;
  if (pendingFront) warnings.push(`${pendingFront} nya verifikationer väntar på integritetsförsegling.`);
  if (demoRebuild) warnings.push(`${pendingTail} kända demoverifikationer läggs till i testläget och kräver kontrollerad återförsegling.`);

  if (anchor) {
    const expectedHead = journal[firstSealed]?.integrity?.hash || GENESIS_HASH;
    const expectedCount = sealed;
    if (Number(anchor.version) !== INTEGRITY_VERSION) errors.push('Bokföringens integritetsankare har okänd version.');
    if (String(anchor.journalHeadHash || '') !== expectedHead) errors.push('Bokföringens integritetsankare stämmer inte med senast förseglade verifikation.');
    if (Number(anchor.journalEntryCount) !== expectedCount) errors.push('Bokföringens integritetsankare stämmer inte med antalet förseglade verifikationer.');
  } else if (sealed) {
    warnings.push('Bokföringens integritetsankare saknas och skapas vid nästa säkra skrivning.');
  }

  return {ok: errors.length === 0, errors, warnings, sealed, pending, requiresRebuild: demoRebuild};
}

function validateInvoiceIntegrity(store) {
  const errors = [];
  const warnings = [];
  let sealed = 0;
  let pending = 0;

  for (const [kind, list] of [['customer', store.invoices || []], ['supplier', store.supplierInvoices || []]]) {
    for (const invoice of list) {
      const label = invoice.number || invoice.invoiceNumber || invoice.id || 'utan nummer';
      if (!invoice.integrity) {
        pending += 1;
        continue;
      }
      if (Number(invoice.integrity.version) !== INTEGRITY_VERSION) {
        errors.push(`${kind === 'customer' ? 'Kundfaktura' : 'Leverantörsfaktura'} ${label}: okänd integritetsversion.`);
        continue;
      }
      const expectedSource = invoiceSourceHash(invoice, kind);
      if (!invoice.integrity.sourceHash || invoice.integrity.sourceHash !== expectedSource) {
        errors.push(`${kind === 'customer' ? 'Kundfaktura' : 'Leverantörsfaktura'} ${label}: ursprungsuppgifterna har ändrats efter integritetsförsegling.`);
        continue;
      }
      if (invoice.journalNumber) {
        const expectedBooking = invoiceBookingHash(invoice, kind);
        if (!invoice.integrity.bookingHash) pending += 1;
        else if (invoice.integrity.bookingHash !== expectedBooking) errors.push(`${kind === 'customer' ? 'Kundfaktura' : 'Leverantörsfaktura'} ${label}: bokföringskopplingen har ändrats efter integritetsförsegling.`);
        else sealed += 1;
      } else {
        if (invoice.integrity.bookingHash) errors.push(`${kind === 'customer' ? 'Kundfaktura' : 'Leverantörsfaktura'} ${label}: har bokföringsfingeravtryck utan verifikationskoppling.`);
        sealed += 1;
      }
    }
  }

  if (pending) warnings.push(`${pending} fakturaposter väntar på fullständig integritetsförsegling.`);
  return {ok: errors.length === 0, errors, warnings, sealed, pending};
}

function validateAccountingIntegrity(store) {
  const journal = validateJournalIntegrity(store);
  const invoices = validateInvoiceIntegrity(store);
  return {
    ok: journal.ok && invoices.ok,
    errors: [...journal.errors, ...invoices.errors],
    warnings: [...journal.warnings, ...invoices.warnings],
    summary: {
      journalSealed: journal.sealed,
      journalPending: journal.pending,
      invoiceSealed: invoices.sealed,
      invoicePending: invoices.pending
    },
    requiresJournalRebuild: journal.requiresRebuild
  };
}

function sealJournalIntegrity(store) {
  store.journal ||= [];
  const report = validateJournalIntegrity(store);
  if (!report.ok) {
    const error = new Error(report.errors[0]);
    error.code = 'ACCOUNTING_INTEGRITY_ERROR';
    error.report = report;
    throw error;
  }

  if (report.requiresRebuild) {
    for (const entry of store.journal) delete entry.integrity;
    delete store.accountingIntegrity;
  }

  const journal = store.journal;
  const firstSealed = journal.findIndex(hasJournalSeal);
  let previousHash = firstSealed < 0 ? GENESIS_HASH : journal[firstSealed].integrity.hash;
  let changed = 0;
  const lastPending = firstSealed < 0 ? journal.length - 1 : firstSealed - 1;

  for (let index = lastPending; index >= 0; index -= 1) {
    const entry = journal[index];
    const hash = journalHash(entry, previousHash);
    entry.integrity = {version: INTEGRITY_VERSION, previousHash, hash};
    previousHash = hash;
    changed += 1;
  }

  const headHash = journal[0]?.integrity?.hash || GENESIS_HASH;
  const previousAnchor = store.accountingIntegrity || {};
  if (!store.accountingIntegrity || changed || previousAnchor.journalHeadHash !== headHash || Number(previousAnchor.journalEntryCount) !== journal.length) {
    store.accountingIntegrity = {
      ...previousAnchor,
      version: INTEGRITY_VERSION,
      journalHeadHash: headHash,
      journalEntryCount: journal.length,
      sealedAt: new Date().toISOString()
    };
  }
  return changed;
}

function sealInvoiceIntegrity(store) {
  let changed = 0;
  for (const [kind, list] of [['customer', store.invoices || []], ['supplier', store.supplierInvoices || []]]) {
    for (const invoice of list) {
      if (!invoice.integrity) {
        invoice.integrity = {version: INTEGRITY_VERSION, sourceHash: invoiceSourceHash(invoice, kind)};
        changed += 1;
      }
      if (invoice.journalNumber && !invoice.integrity.bookingHash) {
        invoice.integrity.bookingHash = invoiceBookingHash(invoice, kind);
        changed += 1;
      }
    }
  }
  return changed;
}

function sealAccountingIntegrity(store) {
  const before = validateAccountingIntegrity(store);
  if (!before.ok) {
    const error = new Error(before.errors[0]);
    error.code = 'ACCOUNTING_INTEGRITY_ERROR';
    error.report = before;
    throw error;
  }
  const journalChanged = sealJournalIntegrity(store);
  const invoiceChanged = sealInvoiceIntegrity(store);
  const after = validateAccountingIntegrity(store);
  if (!after.ok) {
    const error = new Error(after.errors[0]);
    error.code = 'ACCOUNTING_INTEGRITY_ERROR';
    error.report = after;
    throw error;
  }
  return {journalChanged, invoiceChanged, report: after};
}

module.exports = {
  INTEGRITY_VERSION,
  GENESIS_HASH,
  stableStringify,
  journalHash,
  invoiceSourceHash,
  invoiceBookingHash,
  validateJournalIntegrity,
  validateInvoiceIntegrity,
  validateAccountingIntegrity,
  sealJournalIntegrity,
  sealInvoiceIntegrity,
  sealAccountingIntegrity
};
