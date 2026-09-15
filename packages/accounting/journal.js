'use strict';

(function registerJournalDomain(root, factory) {
  const Money = typeof module === 'object' && module.exports
    ? require('./money.js')
    : root?.RollandsMoney;
  const AccessControl = typeof module === 'object' && module.exports
    ? require('../access-control/authorization.js')
    : root?.RollandsAccessControl;
  const api = factory(Money, AccessControl);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RollandsJournal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createJournalDomain(Money, AccessControl) {
  if (!Money) throw new Error('Penningdomänen måste laddas före verifikationsmotorn.');
  if (!AccessControl) throw new Error('Behörighetsdomänen måste laddas före verifikationsmotorn.');

  const LEDGER_SCHEMA_VERSION = 1;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const PERIOD_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
  const ACCOUNT_PATTERN = /^\d{4}$/;
  const SERIES_PATTERN = /^[A-Z][A-Z0-9]{0,3}$/;
  const ENTRY_KINDS = new Set(['standard', 'reversal', 'replacement', 'opening']);
  const RESERVED_ENTRY_KINDS = new Set(['reversal', 'replacement']);
  const EVENT_TYPES = new Set(['ENTRY_POSTED', 'ENTRY_CORRECTED', 'PERIOD_LOCKED', 'PERIOD_UNLOCKED']);

  function journalError(message, code = 'JOURNAL_ERROR', details = undefined) {
    const error = new Error(message);
    error.name = 'JournalError';
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

  function validIsoDate(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }

  function validTimestamp(value) {
    return typeof value === 'string' && value.length >= 20 && !Number.isNaN(Date.parse(value));
  }

  function periodFromDate(date) {
    if (!validIsoDate(date)) throw journalError('Bokföringsdagen är ogiltig.', 'INVALID_DATE');
    return date.slice(0, 7);
  }

  function requireText(value, label, minimum = 1, maximum = 500) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length < minimum) throw journalError(`${label} måste innehålla minst ${minimum} tecken.`, 'INVALID_TEXT');
    if (text.length > maximum) throw journalError(`${label} får innehålla högst ${maximum} tecken.`, 'INVALID_TEXT');
    return text;
  }

  function requireActor(actor) {
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
      throw journalError('Personlig användaridentitet saknas.', 'MISSING_IDENTITY');
    }
    const id = typeof actor.id === 'string' ? actor.id.trim() : '';
    if (!id) throw journalError('Personlig användaridentitet saknas.', 'MISSING_IDENTITY');
    if (actor.disabled === true) throw journalError('Användarkontot är inaktiverat.', 'ACCOUNT_DISABLED');
    return {...actor, id};
  }

  function requirePermission(access, actor, permissionId) {
    try {
      return AccessControl.requirePermission(access, actor, permissionId);
    } catch (error) {
      throw journalError(error.message, error.code || 'ACCESS_DENIED', error.details);
    }
  }

  function normalizeNow(value) {
    const timestamp = value || new Date().toISOString();
    if (!validTimestamp(timestamp)) throw journalError('Tidsstämpeln är ogiltig.', 'INVALID_TIMESTAMP');
    return new Date(timestamp).toISOString();
  }

  function createIdentifier(context, prefix) {
    let value;
    if (typeof context?.idFactory === 'function') value = context.idFactory(prefix);
    else if (globalThis.crypto?.randomUUID) value = `${prefix}_${globalThis.crypto.randomUUID()}`;
    else throw journalError('Säker id-generator saknas.', 'MISSING_ID_FACTORY');
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) throw journalError('Id-generatorn returnerade ett ogiltigt id.', 'INVALID_ID');
    return id;
  }

  function cloneSource(source) {
    if (source == null) return {type: 'manual', reference: ''};
    if (typeof source !== 'object' || Array.isArray(source)) {
      throw journalError('Källan måste vara ett objekt.', 'INVALID_SOURCE');
    }
    return {
      type: requireText(source.type || 'manual', 'Källtypen', 1, 60),
      reference: typeof source.reference === 'string' ? source.reference.trim().slice(0, 160) : ''
    };
  }

  function cloneRow(row) {
    return {
      account: String(row.account || '').trim(),
      text: typeof row.text === 'string' ? row.text.trim().slice(0, 240) : '',
      debitOre: Number(row.debitOre || 0),
      creditOre: Number(row.creditOre || 0)
    };
  }

  function cloneEntry(entry) {
    return {
      ...entry,
      source: {...entry.source},
      rows: entry.rows.map(row => ({...row})),
      totals: {...entry.totals},
      links: entry.links ? {...entry.links} : undefined
    };
  }

  function clonePeriod(period) {
    return {
      ...period,
      history: Array.isArray(period.history) ? period.history.map(item => ({...item})) : []
    };
  }

  function cloneState(state) {
    return {
      schemaVersion: state.schemaVersion,
      currency: state.currency,
      fiscalYear: {...state.fiscalYear},
      defaultSeries: state.defaultSeries,
      entries: state.entries.map(cloneEntry),
      sequences: {...state.sequences},
      periods: Object.fromEntries(Object.entries(state.periods).map(([key, value]) => [key, clonePeriod(value)])),
      corrections: Object.fromEntries(Object.entries(state.corrections).map(([key, value]) => [key, {...value}])),
      events: state.events.map(event => ({...event}))
    };
  }

  function createLedger(options = {}) {
    const start = options.fiscalYearStart || `${new Date().getUTCFullYear()}-01-01`;
    const end = options.fiscalYearEnd || `${start.slice(0, 4)}-12-31`;
    if (!validIsoDate(start) || !validIsoDate(end) || start > end) {
      throw journalError('Räkenskapsåret har ogiltiga datum.', 'INVALID_FISCAL_YEAR');
    }
    const defaultSeries = String(options.defaultSeries || 'A').trim().toUpperCase();
    if (!SERIES_PATTERN.test(defaultSeries)) throw journalError('Standardserien är ogiltig.', 'INVALID_SERIES');

    return {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      currency: 'SEK',
      fiscalYear: {start, end},
      defaultSeries,
      entries: [],
      sequences: {},
      periods: {},
      corrections: {},
      events: []
    };
  }

  function validateRow(row, index) {
    const errors = [];
    const prefix = `Rad ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [`${prefix} saknas.`];
    if (!ACCOUNT_PATTERN.test(String(row.account || '').trim())) errors.push(`${prefix}: kontot måste bestå av fyra siffror.`);

    const debitOre = Number(row.debitOre || 0);
    const creditOre = Number(row.creditOre || 0);
    if (!Number.isSafeInteger(debitOre) || debitOre < 0) errors.push(`${prefix}: debet måste vara ett icke-negativt heltal i ören.`);
    if (!Number.isSafeInteger(creditOre) || creditOre < 0) errors.push(`${prefix}: kredit måste vara ett icke-negativt heltal i ören.`);
    if (Number.isSafeInteger(debitOre) && Number.isSafeInteger(creditOre)) {
      if (debitOre === 0 && creditOre === 0) errors.push(`${prefix}: belopp saknas.`);
      if (debitOre > 0 && creditOre > 0) errors.push(`${prefix}: samma rad får inte ha både debet och kredit.`);
    }
    if (row.text != null && typeof row.text !== 'string') errors.push(`${prefix}: radtexten måste vara text.`);
    return errors;
  }

  function calculateTotals(rows) {
    return {
      debitOre: Money.sumOre(rows.map(row => Number(row.debitOre || 0)), 'Verifikationens debet'),
      creditOre: Money.sumOre(rows.map(row => Number(row.creditOre || 0)), 'Verifikationens kredit')
    };
  }

  function validateEntryDraft(state, draft) {
    const errors = [];
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      return {ok: false, errors: ['Verifikationen saknas.'], totals: {debitOre: 0, creditOre: 0}};
    }

    if (!validIsoDate(draft.date)) errors.push('Bokföringsdagen är ogiltig.');
    else if (draft.date < state.fiscalYear.start || draft.date > state.fiscalYear.end) errors.push('Bokföringsdagen ligger utanför räkenskapsåret.');

    const description = typeof draft.description === 'string' ? draft.description.trim() : '';
    if (description.length < 3 || description.length > 240) errors.push('Beskrivningen måste innehålla 3–240 tecken.');

    const series = String(draft.series || state.defaultSeries || '').trim().toUpperCase();
    if (!SERIES_PATTERN.test(series)) errors.push('Verifikationsserien är ogiltig.');

    const kind = draft.kind || 'standard';
    if (!ENTRY_KINDS.has(kind)) errors.push('Verifikationstypen är ogiltig.');

    if (!Array.isArray(draft.rows) || draft.rows.length < 2) errors.push('Verifikationen måste innehålla minst två rader.');
    const rows = Array.isArray(draft.rows) ? draft.rows.map(cloneRow) : [];
    rows.forEach((row, index) => errors.push(...validateRow(row, index)));

    let totals = {debitOre: 0, creditOre: 0};
    if (!errors.some(error => /öre|belopp|debet|kredit/.test(error))) {
      try {
        totals = calculateTotals(rows);
        if (totals.debitOre !== totals.creditOre) errors.push(`Verifikationen balanserar inte: debet ${totals.debitOre} öre och kredit ${totals.creditOre} öre.`);
        if (totals.debitOre <= 0) errors.push('Verifikationens total måste vara större än noll.');
      } catch (error) {
        errors.push(error.message);
      }
    }

    return {ok: errors.length === 0, errors, totals, rows, series, kind, description};
  }

  function periodWithinFiscalYear(state, period) {
    if (!PERIOD_PATTERN.test(period)) return false;
    const first = `${period}-01`;
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = `${period}-${String(lastDay).padStart(2, '0')}`;
    return last >= state.fiscalYear.start && first <= state.fiscalYear.end;
  }

  function periodStatus(state, period) {
    const record = state.periods[period];
    return record?.status === 'locked' ? 'locked' : 'open';
  }

  function ensureOpenPeriod(state, date) {
    const period = periodFromDate(date);
    if (periodStatus(state, period) === 'locked') {
      throw journalError(`Bokföringsperioden ${period} är låst.`, 'PERIOD_LOCKED', {period});
    }
    return period;
  }

  function sequenceKey(series, year) {
    return `${series}:${year}`;
  }

  function appendEvent(state, type, actorId, at, details, relatedId, context) {
    const id = createIdentifier(context, 'event');
    if (state.events.some(event => event.id === id)) {
      throw journalError('Händelse-id används redan.', 'DUPLICATE_EVENT_ID');
    }
    state.events.push({id, type, actorId, at, details, relatedId: relatedId || ''});
  }

  function appendEntry(state, draft, context, permissionId) {
    const actor = requireActor(context?.actor);
    requirePermission(context?.access, actor, permissionId);

    const report = validateEntryDraft(state, draft);
    if (!report.ok) throw journalError(`Verifikationen är ogiltig: ${report.errors[0]}`, 'INVALID_ENTRY', report);
    const period = ensureOpenPeriod(state, draft.date);
    const next = cloneState(state);
    const year = draft.date.slice(0, 4);
    const key = sequenceKey(report.series, year);
    const sequence = Number(next.sequences[key] || 0) + 1;
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw journalError('Verifikationsserien är korrupt.', 'INVALID_SEQUENCE');

    const id = createIdentifier(context, 'entry');
    if (next.entries.some(entry => entry.id === id)) throw journalError('Verifikations-id används redan.', 'DUPLICATE_ENTRY_ID');
    const number = `${report.series}${sequence}`;
    if (next.entries.some(entry => entry.number === number && entry.date.startsWith(year))) {
      throw journalError('Verifikationsnumret används redan.', 'DUPLICATE_ENTRY_NUMBER');
    }

    const postedAt = normalizeNow(context?.now);
    const entry = {
      id,
      number,
      series: report.series,
      sequence,
      date: draft.date,
      period,
      description: report.description,
      kind: report.kind,
      status: 'posted',
      source: cloneSource(draft.source),
      createdBy: actor.id,
      postedAt,
      rows: report.rows,
      totals: report.totals,
      links: draft.links ? {...draft.links} : undefined
    };

    next.entries.push(entry);
    next.sequences[key] = sequence;
    appendEvent(next, 'ENTRY_POSTED', actor.id, postedAt, `${number}: ${entry.description}`, id, context);
    return {state: next, entry: cloneEntry(entry)};
  }

  function postEntry(state, draft, context = {}) {
    assertLedger(state);
    if (RESERVED_ENTRY_KINDS.has(draft?.kind)) {
      throw journalError('Mot- och ersättningsverifikationer får endast skapas genom rättelseflödet.', 'RESERVED_ENTRY_KIND');
    }
    return appendEntry(state, draft, context, 'accounting.post');
  }

  function swapRows(rows) {
    return rows.map(row => ({
      account: row.account,
      text: row.text ? `Motpost: ${row.text}` : '',
      debitOre: row.creditOre,
      creditOre: row.debitOre
    }));
  }

  function correctEntry(state, request, context = {}) {
    assertLedger(state);
    const actor = requireActor(context.actor);
    requirePermission(context.access, actor, 'accounting.correct');
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw journalError('Rättelsebegäran saknas.', 'INVALID_CORRECTION');
    }

    const original = state.entries.find(entry => entry.id === request.entryId);
    if (!original) throw journalError('Verifikationen som ska rättas finns inte.', 'ENTRY_NOT_FOUND');
    if (original.kind === 'reversal') throw journalError('En motverifikation kan inte rättas direkt. Rätta ursprungsposten eller ersättningsposten.', 'REVERSAL_NOT_CORRECTABLE');
    if (state.corrections[original.id]) throw journalError('Verifikationen är redan rättad.', 'ENTRY_ALREADY_CORRECTED');

    const date = request.date;
    if (!validIsoDate(date) || date < state.fiscalYear.start || date > state.fiscalYear.end) {
      throw journalError('Rättelsedatumet är ogiltigt eller ligger utanför räkenskapsåret.', 'INVALID_DATE');
    }
    ensureOpenPeriod(state, date);
    const reason = requireText(request.reason, 'Rättelseorsaken', 5, 300);
    const commonContext = {...context, actor};

    const reversalResult = appendEntry(state, {
      date,
      series: request.series || original.series,
      description: `Motverifikation till ${original.number}: ${reason}`,
      kind: 'reversal',
      source: {type: 'correction', reference: original.number},
      links: {reversalOf: original.id},
      rows: swapRows(original.rows)
    }, commonContext, 'accounting.correct');

    let workingState = reversalResult.state;
    let replacementEntry = null;
    if (request.replacement) {
      const replacementDraft = {
        ...request.replacement,
        date: request.replacement.date || date,
        series: request.replacement.series || original.series,
        kind: 'replacement',
        source: request.replacement.source || {type: 'correction', reference: original.number},
        links: {replaces: original.id, reversalEntryId: reversalResult.entry.id}
      };
      const replacementResult = appendEntry(workingState, replacementDraft, commonContext, 'accounting.correct');
      workingState = replacementResult.state;
      replacementEntry = replacementResult.entry;
    }

    const next = cloneState(workingState);
    const completedAt = normalizeNow(context.now);
    next.corrections[original.id] = {
      originalEntryId: original.id,
      reversalEntryId: reversalResult.entry.id,
      replacementEntryId: replacementEntry?.id || '',
      reason,
      correctedBy: actor.id,
      correctedAt: completedAt
    };
    appendEvent(next, 'ENTRY_CORRECTED', actor.id, completedAt, `${original.number}: ${reason}`, original.id, context);

    return {
      state: next,
      original: cloneEntry(original),
      reversal: reversalResult.entry,
      replacement: replacementEntry
    };
  }

  function lockPeriod(state, period, context = {}) {
    assertLedger(state);
    const actor = requireActor(context.actor);
    requirePermission(context.access, actor, 'period.lock');
    if (!periodWithinFiscalYear(state, period)) throw journalError('Perioden är ogiltig eller ligger utanför räkenskapsåret.', 'INVALID_PERIOD');
    if (periodStatus(state, period) === 'locked') throw journalError(`Perioden ${period} är redan låst.`, 'PERIOD_ALREADY_LOCKED');

    const reason = requireText(context.reason || 'Period stängd efter kontroll', 'Orsaken', 3, 300);
    const at = normalizeNow(context.now);
    const next = cloneState(state);
    const history = next.periods[period]?.history || [];
    history.push({action: 'locked', actorId: actor.id, at, reason});
    next.periods[period] = {status: 'locked', lockedBy: actor.id, lockedAt: at, reason, history};
    appendEvent(next, 'PERIOD_LOCKED', actor.id, at, `${period}: ${reason}`, period, context);
    return {state: next, period: clonePeriod(next.periods[period])};
  }

  function unlockPeriod(state, period, context = {}) {
    assertLedger(state);
    const actor = requireActor(context.actor);
    if (!periodWithinFiscalYear(state, period)) throw journalError('Perioden är ogiltig eller ligger utanför räkenskapsåret.', 'INVALID_PERIOD');
    if (periodStatus(state, period) !== 'locked') throw journalError(`Perioden ${period} är inte låst.`, 'PERIOD_NOT_LOCKED');

    const requestedBy = typeof context.requestedBy === 'string' ? context.requestedBy.trim() : '';
    const decision = AccessControl.evaluateWorkflowAction(context.access, actor, 'period-unlock', {
      requestedBy,
      unlockedBy: actor.id
    });
    if (!decision.allowed) throw journalError(decision.reason, decision.code, decision);

    const reason = requireText(context.reason, 'Orsaken till upplåsningen', 5, 300);
    const at = normalizeNow(context.now);
    const next = cloneState(state);
    const previous = next.periods[period];
    const history = previous.history || [];
    history.push({action: 'unlocked', actorId: actor.id, requestedBy, at, reason});
    next.periods[period] = {
      status: 'open',
      unlockedBy: actor.id,
      unlockedAt: at,
      requestedBy,
      reason,
      history
    };
    appendEvent(next, 'PERIOD_UNLOCKED', actor.id, at, `${period}: ${reason}`, period, context);
    return {state: next, period: clonePeriod(next.periods[period])};
  }

  function validateLedger(state) {
    const errors = [];
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return {ok: false, errors: ['Huvudboken måste vara ett objekt.'], summary: {}};
    }
    if (state.schemaVersion !== LEDGER_SCHEMA_VERSION) errors.push(`schemaVersion måste vara ${LEDGER_SCHEMA_VERSION}.`);
    if (state.currency !== 'SEK') errors.push('Valutan måste vara SEK.');
    if (!validIsoDate(state.fiscalYear?.start) || !validIsoDate(state.fiscalYear?.end) || state.fiscalYear.start > state.fiscalYear.end) {
      errors.push('Räkenskapsåret är ogiltigt.');
    }
    if (!SERIES_PATTERN.test(state.defaultSeries || '')) errors.push('Standardserien är ogiltig.');
    for (const key of ['entries', 'events']) if (!Array.isArray(state[key])) errors.push(`${key} måste vara en lista.`);
    for (const key of ['sequences', 'periods', 'corrections']) {
      if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) errors.push(`${key} måste vara ett objekt.`);
    }
    if (errors.length) return {ok: false, errors, summary: {}};

    const ids = new Set();
    const numbers = new Set();
    const maxima = new Map();
    const seenSequences = new Map();
    const entriesById = new Map();

    for (const [index, entry] of state.entries.entries()) {
      const prefix = `entries[${index}]`;
      if (typeof entry.id !== 'string' || !entry.id) errors.push(`${prefix}.id saknas.`);
      else if (ids.has(entry.id)) errors.push(`Dubblerat verifikations-id: ${entry.id}.`);
      else {
        ids.add(entry.id);
        entriesById.set(entry.id, entry);
      }

      const numberKey = `${entry.date?.slice(0, 4)}:${entry.number}`;
      if (numbers.has(numberKey)) errors.push(`Dubblerat verifikationsnummer: ${entry.number}.`);
      else numbers.add(numberKey);

      if (!validIsoDate(entry.date) || entry.date < state.fiscalYear.start || entry.date > state.fiscalYear.end) errors.push(`${prefix}.date är ogiltigt.`);
      if (entry.period !== entry.date?.slice(0, 7)) errors.push(`${prefix}.period stämmer inte med datumet.`);
      if (!SERIES_PATTERN.test(entry.series || '')) errors.push(`${prefix}.series är ogiltig.`);
      if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= 0) errors.push(`${prefix}.sequence är ogiltig.`);
      if (entry.number !== `${entry.series}${entry.sequence}`) errors.push(`${prefix}.number stämmer inte med serie och löpnummer.`);
      if (!ENTRY_KINDS.has(entry.kind)) errors.push(`${prefix}.kind är ogiltig.`);
      if (entry.status !== 'posted') errors.push(`${prefix}.status måste vara posted.`);
      if (!validTimestamp(entry.postedAt)) errors.push(`${prefix}.postedAt är ogiltig.`);
      if (typeof entry.createdBy !== 'string' || !entry.createdBy) errors.push(`${prefix}.createdBy saknas.`);
      if (typeof entry.description !== 'string' || entry.description.trim().length < 3) errors.push(`${prefix}.description är ogiltig.`);
      if (entry.kind === 'reversal' && !entry.links?.reversalOf) errors.push(`${prefix} saknar koppling till ursprungsposten.`);
      if (entry.kind === 'replacement' && (!entry.links?.replaces || !entry.links?.reversalEntryId)) errors.push(`${prefix} saknar fullständig rättelsekoppling.`);

      if (!Array.isArray(entry.rows) || entry.rows.length < 2) errors.push(`${prefix}.rows måste innehålla minst två rader.`);
      else {
        entry.rows.forEach((row, rowIndex) => errors.push(...validateRow(row, rowIndex).map(error => `${prefix}: ${error}`)));
        try {
          const totals = calculateTotals(entry.rows);
          if (totals.debitOre !== totals.creditOre || totals.debitOre <= 0) errors.push(`${prefix} balanserar inte.`);
          if (entry.totals?.debitOre !== totals.debitOre || entry.totals?.creditOre !== totals.creditOre) errors.push(`${prefix}.totals stämmer inte.`);
        } catch (error) {
          errors.push(`${prefix}: ${error.message}`);
        }
      }

      const key = sequenceKey(entry.series, entry.date?.slice(0, 4));
      const sequences = seenSequences.get(key) || new Set();
      if (sequences.has(entry.sequence)) errors.push(`Dubblerat löpnummer ${key}:${entry.sequence}.`);
      sequences.add(entry.sequence);
      seenSequences.set(key, sequences);
      maxima.set(key, Math.max(maxima.get(key) || 0, Number(entry.sequence || 0)));
    }

    const sequenceKeys = new Set([...Object.keys(state.sequences), ...maxima.keys()]);
    for (const key of sequenceKeys) {
      const declared = state.sequences[key];
      const maximum = maxima.get(key) || 0;
      if (!Number.isSafeInteger(declared) || declared < 0) {
        errors.push(`Löpnummer ${key} är ogiltigt.`);
        continue;
      }
      if (declared !== maximum) errors.push(`Löpnummer ${key} ska vara ${maximum} men är ${declared}.`);
      const seen = seenSequences.get(key) || new Set();
      for (let sequence = 1; sequence <= maximum; sequence += 1) {
        if (!seen.has(sequence)) errors.push(`Löpnummer ${key} saknar ${sequence}.`);
      }
    }

    for (const [period, record] of Object.entries(state.periods)) {
      if (!periodWithinFiscalYear(state, period)) errors.push(`Ogiltig periodpost: ${period}.`);
      if (!['open', 'locked'].includes(record?.status)) errors.push(`Period ${period} har ogiltig status.`);
      if (!Array.isArray(record?.history)) errors.push(`Period ${period} saknar historik.`);
      else {
        record.history.forEach((item, index) => {
          if (!['locked', 'unlocked'].includes(item?.action)) errors.push(`Period ${period}, historik ${index + 1}: ogiltig åtgärd.`);
          if (typeof item?.actorId !== 'string' || !item.actorId) errors.push(`Period ${period}, historik ${index + 1}: aktör saknas.`);
          if (!validTimestamp(item?.at)) errors.push(`Period ${period}, historik ${index + 1}: tidsstämpel är ogiltig.`);
          if (typeof item?.reason !== 'string' || item.reason.trim().length < 3) errors.push(`Period ${period}, historik ${index + 1}: orsak saknas.`);
        });
        const expectedAction = record.status === 'locked' ? 'locked' : 'unlocked';
        if (record.history.length === 0 || record.history.at(-1)?.action !== expectedAction) {
          errors.push(`Period ${period} har en status som inte stämmer med historiken.`);
        }
      }
    }

    for (const [originalId, correction] of Object.entries(state.corrections)) {
      const original = entriesById.get(originalId);
      const reversal = entriesById.get(correction.reversalEntryId);
      const replacement = correction.replacementEntryId ? entriesById.get(correction.replacementEntryId) : null;
      if (!original) errors.push(`Rättelsen hänvisar till okänd ursprungspost ${originalId}.`);
      if (!reversal) errors.push(`Rättelsen för ${originalId} saknar motverifikation.`);
      else {
        if (reversal.kind !== 'reversal') errors.push(`Rättelsen för ${originalId} pekar inte på en motverifikation.`);
        if (reversal.links?.reversalOf !== originalId) errors.push(`Motverifikationen för ${originalId} har fel ursprungskoppling.`);
      }
      if (correction.replacementEntryId && !replacement) errors.push(`Rättelsen för ${originalId} hänvisar till okänd ersättningspost.`);
      if (replacement) {
        if (replacement.kind !== 'replacement') errors.push(`Rättelsen för ${originalId} pekar inte på en ersättningspost.`);
        if (replacement.links?.replaces !== originalId || replacement.links?.reversalEntryId !== correction.reversalEntryId) {
          errors.push(`Ersättningsposten för ${originalId} har fel rättelsekoppling.`);
        }
      }
      if (correction.originalEntryId !== originalId) errors.push(`Rättelsen för ${originalId} har fel original-id.`);
      if (typeof correction.correctedBy !== 'string' || !correction.correctedBy) errors.push(`Rättelsen för ${originalId} saknar aktör.`);
      if (!validTimestamp(correction.correctedAt)) errors.push(`Rättelsen för ${originalId} har ogiltig tidsstämpel.`);
      if (typeof correction.reason !== 'string' || correction.reason.trim().length < 5) errors.push(`Rättelsen för ${originalId} saknar giltig orsak.`);
    }

    for (const entry of state.entries) {
      if (entry.kind === 'reversal') {
        const correction = state.corrections[entry.links?.reversalOf];
        if (!correction || correction.reversalEntryId !== entry.id) {
          errors.push(`Motverifikationen ${entry.id} saknar motsvarande rättelsepost.`);
        }
      }
      if (entry.kind === 'replacement') {
        const correction = state.corrections[entry.links?.replaces];
        if (!correction || correction.replacementEntryId !== entry.id || correction.reversalEntryId !== entry.links?.reversalEntryId) {
          errors.push(`Ersättningsposten ${entry.id} saknar motsvarande rättelsepost.`);
        }
      }
    }

    const eventIds = new Set();
    for (const [index, event] of state.events.entries()) {
      const prefix = `events[${index}]`;
      if (typeof event?.id !== 'string' || !event.id) errors.push(`${prefix}.id saknas.`);
      else if (eventIds.has(event.id)) errors.push(`Dubblerat händelse-id: ${event.id}.`);
      else eventIds.add(event.id);
      if (!EVENT_TYPES.has(event?.type)) errors.push(`${prefix}.type är ogiltig.`);
      if (typeof event?.actorId !== 'string' || !event.actorId) errors.push(`${prefix}.actorId saknas.`);
      if (!validTimestamp(event?.at)) errors.push(`${prefix}.at är ogiltig.`);
      if (typeof event?.details !== 'string' || !event.details) errors.push(`${prefix}.details saknas.`);
      if (event?.type === 'ENTRY_POSTED' && !entriesById.has(event.relatedId)) errors.push(`${prefix} hänvisar till okänd verifikation.`);
      if (event?.type === 'ENTRY_CORRECTED' && !state.corrections[event.relatedId]) errors.push(`${prefix} hänvisar till okänd rättelse.`);
      if ((event?.type === 'PERIOD_LOCKED' || event?.type === 'PERIOD_UNLOCKED') && !state.periods[event.relatedId]) {
        errors.push(`${prefix} hänvisar till okänd period.`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      summary: {
        entries: state.entries.length,
        periods: Object.keys(state.periods).length,
        lockedPeriods: Object.values(state.periods).filter(period => period.status === 'locked').length,
        corrections: Object.keys(state.corrections).length,
        events: state.events.length
      }
    };
  }

  function assertLedger(state) {
    const report = validateLedger(state);
    if (!report.ok) throw journalError(`Huvudboken är ogiltig: ${report.errors[0]}`, 'INVALID_LEDGER', report);
    return report;
  }

  return Object.freeze({
    LEDGER_SCHEMA_VERSION,
    DATE_PATTERN,
    PERIOD_PATTERN,
    ACCOUNT_PATTERN,
    SERIES_PATTERN,
    validIsoDate,
    periodFromDate,
    createLedger,
    validateRow,
    calculateTotals,
    validateEntryDraft,
    validateLedger,
    assertLedger,
    periodStatus,
    postEntry,
    correctEntry,
    lockPeriod,
    unlockPeriod
  });
});
