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

  function halfYearEndExclusive(validFrom) {
    assertIsoDate(validFrom, 'Referensräntans startdatum');
    if (validFrom.endsWith('-01-01')) return `${validFrom.slice(0,4)}-07-01`;
    if (validFrom.endsWith('-07-01')) return `${Number(validFrom.slice(0,4)) + 1}-01-01`;
    throw domainError('En referensränta måste börja den 1 januari eller den 1 juli.', 'INVALID_RATE_CONFIG', 500);
  }

  function rateTable(config) {
    const rows = Array.isArray(config?.referenceRates) ? config.referenceRates : [];
    const normalized = rows.map(row => {
      const validFrom = assertIsoDate(row.validFrom, 'Referensräntans startdatum');
      return {
        validFrom,
        validToExclusive: halfYearEndExclusive(validFrom),
        basisPoints: Number(row.basisPoints)
      };
    }).sort((a,b) => a.validFrom.localeCompare(b.validFrom));
    if (!normalized.length || normalized.some(row => !Number.isInteger(row.basisPoints))) throw domainError('Referensräntorna är inte korrekt konfigurerade.', 'INVALID_RATE_CONFIG', 500);
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index - 1].validFrom === normalized[index].validFrom) throw domainError('Referensräntorna innehåller dubbla halvår.', 'INVALID_RATE_CONFIG', 500);
    }
    return normalized;
  }

  function referenceRateFor(date, config) {
    assertIsoDate(date);
    const row = rateTable(config).find(item => item.validFrom <= date && date < item.validToExclusive);
    if (!row) throw domainError(`Verifierad referensränta saknas för ${date}.`, 'MISSING_REFERENCE_RATE', 409);
    return row;
  }

  function nextRateBoundary(date, config) {
    return referenceRateFor(date, config).validToExclusive;
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
        referenceRateBasisPoints: rate.basisPoints,
        annualRateBasisPoints: annualBasisPoints,
        interestOre: segmentInterest
      }));
      cursor = end;
    }
    return {interestOre, days:totalDays, segments};
  }

  function transactionDate(transaction) {
    const value = transaction?.paymentDate || transaction?.date || transaction?.postingDate || '';
    return assertIsoDate(value, 'Betalningsdatum');
  }

  function interestBalanceHistory(invoice, toDate) {
    assertIsoDate(toDate, 'Räntedatum');
    const dueDate = assertIsoDate(invoice?.dueDate, 'Förfallodatum');
    const totalOre = assertOre(invoice?.totalOre, 'Fakturabelopp');
    if (totalOre <= 0) throw domainError('Dröjsmålsränta kräver ett positivt ursprungligt fakturabelopp.', 'INVALID_INTEREST_INPUT');
    if (!Array.isArray(invoice?.transactions)) throw domainError('Betalningshistorik saknas. Ränta får inte beräknas på enbart dagens restbelopp.', 'INCOMPLETE_BALANCE_HISTORY', 409);

    const events = [];
    for (const transaction of invoice.transactions) {
      if (transaction?.approved === false) continue;
      const amountOre = assertOre(transaction?.amountOre, 'Transaktionsbelopp');
      if (amountOre === 0) continue;
      const type = String(transaction?.transactionType || transaction?.type || '').trim().toLowerCase();
      const sourceType = String(transaction?.sourceType || '').trim().toLowerCase();
      const sourceId = String(transaction?.sourceId || '').trim();
      const bankReference = String(transaction?.bankReference || '').trim();
      const supportedPayment = type === 'payment' && amountOre < 0;
      const supportedReversal = type === 'payment-reversal' && amountOre > 0;
      const supportedCreditOffset = type === 'credit-offset'
        && amountOre < 0
        && sourceType === 'customer-credit-offset'
        && /^[A-Za-z0-9_-]{16,100}$/.test(sourceId)
        && bankReference === 'credit-offset:' + sourceId;
      if (!supportedPayment && !supportedReversal && !supportedCreditOffset) {
        throw domainError(
          'Ränteberäkningen innehåller en kredit, justering eller annan saldoändring som inte har ett verifierat automatiskt historikflöde. Ränta blockeras tills händelsen kan härledas säkert.',
          'UNSUPPORTED_BALANCE_HISTORY',
          409
        );
      }
      events.push({
        date:transactionDate(transaction),
        balanceDeltaOre:amountOre,
        reductionOre:amountOre<0?Math.abs(amountOre):0,
        increaseOre:amountOre>0?amountOre:0,
        transactionId:String(transaction.id || ''),
        transactionType:type,
        sourceType,
        sourceId
      });
    }
    events.sort((a,b) => a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId));

    let principalOre = totalOre;
    const dailyDeltas = new Map();
    for (const event of events) {
      if (event.date > toDate) continue;
      dailyDeltas.set(event.date,(dailyDeltas.get(event.date)||0)+event.balanceDeltaOre);
    }
    for (const [,balanceDeltaOre] of [...dailyDeltas.entries()].sort(([a],[b])=>a.localeCompare(b))) {
      principalOre += balanceDeltaOre;
      if (principalOre < 0 || principalOre > totalOre) throw domainError('Betalningshistoriken ger ett ogiltigt fakturasaldo och måste granskas manuellt.', 'INVALID_BALANCE_HISTORY', 409);
    }
    const storedRemainingOre = assertOre(invoice?.remainingOre, 'Restbelopp');
    const hasLaterPayment = events.some(event => event.date > toDate);
    if (!hasLaterPayment && storedRemainingOre !== principalOre) {
      throw domainError('Fakturans restbelopp stämmer inte med den sparade betalningshistoriken. Ränta blockeras tills reskontran är avstämd.', 'BALANCE_HISTORY_MISMATCH', 409);
    }
    return Object.freeze({dueDate,totalOre,balanceOre:principalOre,events:Object.freeze(events)});
  }

  function normalizeReceivableSearch(value) {
    return String(value || '').trim().toLocaleLowerCase('sv-SE');
  }

  function customerMatchesReceivableSearch(customer, invoices, query) {
    const needle=normalizeReceivableSearch(query);
    if(!needle)return true;
    const identity=[customer?.customerName,customer?.customerNumber,customer?.orgNumber].map(normalizeReceivableSearch);
    if(identity.some(value=>value.includes(needle)))return true;
    return (Array.isArray(invoices)?invoices:[]).some(invoice=>
      [invoice?.invoiceNumber,invoice?.ocr].map(normalizeReceivableSearch).some(value=>value.includes(needle))
    );
  }


  function verifiedInterestStart(invoice) {
    const basis=String(invoice?.interestStartBasis||'').trim();
    const source=String(invoice?.interestStartEvidenceSource||'').trim();
    const verifiedAt=String(invoice?.interestStartVerifiedAt||'').trim();
    if(basis!=='predetermined-due-date'||source!=='issued-invoice-document'||!verifiedAt){
      throw domainError('Dröjsmålsränta är blockerad eftersom rättslig startgrund inte är verifierad för fakturan. Skapa påminnelsen utan ränta eller granska underlaget manuellt.','INTEREST_START_BASIS_UNVERIFIED',409);
    }
    const dueDate=assertIsoDate(invoice?.dueDate,'Förfallodatum');
    const invoiceDate=assertIsoDate(invoice?.invoiceDate,'Fakturadatum');
    if(invoiceDate>dueDate)throw domainError('Fakturadatum ligger efter förfallodatum och kan inte användas som verifierad räntegrund.','INTEREST_START_BASIS_INVALID',409);
    const timestamp=Date.parse(verifiedAt);
    if(!Number.isFinite(timestamp))throw domainError('Räntegrundens verifieringstid är ogiltig.','INTEREST_START_BASIS_INVALID',409);
    return Object.freeze({basis,startDate:dueDate,evidenceSource:source,verifiedAt:new Date(timestamp).toISOString()});
  }

  function statutoryInterestForInvoice(invoice, toDate, config) {
    verifiedInterestStart(invoice);
    const history = interestBalanceHistory(invoice, toDate);
    if (toDate <= history.dueDate || history.totalOre === 0) return {interestOre:0,days:0,segments:[],principalOre:history.balanceOre};

    let principalOre = history.totalOre;
    const eventsByDate = new Map();
    for (const event of history.events) {
      if (event.date > toDate) continue;
      eventsByDate.set(event.date,(eventsByDate.get(event.date)||0)+event.balanceDeltaOre);
    }
    for (const [date,balanceDeltaOre] of [...eventsByDate.entries()].filter(([date]) => date <= history.dueDate)) {
      principalOre += balanceDeltaOre;
      if (principalOre < 0 || principalOre > history.totalOre) throw domainError('Betalningshistoriken ger ett ogiltigt saldo före förfallodagen.', 'INVALID_BALANCE_HISTORY', 409);
    }

    let cursor = history.dueDate;
    let interestOre = 0;
    let days = 0;
    const segments = [];
    const paymentDates = [...eventsByDate.keys()].filter(date => date > history.dueDate && date <= toDate).sort();
    const boundaries = [...new Set([...paymentDates,toDate])].sort();
    for (const boundary of boundaries) {
      if (boundary > cursor && principalOre > 0) {
        const part = statutoryInterest(principalOre,cursor,boundary,config);
        interestOre += part.interestOre;
        days += part.days;
        for (const segment of part.segments) segments.push(Object.freeze({...segment,principalOre}));
      }
      if (eventsByDate.has(boundary)) {
        principalOre += eventsByDate.get(boundary);
        if (principalOre < 0 || principalOre > history.totalOre) throw domainError('Betalningshistoriken ger ett ogiltigt fakturasaldo.', 'INVALID_BALANCE_HISTORY', 409);
      }
      cursor = boundary;
    }
    return Object.freeze({interestOre,days,segments:Object.freeze(segments),principalOre:history.balanceOre});
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
    const sentDate = assertIsoDate(options?.sentDate, 'Påminnelsedatum');
    const dueDate = assertIsoDate(invoice?.dueDate, 'Förfallodatum');
    const storedRemainingOre = assertOre(invoice?.remainingOre, 'Restbelopp');
    if (storedRemainingOre <= 0) throw domainError('Fakturan har inget positivt restbelopp att påminna om.', 'NOT_OUTSTANDING', 409);
    if (sentDate <= dueDate) throw domainError('En betalningspåminnelse får skapas först efter förfallodagen i detta arbetsflöde.', 'NOT_OVERDUE');

    const feeRequested = options?.includeReminderFee === true;
    const feeAgreed = options?.reminderFeeAgreed === true;
    if (feeRequested && config?.rules?.reminderFeeRequiresAgreement !== false && !feeAgreed) {
      throw domainError('Påminnelseavgift får inte läggas till utan att den avtalats senast när skulden uppkom.', 'REMINDER_FEE_NOT_AGREED', 409);
    }
    const reminderFeeOre = feeRequested ? assertOre(Number(config?.reminderFeeOre), 'Påminnelseavgift') : 0;
    const includeInterest=options?.includeInterest!==false;
    const interestStart=includeInterest?verifiedInterestStart(invoice):null;
    const interest = includeInterest
      ? statutoryInterestForInvoice(invoice,sentDate,config)
      : {interestOre:0,days:0,segments:[],principalOre:storedRemainingOre};
    const remainingOre = interest.principalOre;
    if (remainingOre <= 0) throw domainError('Fakturan var redan slutbetald på påminnelsedatumet.', 'NOT_OUTSTANDING', 409);

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
      sentDate,
      originalDueDate: dueDate,
      principalOre: remainingOre,
      reminderFeeOre,
      interestOre: interest.interestOre,
      businessLatePaymentCompensationOre: businessCompensation,
      totalDueOre: remainingOre + reminderFeeOre + interest.interestOre + businessCompensation,
      interest,
      interestStartBasis:interestStart?.basis||'none',
      interestStartEvidenceSource:interestStart?.evidenceSource||'',
      interestStartVerifiedAt:interestStart?.verifiedAt||'',
      statutoryRateOnSentDateBasisPoints: includeInterest ? referenceRateFor(sentDate, config).basisPoints + Number(config.interestActMarginBasisPoints) : 0
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
      reminderDate: preview.sentDate,
      sentAt: `${preview.sentDate}T12:00:00.000Z`,
      deliveryStatus: 'not-sent',
      deliveredAt: null,
      rateConfigVersion: String(config?.version ?? ''),
      rateVerifiedAt: String(config?.verifiedAt || ''),
      createdBy: actor.id.trim(),
      createdByName: actor.name.trim(),
      kind: options?.kind === 'escalation' ? 'escalation' : 'payment-reminder',
      principalOre: preview.principalOre,
      reminderFeeOre: preview.reminderFeeOre,
      interestOre: preview.interestOre,
      businessLatePaymentCompensationOre: preview.businessLatePaymentCompensationOre,
      totalDueOre: preview.totalDueOre,
      annualRateBasisPoints: preview.statutoryRateOnSentDateBasisPoints,
      interestStartBasis:preview.interestStartBasis,
      interestStartEvidenceSource:preview.interestStartEvidenceSource,
      interestStartVerifiedAt:preview.interestStartVerifiedAt,
      interestSegments: preview.interest.segments,
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
    normalizeReceivableSearch,
    customerMatchesReceivableSearch,
    assertIsoDate,
    assertOre,
    daysBetween,
    addDays,
    rateTable,
    referenceRateFor,
    statutoryInterest,
    interestBalanceHistory,
    statutoryInterestForInvoice,
    verifiedInterestStart,
    createInvoiceComment,
    latestReminderDate,
    reminderPreview,
    createReminderRecord,
    matchPaymentProposal,
    receivableRow
  });
});
