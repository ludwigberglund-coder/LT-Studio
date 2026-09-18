'use strict';

(function registerReceivables(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RollandsReceivables = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createReceivablesDomain() {
  const RECEIVABLE_COLUMNS = Object.freeze([
    {id:'period', label:'Period', defaultVisible:true},
    {id:'aviType', label:'Avityp', defaultVisible:true},
    {id:'paymentMethod', label:'Bet sätt', defaultVisible:true},
    {id:'paymentAccount', label:'Girokonto', defaultVisible:true},
    {id:'invoiceNumber', label:'Avinr', defaultVisible:true},
    {id:'invoicePostingDate', label:'Bokfdatum avi/fakt', defaultVisible:true},
    {id:'invoiceAmountOre', label:'Avibelopp', defaultVisible:true, money:true},
    {id:'dueDate', label:'Ffd', defaultVisible:true},
    {id:'latestReminderDate', label:'Senaste påm', defaultVisible:true},
    {id:'invoiceAccount', label:'Avi kont', defaultVisible:true},
    {id:'batchNumber', label:'Buntnr', defaultVisible:true},
    {id:'paymentDate', label:'Betdatum', defaultVisible:true},
    {id:'transactionPostingDate', label:'Bokfdatum trans', defaultVisible:true},
    {id:'bookingType', label:'Bokntyp', defaultVisible:true},
    {id:'transactionNumber', label:'Transnr', defaultVisible:true},
    {id:'transactionAmountOre', label:'Transbelopp', defaultVisible:true, money:true},
    {id:'transactionApproved', label:'Trans godk', defaultVisible:true},
    {id:'transactionAccount', label:'Trans kont', defaultVisible:true},
    {id:'remainingOre', label:'Restbelopp', defaultVisible:true, money:true}
  ]);

  function domainError(message, code, statusCode = 422) {
    const error = new Error(message);
    error.name = 'ReceivablesError';
    error.code = code;
    error.statusCode = statusCode;
    return error;
  }

  function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function assertIsoDate(value, label = 'Datum') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw domainError(`${label} måste anges som ÅÅÅÅ-MM-DD.`, 'INVALID_DATE');
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== value) throw domainError(`${label} är inte ett giltigt kalenderdatum.`, 'INVALID_DATE');
    return value;
  }

  function assertOre(value, label = 'Belopp') {
    if (!Number.isSafeInteger(value)) throw domainError(`${label} måste lagras som heltal i ören.`, 'INVALID_MONEY');
    return value;
  }

  function daysInYear(year) {
    return new Date(Date.UTC(year, 1, 29)).getUTCDate() === 29 ? 366 : 365;
  }

  function daysBetween(fromDate, toDate) {
    assertIsoDate(fromDate, 'Startdatum');
    assertIsoDate(toDate, 'Slutdatum');
    const from = Date.parse(`${fromDate}T00:00:00Z`);
    const to = Date.parse(`${toDate}T00:00:00Z`);
    return Math.floor((to - from) / 86400000);
  }

  function addDays(date, days) {
    assertIsoDate(date);
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0,10);
  }

  function rateTable(config) {
    const rows = Array.isArray(config?.referenceRates) ? config.referenceRates : [];
    const normalized = rows.map(row => ({
      validFrom: assertIsoDate(row.validFrom, 'Referensräntans startdatum'),
      validTo: assertIsoDate(row.validTo, 'Referensräntans slutdatum'),
      basisPoints: Number(row.basisPoints)
    })).sort((a,b) => a.validFrom.localeCompare(b.validFrom));
    if (!normalized.length || normalized.some(row => !Number.isInteger(row.basisPoints) || row.validTo < row.validFrom)) {
      throw domainError('Referensräntorna är inte korrekt konfigurerade.', 'INVALID_RATE_CONFIG', 500);
    }
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index].validFrom <= normalized[index - 1].validTo) {
        throw domainError('Referensränteperioderna får inte överlappa varandra.', 'INVALID_RATE_CONFIG', 500);
      }
    }
    return normalized;
  }

  function referenceRateFor(date, config) {
    assertIsoDate(date);
    const selected = rateTable(config).find(row => row.validFrom <= date && date <= row.validTo) || null;
    if (!selected) throw domainError(`Verifierad referensränta saknas för ${date}.`, 'MISSING_REFERENCE_RATE', 409);
    return selected;
  }

  function nextRateBoundary(date, config) {
    const rate = referenceRateFor(date, config);
    return addDays(rate.validTo, 1);
  }

  function roundDividePositive(numerator, denominator) {
    if (numerator < 0n || denominator <= 0n) throw domainError('Ränteberäkningen fick ett ogiltigt tal.', 'INVALID_INTEREST_INPUT', 500);
    return (numerator + denominator / 2n) / denominator;
  }

  function statutoryInterest(principalOre, fromDate, toDate, config) {
    assertOre(principalOre, 'Kapitalbelopp');
    if (principalOre < 0) throw domainError('Kapitalbeloppet får inte vara negativt.', 'INVALID_INTEREST_INPUT');
    assertIsoDate(fromDate, 'Räntestart');
    assertIsoDate(toDate, 'Räntedatum');
    if (toDate <= fromDate || principalOre === 0) return {interestOre:0, days:0, segments:[]};
    const margin = Number(config?.interestActMarginBasisPoints);
    if (!Number.isInteger(margin)) throw domainError('Räntelagens marginal saknas i konfigurationen.', 'INVALID_RATE_CONFIG', 500);

    let cursor = fromDate;
    let interestOre = 0;
    let totalDays = 0;
    const segments = [];
    while (cursor < toDate) {
      const currentYear = Number(cursor.slice(0,4));
      const nextYear = `${currentYear + 1}-01-01`;
      const rate = referenceRateFor(cursor, config);
      const rateBoundary = nextRateBoundary(cursor, config);
      const end = [toDate, nextYear, rateBoundary].filter(Boolean).sort()[0];
      const days = daysBetween(cursor, end);
      if (days <= 0) throw domainError('Ränteperioden kunde inte delas upp korrekt.', 'INVALID_RATE_CONFIG', 500);
      const annualBasisPoints = rate.basisPoints + margin;
      const numerator = BigInt(principalOre) * BigInt(annualBasisPoints) * BigInt(days);
      const denominator = 10000n * BigInt(daysInYear(currentYear));
      const segmentInterest = Number(roundDividePositive(numerator, denominator));
      interestOre += segmentInterest;
      totalDays += days;
      segments.push(Object.freeze({
        from: cursor,
        to: end,
        days,
        principalOre,
        referenceRateBasisPoints: rate.basisPoints,
        referenceRateValidFrom: rate.validFrom,
        referenceRateValidTo: rate.validTo,
        annualRateBasisPoints: annualBasisPoints,
        rateConfigVersion: Number(config?.version || 0),
        rateConfigVerifiedAt: String(config?.verifiedAt || ''),
        interestOre: segmentInterest
      }));
      cursor = end;
    }
    return {interestOre, days:totalDays, segments};
  }

  function principalEvents(invoice) {
    const totalOre = assertOre(invoice?.totalOre, 'Fakturabelopp');
    const remainingOre = assertOre(invoice?.remainingOre, 'Restbelopp');
    if (totalOre < 0) throw domainError('Fakturabeloppet får inte vara negativt i ränteflödet.', 'INVALID_BALANCE_HISTORY', 409);
    const supported = new Set(['payment','credit']);
    const events = [];
    for (const transaction of Array.isArray(invoice?.transactions) ? invoice.transactions : []) {
      if (transaction?.approved === false) continue;
      const type = String(transaction?.transactionType || transaction?.type || '').trim();
      if (!supported.has(type)) throw domainError(`Transaktionstypen ${type || 'saknas'} kan inte användas för automatisk ränteberäkning.`, 'UNSUPPORTED_BALANCE_HISTORY', 409);
      const amountOre = assertOre(transaction?.amountOre, 'Transaktionsbelopp');
      if (amountOre >= 0) throw domainError('Betalningar och krediter måste minska kundfordran i räntehistoriken.', 'INVALID_BALANCE_HISTORY', 409);
      const effectiveDate = type === 'payment'
        ? assertIsoDate(transaction?.paymentDate, 'Betalningsdatum')
        : assertIsoDate(transaction?.postingDate || transaction?.paymentDate, 'Kreditdatum');
      if (invoice?.invoiceDate && effectiveDate < assertIsoDate(invoice.invoiceDate, 'Fakturadatum')) {
        throw domainError('En saldoändring ligger före fakturadatum och måste granskas manuellt.', 'INVALID_BALANCE_HISTORY', 409);
      }
      events.push(Object.freeze({id:String(transaction?.id || ''),type,effectiveDate,amountOre}));
    }
    events.sort((a,b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id));
    let reconciled = totalOre;
    for (const event of events) {
      reconciled += event.amountOre;
      if (reconciled < 0) throw domainError('Saldohistoriken innehåller en överbetalning som kräver manuell räntebedömning.', 'UNSUPPORTED_BALANCE_HISTORY', 409);
    }
    if (reconciled !== remainingOre) {
      throw domainError('Fakturans transaktionshistorik stämmer inte med aktuellt restbelopp. Automatisk ränta är spärrad.', 'BALANCE_HISTORY_MISMATCH', 409);
    }
    return Object.freeze({totalOre,remainingOre,events:Object.freeze(events)});
  }

  function balanceHistoryBetween(invoice, fromDate, toDate) {
    assertIsoDate(fromDate, 'Räntestart');
    assertIsoDate(toDate, 'Räntedatum');
    const history = principalEvents(invoice);
    let principal = history.totalOre;
    for (const event of history.events) if (event.effectiveDate <= fromDate) principal += event.amountOre;
    if (principal < 0) throw domainError('Saldohistoriken kan inte användas för automatisk ränta.', 'INVALID_BALANCE_HISTORY', 409);
    const events = history.events.filter(event => event.effectiveDate > fromDate && event.effectiveDate <= toDate);
    let endingPrincipal = principal;
    for (const event of events) endingPrincipal += event.amountOre;
    return Object.freeze({openingPrincipalOre:principal,endingPrincipalOre:endingPrincipal,events});
  }

  function statutoryInterestFromHistory(invoice, fromDate, toDate, config) {
    const history = balanceHistoryBetween(invoice, fromDate, toDate);
    if (toDate <= fromDate) return {interestOre:0,days:0,segments:[],principalOre:history.endingPrincipalOre};
    let cursor = fromDate;
    let principal = history.openingPrincipalOre;
    let interestOre = 0;
    let totalDays = 0;
    const segments = [];
    for (const event of [...history.events,{effectiveDate:toDate,amountOre:0,type:'boundary',id:'boundary'}]) {
      if (event.effectiveDate > cursor && principal > 0) {
        const calculation = statutoryInterest(principal,cursor,event.effectiveDate,config);
        interestOre += calculation.interestOre;
        totalDays += calculation.days;
        segments.push(...calculation.segments);
      }
      if (event.type !== 'boundary') {
        principal += event.amountOre;
        if (principal < 0) throw domainError('Saldohistoriken kan inte användas för automatisk ränta.', 'UNSUPPORTED_BALANCE_HISTORY', 409);
      }
      cursor = event.effectiveDate;
    }
    return Object.freeze({interestOre,days:totalDays,segments:Object.freeze(segments),principalOre:history.endingPrincipalOre});
  }

  function createInvoiceComment({invoiceId, companyId, actor, text, now = new Date().toISOString()}) {
    if (!nonEmpty(invoiceId) || !nonEmpty(companyId)) throw domainError('Faktura och företag måste vara angivna.', 'MISSING_REFERENCE');
    if (!actor || !nonEmpty(actor.id) || !nonEmpty(actor.name)) throw domainError('Kommentarer kräver en personlig användaridentitet.', 'MISSING_IDENTITY', 401);
    const body = String(text || '').trim();
    if (!body) throw domainError('Skriv en fakturakommentar.', 'EMPTY_COMMENT');
    if (body.length > 2000) throw domainError('Fakturakommentaren får vara högst 2 000 tecken.', 'COMMENT_TOO_LONG');
    const createdAt = new Date(now).toISOString();
    return Object.freeze({
      id: `comment_${cryptoId()}`,
      companyId: companyId.trim(),
      invoiceId: invoiceId.trim(),
      text: body,
      authorId: actor.id.trim(),
      authorName: actor.name.trim(),
      createdAt
    });
  }

  function cryptoId() {
    if (typeof require === 'function') {
      try { return require('node:crypto').randomUUID(); } catch {}
    }
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    throw domainError('Säker slumpgenerator saknas.', 'NO_SECURE_RANDOM', 500);
  }

  function latestReminderDate(invoice) {
    const dates = (invoice?.reminders || []).map(item => String(item.reminderDate || item.sentAt || item.createdAt || '').slice(0,10)).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
    return dates.sort().at(-1) || '';
  }

  function reminderPreview(invoice, options, config) {
    const reminderDate = assertIsoDate(options?.reminderDate || options?.sentDate, 'Påminnelsedatum');
    const dueDate = assertIsoDate(invoice?.dueDate, 'Förfallodatum');
    const remainingOre = assertOre(invoice?.remainingOre, 'Restbelopp');
    if (remainingOre <= 0) throw domainError('Fakturan har inget positivt restbelopp att påminna om.', 'NOT_OUTSTANDING', 409);
    if (reminderDate <= dueDate) throw domainError('En betalningspåminnelse får skapas först efter förfallodagen i detta arbetsflöde.', 'NOT_OVERDUE');
    const balance = balanceHistoryBetween(invoice,dueDate,reminderDate);
    if (balance.endingPrincipalOre <= 0) throw domainError('Fakturan hade inget positivt restbelopp på påminnelsedatumet.', 'NOT_OUTSTANDING', 409);

    const feeRequested = options?.includeReminderFee === true;
    const feeAgreed = options?.reminderFeeAgreed === true;
    if (feeRequested && config?.rules?.reminderFeeRequiresAgreement !== false && !feeAgreed) {
      throw domainError('Påminnelseavgift får inte läggas till utan att den avtalats senast när skulden uppkom.', 'REMINDER_FEE_NOT_AGREED', 409);
    }
    const reminderFeeOre = feeRequested ? assertOre(Number(config?.reminderFeeOre), 'Påminnelseavgift') : 0;
    const interest = options?.includeInterest === false
      ? {interestOre:0, days:0, segments:[], principalOre:balance.endingPrincipalOre}
      : statutoryInterestFromHistory(invoice, dueDate, reminderDate, config);

    const businessCompensation = options?.includeBusinessLatePaymentCompensation === true
      ? assertOre(Number(config?.businessLatePaymentCompensationOre), 'Förseningsersättning')
      : 0;
    if (businessCompensation && options?.customerType !== 'business' && options?.customerType !== 'public-body') {
      throw domainError('Förseningsersättning på 450 kr får inte användas för konsumentkund i detta arbetsflöde.', 'INVALID_LATE_PAYMENT_COMPENSATION', 409);
    }
    if (businessCompensation && reminderFeeOre) {
      throw domainError('Förseningsersättning på 450 kr och påminnelseavgift på 60 kr får inte läggas ovanpå varandra i detta arbetsflöde. Välj den ersättning som är rätt för ärendet.', 'COLLECTION_COST_OVERLAP', 409);
    }

    return Object.freeze({
      reminderDate,
      originalDueDate: dueDate,
      principalOre: balance.endingPrincipalOre,
      reminderFeeOre,
      interestOre: interest.interestOre,
      businessLatePaymentCompensationOre: businessCompensation,
      totalDueOre: balance.endingPrincipalOre + reminderFeeOre + interest.interestOre + businessCompensation,
      interest,
      statutoryRateOnReminderDateBasisPoints: options?.includeInterest === false ? null : referenceRateFor(reminderDate, config).basisPoints + Number(config.interestActMarginBasisPoints)
    });
  }

  function createReminderRecord({invoice, companyId, actor, options, config, now = new Date().toISOString()}) {
    if (!actor || !nonEmpty(actor.id) || !nonEmpty(actor.name)) throw domainError('Påminnelsen kräver en personlig användaridentitet.', 'MISSING_IDENTITY', 401);
    const preview = reminderPreview(invoice, options, config);
    return Object.freeze({
      id: `reminder_${cryptoId()}`,
      companyId: String(companyId || '').trim(),
      invoiceId: String(invoice.id || '').trim(),
      createdAt: new Date(now).toISOString(),
      reminderDate: preview.reminderDate,
      createdBy: actor.id.trim(),
      createdByName: actor.name.trim(),
      kind: options?.kind === 'escalation' ? 'escalation' : 'payment-reminder',
      principalOre: preview.principalOre,
      reminderFeeOre: preview.reminderFeeOre,
      interestOre: preview.interestOre,
      businessLatePaymentCompensationOre: preview.businessLatePaymentCompensationOre,
      totalDueOre: preview.totalDueOre,
      annualRateBasisPoints: preview.statutoryRateOnReminderDateBasisPoints || 0,
      interestSegments: preview.interest.segments.map(segment => Object.freeze({...segment,interestBasis:options?.interestBasis || null})),
      note: String(options?.note || '').trim().slice(0,1000)
    });
  }

  function matchPaymentProposal(transaction, invoices) {
    const amountOre = assertOre(transaction?.amountOre, 'Bankbelopp');
    const text = `${transaction?.reference || ''} ${transaction?.text || ''}`.toLocaleLowerCase('sv');
    const candidates = (invoices || []).filter(invoice => {
      const remainingOre = Number(invoice.remainingOre);
      if (!Number.isSafeInteger(remainingOre) || remainingOre <= 0 || remainingOre !== Math.abs(amountOre)) return false;
      const tokens = [invoice.invoiceNumber, invoice.ocr].filter(nonEmpty).map(value => String(value).toLocaleLowerCase('sv'));
      return tokens.some(token => text.includes(token));
    });
    if (candidates.length !== 1) {
      return Object.freeze({decision:'review', confidence:0, reason:candidates.length ? 'Flera fakturor matchar betalningsinformationen.' : 'Ingen entydig faktura matchar både referens och restbelopp.', invoiceId:null});
    }
    return Object.freeze({decision:'exact-match', confidence:1, reason:'Referens/OCR och exakt restbelopp ger en entydig matchning.', invoiceId:candidates[0].id});
  }

  function receivableRow(invoice, transaction = null) {
    const reminderDate = latestReminderDate(invoice);
    const customer = invoice.kind !== 'supplier';
    const payment = transaction?.type === 'payment' ? transaction : null;
    const invoiceAccount = invoice.invoiceAccount || (customer ? '1510' : '2440');
    return Object.freeze({
      period: String(invoice.invoiceDate || invoice.date || '').slice(0,7),
      aviType: invoice.credit ? 'Kreditfaktura' : (customer ? 'Kundfaktura' : 'Lev.faktura'),
      paymentMethod: payment?.method || invoice.paymentMethod || 'Ej angivet',
      paymentAccount: invoice.paymentAccount || invoice.seller?.paymentAccount || '',
      invoiceNumber: invoice.invoiceNumber || invoice.number || '',
      invoicePostingDate: invoice.postingDate || invoice.bookedDate || invoice.invoiceDate || invoice.date || '',
      invoiceAmountOre: transaction ? null : Number(invoice.totalOre ?? invoice.total * 100),
      dueDate: invoice.dueDate || '',
      latestReminderDate: reminderDate,
      invoiceAccount,
      batchNumber: transaction?.batchNumber || transaction?.batch || invoice.batchNumber || '',
      paymentDate: payment?.date || '',
      transactionPostingDate: transaction?.postingDate || transaction?.date || (transaction ? '' : (invoice.postingDate || invoice.bookedDate || '')),
      bookingType: transaction?.bookingType || (transaction ? 'Transaktion' : 'Faktura'),
      transactionNumber: transaction?.transactionNumber || transaction?.journalNumber || invoice.journalNumber || '',
      transactionAmountOre: transaction?.amountOre ?? (transaction ? null : Number(invoice.totalOre ?? invoice.total * 100)),
      transactionApproved: transaction?.approved === false ? 'Nej' : 'Ja',
      transactionAccount: transaction?.account || invoiceAccount,
      remainingOre: Number(invoice.remainingOre ?? 0)
    });
  }

  return Object.freeze({
    RECEIVABLE_COLUMNS,
    assertIsoDate,
    assertOre,
    daysBetween,
    addDays,
    rateTable,
    referenceRateFor,
    statutoryInterest,
    principalEvents,
    balanceHistoryBetween,
    statutoryInterestFromHistory,
    createInvoiceComment,
    latestReminderDate,
    reminderPreview,
    createReminderRecord,
    matchPaymentProposal,
    receivableRow
  });
});
