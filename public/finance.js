(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RollandsFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const headers = ['Period', 'Avityp', 'Bet sätt', 'Avinr', 'Bokfdatum avi/fakt', 'Avibelopp', 'Ffd', 'Buntnr', 'Bokfdatum trans', 'Bokntyp', 'Transnr', 'Transbelopp', 'Restbelopp'];
  const cents = n => Math.round(Number(n || 0) * 100);
  const amount = n => n / 100;
  const sum = (list, field) => amount(list.reduce((n, item) => n + cents(typeof field === 'function' ? field(item) : item[field]), 0));
  const localToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  }
  const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const invoiceDate = i => i.date || i.received;
  const invoiceNumber = i => i.number || i.invoiceNumber;
  const paidAmount = i => sum((i.payments || []).filter(payment => !payment.reversed && !payment.reclassified), 'amount');
  const remaining = i => {
    const total = cents(i.total);
    const applied = cents(i.offsetAmount || 0) + cents(i.writeOffAmount || 0);
    const payouts = cents(i.payoutAmount || 0);
    if (i.credit || total < 0) return amount(Math.min(0, total + applied + cents(paidAmount(i)) + payouts));
    const balance = total - applied - cents(paidAmount(i)) + cents(i.creditUsed || 0) + payouts;
    return amount(i.customer !== undefined || i.kind === 'customer' ? balance : Math.max(0,balance));
  };
  const isBooked = (i, kind) => kind === 'customer' || i.status !== 'Attest väntar';
  function normalize(store) {
    store.settings ||= {};
    store.settings.attestResponsible ||= 'Odd Stefan Arne Svensson';
    store.settings.attestSubstitute ||= 'Anna Åberg';
    store.settings.emailInbox ||= 'fakturor@rollands.se';
    store.settings.lastBankImport ||= '';
    store.settings.lastInvoiceEmail ||= '';
    store.settings.lockedPeriods ||= [];
    store.auditLog ||= [];
    const customerNumbers = new Map();
    let nextCustomer = 1001;
    for (const i of store.invoices || []) {
      if (!i.customerNumber) {
        if (!customerNumbers.has(i.customer)) customerNumbers.set(i.customer, `K-${nextCustomer++}`);
        i.customerNumber = customerNumbers.get(i.customer);
      }
    }
    for (const [kind, invoices] of [['customer', store.invoices], ['supplier', store.supplierInvoices]]) {
      for (const i of invoices || []) {
        for (const key of ['net','vat','total','offsetAmount','writeOffAmount','creditUsed','payoutAmount']) if (i[key] != null) i[key] = Math.round(Number(i[key]) || 0);
        for (const p of (i.payments || [])) if (p.amount != null) p.amount = Math.round(Number(p.amount) || 0);
        for (const p of (i.payouts || [])) if (p.amount != null) p.amount = Math.round(Number(p.amount) || 0);
        i.offsets ||= [];
        i.offsetAmount ||= 0;
        i.writeOffAmount ||= 0;
        i.payouts ||= [];
        i.payoutAmount ||= 0;
        if (!i.journalNumber) {
          const postings = (store.journal || []).filter(j => j.description.includes(invoiceNumber(i)) && j.rows.some(r => r.account.startsWith(kind === 'customer' ? '1510' : '2440') && cents(kind === 'customer' ? r.debit : r.credit) === cents(i.total)));
          if (postings.length === 1) { i.journalNumber = postings[0].number; i.bookedDate = postings[0].date; }
        }
        if (Array.isArray(i.payments)) continue;
        i.payments = [];
        const account = kind === 'customer' ? '1510' : '2440';
        const known = (store.bankTransactions || []).filter(t => t.status === 'Matchad' && t.account?.startsWith(account) && t.reference === invoiceNumber(i) && (kind === 'customer' ? t.amount > 0 : t.amount < 0));
        let available = cents(i.total);
        for (const t of known) {
          if (cents(Math.abs(t.amount)) > available) continue;
          const journal = (store.journal || []).find(j => j.date === t.date && j.description.includes(invoiceNumber(i)) && j.rows.some(r => r.account.startsWith(account) && cents(kind === 'customer' ? r.credit : r.debit) === cents(Math.abs(t.amount))));
          i.payments.push({ id: `legacy-${t.id}`, amount: Math.abs(t.amount), date: t.date, method: 'Bank', reference: t.transactionRef, bankId: t.id, batch: t.batch || '', journalNumber: journal?.number || '', source: 'Migrerad bankkoppling' });
          available -= cents(Math.abs(t.amount));
          t.invoiceId = i.id;
          t.invoiceKind = kind;
        }
        if ((i.paid || i.status === 'Betald') && available > 0) {
          i.payments.push({ id: `legacy-${i.id}`, amount: amount(available), date: null, method: 'Ej angivet', reference: '', batch: '', journalNumber: '', source: 'Tidigare betalstatus; betalningsdatum saknas' });
        }
        updateStatus(i, kind);
      }
    }
    for (const t of store.bankTransactions || []) if (t.amount != null) t.amount = Math.round(Number(t.amount) || 0);
    for (const j of store.journal || []) for (const r of j.rows || []) { r.debit = Math.round(Number(r.debit) || 0); r.credit = Math.round(Number(r.credit) || 0); }
    store.activity = (store.activity || []).map(a => ({ ...a, text: String(a.text || '').replace(/-?\d+\.\d{1,2}/g, value => String(Math.round(Number(value)))) }));
    store.schemaVersion = 5;
    return store;
  }
  function updateStatus(i, kind) {
    if (kind === 'supplier' && i.status === 'Attest väntar') return;
    i.paid = remaining(i) === 0;
    if (kind === 'customer' && remaining(i)<0) { i.status=i.credit?'Kredit':'Överbetald'; return; }
    if (i.paid) i.status = 'Betald';
    else if (paidAmount(i) > 0) i.status = 'Delbetald';
    else i.status = 'Bokförd';
  }
  function items(store, kind, filters = {}) {
    const now = filters.today || localToday();
    const list = kind === 'customer' ? store.invoices : store.supplierInvoices;
    return (list || []).map(i => ({
      ...i, kind, party: kind === 'customer' ? i.customer : i.supplier,
      partyNumber: kind === 'customer' ? (i.customerNumber || '') : (i.supplierNumber || ''),
      invoiceDate: invoiceDate(i), aviNumber: invoiceNumber(i),
      paidAmount: paidAmount(i), remaining: remaining(i), booked: isBooked(i, kind),
      overdueDays: remaining(i) > 0 && validDate(i.dueDate) ? Math.max(0, days(i.dueDate, now)) : 0
    })).filter(i => {
      if (filters.period && !i.invoiceDate?.startsWith(filters.period)) return false;
      if (filters.party && i.party !== filters.party) return false;
      if (filters.partyNumber && i.partyNumber !== filters.partyNumber) return false;
      if (filters.search && ![i.party, i.partyNumber, i.aviNumber, i.ocr, i.reference, ...(i.payments || []).map(p => `${p.reference} ${p.journalNumber}`)].join(' ').toLocaleLowerCase('sv').includes(filters.search.toLocaleLowerCase('sv'))) return false;
      if (/^age[0-4]$/.test(filters.status || '')) {
        const bucket = i.overdueDays === 0 ? 0 : i.overdueDays <= 30 ? 1 : i.overdueDays <= 60 ? 2 : i.overdueDays <= 90 ? 3 : 4;
        return i.booked && i.remaining > 0 && bucket === Number(filters.status.slice(-1));
      }
      switch (filters.status) {
        case 'open': return i.booked && i.remaining !== 0;
        case 'credit': return i.booked && i.remaining < 0;
        case 'urgent': return kind==='supplier' && !!supplierAlert(i,now);
        case 'overdue': return i.booked && i.overdueDays > 0;
        case 'paid': return i.booked && i.remaining === 0 && !i.credit;
        case 'partial': return i.booked && i.remaining > 0 && i.paidAmount > 0;
        case 'pending': return !i.booked;
        case 'due': return i.booked && i.remaining > 0 && days(now, i.dueDate) >= 0 && days(now, i.dueDate) <= 7;
        default: return true;
      }
    }).sort((a,b) => a.party.localeCompare(b.party, 'sv') || a.invoiceDate.localeCompare(b.invoiceDate) || a.aviNumber.localeCompare(b.aviNumber));
  }
  function rows(i) {
    let rest = cents(i.total);
    const common = { period: i.invoiceDate?.slice(0,7) || '', aviType: i.credit ? 'Kreditfaktura' : (i.kind === 'customer' ? 'Kundfaktura' : 'Lev.faktura'), aviNumber: i.aviNumber, invoiceDate: i.postingDate || i.bookedDate || '', due: i.dueDate, batch: i.batchNumber || i.batch || '' };
    const result = [{ ...common, method: i.paymentMethod || 'Ej angivet', invoiceAmount: i.total, transactionDate: i.booked ? (i.postingDate || i.bookedDate || '') : '', bookingType: i.booked ? 'Faktura' : 'Ej bokförd', transactionNumber: i.journalNumber || '', transactionAmount: i.booked ? i.total : null, remaining: remaining(i) }];
    const payments = [...(i.payments || [])].sort((a,b) => (a.date || '').localeCompare(b.date || ''));
    for (const p of payments) {
      if (!p.reversed && !p.reclassified) rest -= cents(p.amount);
      result.push({ ...common, method: p.method || 'Bank', invoiceAmount: null, batch: p.batch || '', transactionDate: p.reversedDate || p.date || '', bookingType: p.reversed ? 'Återförd betalning' : (p.reclassified ? 'Omförd inbetalning' : (p.date ? (i.kind === 'customer' ? 'Inbetalning' : 'Utbetalning') : 'Tidigare betalning')), transactionNumber: p.reversalJournalNumber || p.journalNumber || p.reference || '', transactionAmount: p.reversed || p.reclassified ? 0 : -p.amount, remaining: amount(rest), note: p.reversed ? `Motverifikation ${p.reversalJournalNumber || ''}` : (p.reclassified ? `Omförd till ${p.reclassifiedTo || ''}` : (p.source || '')), paymentId: p.id });
      if (p.reclassified) {
        Object.assign(result[result.length - 1], {bookingType: 'Inbetalning', transactionAmount: -p.amount});
        result.push({...common, method: 'Omföring', invoiceAmount: null, batch: p.reclassificationBatch, transactionDate: p.reclassifiedDate, bookingType: 'Omföring till ' + p.reclassifiedTo, transactionNumber: p.reclassificationJournalNumber, transactionAmount: p.amount, paymentId: 'move-' + p.id});
      }
    }
    for (const o of (i.offsets || [])) {
      const delta=(o.creditInvoiceId===i.id || i.credit)?o.amount:-o.amount;
      rest += cents(delta);
      result.push({ ...common, method: 'Kvittning', invoiceAmount: null, batch: o.batch || '', transactionDate: o.date || '', bookingType: 'Kvittning', transactionNumber: o.journalNumber || '', transactionAmount: delta, remaining: amount(rest), note: 'Kreditbelopp kvittat', paymentId: `offset-${o.id}` });
    }
    for (const p of (i.payouts || [])) {
      const delta = i.kind === 'customer' || i.credit || i.total < 0 ? cents(p.amount) : -cents(p.amount);
      rest += delta;
      result.push({ ...common, method: 'Återbetalning', invoiceAmount: null, batch: p.batch || '', transactionDate: p.date || '', bookingType: i.kind === 'customer' ? 'Återbetalning' : 'Utbetalning', transactionNumber: p.journalNumber || p.reference || '', transactionAmount: amount(delta), remaining: amount(rest), note: p.reason || '', paymentId: p.id });
    }
    if (i.writeOffAmount) {
      rest += i.credit ? cents(i.writeOffAmount) : -cents(i.writeOffAmount);
      result.push({ ...common, method: 'Utbokning', invoiceAmount: null, batch: '', transactionDate: i.writeOffDate || '', bookingType: 'Avskrivning', transactionNumber: i.writeOffJournalNumber || '', transactionAmount: i.credit ? i.writeOffAmount : -i.writeOffAmount, remaining: amount(rest), note: i.writeOffReason || '', paymentId: `writeoff-${i.id}` });
    }
    // Restbelopp is today's open balance on every row, not a historical running balance.
    return result.map(row => ({ ...row, remaining: remaining(i) }));
  }
  function values(row) { return [row.period, row.aviType, row.method, row.aviNumber, row.invoiceDate, row.invoiceAmount, row.due, row.batch, row.transactionDate, row.bookingType, row.transactionNumber, row.transactionAmount, row.remaining]; }
  function totals(list) {
    const booked = list.filter(i => i.booked);
    return { count: list.length, invoiced: sum(booked, 'total'), paid: sum(booked, 'paidAmount'), open: sum(booked, 'remaining'), overdue: sum(booked.filter(i => i.overdueDays > 0), 'remaining'), pending: sum(list.filter(i => !i.booked), 'total') };
  }
  function aging(list) {
    return ['Ej förfallet', '1–30 dagar', '31–60 dagar', '61–90 dagar', 'Över 90 dagar'].map((label, index) => ({ label, value: sum(list.filter(i => i.booked && i.remaining > 0 && (i.overdueDays === 0 ? 0 : i.overdueDays <= 30 ? 1 : i.overdueDays <= 60 ? 2 : i.overdueDays <= 90 ? 3 : 4) === index), 'remaining') }));
  }
  function dashboard(store, now = localToday()) {
    const customers = items(store, 'customer', { today: now });
    const suppliers = items(store, 'supplier', { today: now });
    const ar = totals(customers), ap = totals(suppliers);
    const upcoming = [...customers, ...suppliers].filter(i => i.booked && i.remaining > 0 && validDate(i.dueDate) && days(now, i.dueDate) >= 0 && days(now, i.dueDate) <= 30).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
    const flow = [7,14,30].map((end, index) => {
      const start = [0,8,15][index];
      const due = upcoming.filter(i => days(now, i.dueDate) >= start && days(now, i.dueDate) <= end);
      return { label: `${start}–${end} dagar`, incoming: sum(due.filter(i => i.kind === 'customer'), 'remaining'), outgoing: sum(due.filter(i => i.kind === 'supplier'), 'remaining') };
    });
    const handled = store.bankTransactions.filter(t => t.status !== 'Granska').length;
    const priorities = [];
    for (const i of [...customers, ...suppliers]) {
      if (i.remaining === 0) continue;
      const alert=i.kind==='supplier' && supplierAlert(i,now);
      if(alert) { priorities.push({rank:!i.booked?0:1,label:alert,detail:`${i.party} · ${i.aviNumber} · Förfaller ${i.dueDate}`,amount:i.remaining,kind:i.kind,id:i.id});continue; }
      if(i.remaining<0) {priorities.push({rank:5,label:'Kund har tillgodo – kvitta eller följ upp',detail:`${i.party} · ${i.aviNumber}`,amount:Math.abs(i.remaining),kind:i.kind,id:i.id});continue;}
      if (i.overdueDays > 0) priorities.push({ rank: 1, label: i.kind === 'customer' ? 'Följ upp förfallen kundfaktura' : 'Hantera förfallen leverantörsfaktura', detail: `${i.party} · ${i.aviNumber} · ${i.overdueDays} dagar försenad`, amount: i.remaining, kind: i.kind, id: i.id });
      else if (!i.booked) priorities.push({ rank: 3, label: 'Attestera leverantörsfaktura', detail: `${i.party} · ${i.aviNumber}`, amount: i.total, kind: i.kind, id: i.id });
      else if (i.kind === 'supplier' && days(now, i.dueDate) <= 7) priorities.push({ rank: 4, label: 'Planera kommande utbetalning', detail: `${i.party} · Förfaller ${i.dueDate}`, amount: i.remaining, kind: i.kind, id: i.id });
    }
    for (const t of store.bankTransactions.filter(t => t.status === 'Granska')) priorities.push({ rank: 2, label: 'Stäm av bankhändelse', detail: t.text, amount: Math.abs(t.amount), bankId: t.id });
    priorities.sort((a,b) => a.rank - b.rank || b.amount - a.amount);
    const currentEntries = store.journal.filter(j => j.date?.startsWith(now.slice(0,7)) && j.date <= now);
    const revenue = sum(currentEntries.flatMap(j => j.rows).filter(r => /^3\d{3}/.test(r.account)), r => r.credit - r.debit);
    const expense = sum(currentEntries.flatMap(j => j.rows).filter(r => /^[4-7]\d{3}/.test(r.account)), r => r.debit - r.credit);
    const reconciliations = [['1510', ar.open, 1], ['2440', ap.open, -1]].map(([account, subledger, sign]) => {
      const ledger = sum(store.journal.flatMap(j => j.rows).filter(r => r.account.startsWith(account)), r => sign * ((r.debit || 0) - (r.credit || 0)));
      return { account, ledger, subledger, difference: amount(cents(subledger) - cents(ledger)) };
    });
    const audit = reconciliationAudit(store, now);
    for (const suggestion of audit.suggestions.slice(0, 5)) priorities.push({ rank: 1, label: suggestion.label, detail: suggestion.detail, amount: Math.abs(suggestion.difference || 0), kind: 'reconciliation' });
    priorities.sort((a,b) => a.rank - b.rank || b.amount - a.amount);
    return { customers, suppliers, ar, ap, flow, upcoming, priorities, handled, bankCount: store.bankTransactions.length, revenue, expense, reconciliations, audit, flowHealth: flowHealth(store, now) };
  }
  function reconciliationAudit(store) {
    const entries = store.journal || [];
    const allRows = entries.flatMap(entry => (entry.rows || []).map(row => ({ ...row, date: entry.date, number: entry.number, description: entry.description })));
    const totalDebit = sum(allRows, 'debit'), totalCredit = sum(allRows, 'credit');
    const accountMap = new Map();
    for (const row of allRows) {
      const code = String(row.account || '').match(/^\d{4}/)?.[0] || 'Övrigt';
      const current = accountMap.get(code) || { account: code, name: String(row.account || '').replace(/^\d{4}\s*/, ''), debit: 0, credit: 0 };
      current.debit += Number(row.debit || 0); current.credit += Number(row.credit || 0); accountMap.set(code, current);
    }
    const accounts = [...accountMap.values()].map(row => ({ ...row, balance: Math.round(row.debit - row.credit) })).sort((a,b) => a.account.localeCompare(b.account, 'sv'));
    const customerOpen = totals(items(store, 'customer')).open;
    const supplierOpen = totals(items(store, 'supplier')).open;
    const ledger1510 = sum(allRows.filter(r => String(r.account).startsWith('1510')), r => (r.debit || 0) - (r.credit || 0));
    const ledger2440 = sum(allRows.filter(r => String(r.account).startsWith('2440')), r => (r.credit || 0) - (r.debit || 0));
    const bankSubledger = sum((store.bankTransactions || []).filter(t => t.status !== 'Granska'), 'amount');
    const ledger1930 = sum(allRows.filter(r => String(r.account).startsWith('1930')), r => (r.debit || 0) - (r.credit || 0));
    const checks = [
      { account: '1510', label: 'Kundreskontra mot 1510', ledger: ledger1510, subledger: customerOpen, difference: amount(cents(customerOpen) - cents(ledger1510)), action: 'Sök kund och kontrollera betalningar eller kvittningar.' },
      { account: '2440', label: 'Leverantörsreskontra mot 2440', ledger: ledger2440, subledger: supplierOpen, difference: amount(cents(supplierOpen) - cents(ledger2440)), action: 'Kontrollera attest, utbetalning och leverantörsfakturor.' },
      { account: '1930', label: 'Importerad bank mot 1930', ledger: ledger1930, subledger: bankSubledger, difference: amount(cents(bankSubledger) - cents(ledger1930)), action: 'Stäm av importerade bankhändelser och saknade verifikationer.' }
    ];
    const whole = value => `${Math.abs(Math.round(Number(value) || 0)).toLocaleString('sv-SE')} kr`;
    const hasEntry = (needle, account) => entries.some(entry => String(entry.description || '').toLocaleLowerCase('sv').includes(String(needle || '').toLocaleLowerCase('sv')) && (!account || (entry.rows || []).some(row => String(row.account || '').startsWith(account))));
    const bookedCustomers = items(store, 'customer').filter(item => item.booked);
    const bookedSuppliers = items(store, 'supplier').filter(item => item.booked);
    const missingCustomerInvoices = bookedCustomers.filter(item => !hasEntry(item.aviNumber, '1510')).slice(0, 5);
    const missingSupplierInvoices = bookedSuppliers.filter(item => !hasEntry(item.aviNumber, '2440')).slice(0, 5);
    const missingBankEntries = (store.bankTransactions || []).filter(item => item.status !== 'Granska' && !hasEntry(item.transactionRef || item.reference, '1930')).slice(0, 5);
    const evidenceFor = check => {
      if (check.account === '1510') {
        const invoiceText = missingCustomerInvoices.map(item => `${item.aviNumber} ${item.party} (${whole(item.total)})`);
        const paymentText = (store.bankTransactions || []).filter(item => item.status !== 'Granska' && item.reference && !hasEntry(item.transactionRef || item.reference, '1510')).slice(0, 5).map(item => `${item.transactionRef || item.reference} (${whole(item.amount)})`);
        return { reason: check.difference > 0 ? 'Kundreskontran innehåller mer öppet saldo än vad som ligger på konto 1510.' : 'Huvudboken på 1510 är större än öppet saldo i kundreskontran.', evidence: [...invoiceText, ...paymentText].slice(0, 4) };
      }
      if (check.account === '2440') {
        const invoiceText = missingSupplierInvoices.map(item => `${item.aviNumber} ${item.party} (${whole(item.total)})`);
        const paymentText = (store.bankTransactions || []).filter(item => item.status !== 'Granska' && item.reference && !hasEntry(item.transactionRef || item.reference, '2440')).slice(0, 5).map(item => `${item.transactionRef || item.reference} (${whole(item.amount)})`);
        return { reason: check.difference > 0 ? 'Leverantörsreskontran innehåller mer skuld än vad som finns på konto 2440.' : 'Huvudboken på 2440 är större än öppna leverantörsposter.', evidence: [...invoiceText, ...paymentText].slice(0, 4) };
      }
      return { reason: check.difference > 0 ? 'Importerade bankhändelser är större än bokförda rörelser på 1930.' : 'Bokföringen på 1930 är större än de importerade, hanterade bankhändelserna.', evidence: missingBankEntries.map(item => `${item.transactionRef || item.reference || item.text} (${whole(item.amount)})`).slice(0, 4) };
    };
    const postingFor = (check, evidence) => {
      const n = whole(check.difference);
      if (check.account === '1510') {
        if (missingCustomerInvoices.length && check.difference > 0) return `Återskapa saknad kundfaktura: debet 1510 ${n}; kredit intäktskonto och utgående moms enligt fakturaraderna.`;
        if (check.difference > 0) return `Efter verifierat underlag: debet 1510 ${n}; kredit 1930 om det är en saknad inbetalningskoppling.`;
        return `Efter verifierat underlag: kredit 1510 ${n}; debet 1930 eller intäkts-/kreditkonto beroende på om det är en dubbelbokning eller kredit.`;
      }
      if (check.account === '2440') {
        if (missingSupplierInvoices.length && check.difference > 0) return `Återskapa saknad leverantörsfaktura: debet kostnadskonto + 2641 enligt fakturan; kredit 2440 ${n}.`;
        if (check.difference > 0) return `Efter verifierat underlag: kredit 2440 ${n}; debet kostnads-/momskonto enligt leverantörsfakturan.`;
        return `Efter verifierat underlag: debet 2440 ${n}; kredit 1930 om det är en saknad eller dubbelregistrerad utbetalning.`;
      }
      if (missingBankEntries.length) return `Boka varje identifierad bankhändelse separat: ${check.difference > 0 ? `debet 1930 ${n}` : `kredit 1930 ${n}`} och motkonto enligt referens, faktura eller kvitto.`;
      return `Efter verifierat kontoutdrag: ${check.difference > 0 ? `debet 1930 ${n}` : `kredit 1930 ${n}`} mot korrekt motkonto.`;
    };
    const unbalanced = entries.filter(entry => Math.abs((entry.rows || []).reduce((n, row) => n + Number(row.debit || 0) - Number(row.credit || 0), 0)) > 0.001).map(entry => ({ number: entry.number, date: entry.date, description: entry.description, difference: Math.round((entry.rows || []).reduce((n, row) => n + Number(row.debit || 0) - Number(row.credit || 0), 0)) }));
    const suggestions = checks.filter(check => check.difference !== 0).map(check => {
      const context = evidenceFor(check);
      const solution = context.evidence.length ? `Börja med ${context.evidence.join('; ')}. Matcha eller omför varje post exakt en gång och kontrollera därefter kvarvarande differens ${whole(check.difference)}.` : 'Det finns ingen entydig automatisk träff. Hämta originalunderlaget, välj korrekt motkonto och skapa en separat korrigeringsverifikation.';
      return { ...check, label: `Avstämningsdiff ${check.account}`, detail: `${check.label}: ${check.difference > 0 ? '+' : ''}${check.difference} kr. ${check.action}`, reason: context.reason, evidence: context.evidence, solution, posting: postingFor(check, context.evidence) };
    });
    if (unbalanced.length) unbalanced.forEach(entry => suggestions.push({ label: `Obalanserad verifikation ${entry.number}`, detail: `${entry.description}: debet och kredit skiljer ${entry.difference > 0 ? '+' : ''}${entry.difference} kr.`, difference: entry.difference, reason: 'Raderna i verifikationen summerar inte till samma debet och kredit.', evidence: [`${entry.number} · ${entry.description}`], solution: 'Öppna verifikationen och jämför varje rad med underlaget innan du bokför om.', posting: entry.difference > 0 ? `Kreditera motkonto ${whole(entry.difference)} eller komplettera saknad kreditrad.` : `Debitera motkonto ${whole(entry.difference)} eller komplettera saknad debetrad.` }));
    return { totalDebit, totalCredit, totalDifference: amount(cents(totalDebit) - cents(totalCredit)), accounts, checks, unbalanced, suggestions };
  }
  function validatePayment(i, kind, payment, now = localToday()) {
    if (!isBooked(i, kind)) throw new Error('Attestera fakturan innan betalningen registreras.');
    if (!validDate(payment.date) || payment.date < invoiceDate(i) || payment.date > now) throw new Error('Betalningsdatum ska ligga mellan fakturadatum och idag.');
    const n = Number(payment.amount);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) throw new Error('Ange ett positivt belopp i hela kronor.');
    if (i.credit || i.total<0) throw new Error('Registrera inbetalningen på en vanlig kundfaktura.');
    if (kind==='supplier' && cents(n) > cents(remaining(i))) throw new Error('Utbetalningen överstiger leverantörsfakturans restbelopp.');
    if (!['Bank', 'Bankgiro', 'Swish'].includes(payment.method)) throw new Error('Välj ett giltigt betalsätt.');
    if (!String(payment.reference || '').trim()) throw new Error('Ange bankreferens för betalningen.');
  }
  function validatePayout(i, kind, payout, now = localToday()) {
    if (!isBooked(i, kind)) throw new Error('Attestera fakturan innan en utbetalning registreras.');
    if (!validDate(payout.date) || payout.date < invoiceDate(i) || payout.date > now) throw new Error('Utbetalningsdatum ska ligga mellan fakturadatum och idag.');
    const n = Number(payout.amount);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) throw new Error('Ange ett positivt belopp i hela kronor.');
    const available = kind === 'customer' ? Math.abs(Math.min(0, remaining(i))) : remaining(i);
    if (cents(n) > cents(available)) throw new Error('Utbetalningen överstiger postens disponibla restbelopp.');
    if (!['Bank', 'Bankgiro', 'Swish'].includes(payout.method)) throw new Error('Välj ett giltigt betalsätt.');
    if (!String(payout.reference || '').trim()) throw new Error('Ange en unik betalningsreferens.');
  }
  function supplierAlert(i, now=localToday()) {
    if(remaining(i)<=0 || !validDate(i.dueDate))return '';
    const d=days(now,i.dueDate);if(d>5)return '';
    const when=d<0?`${Math.abs(d)} dagar försenad`:d===0?'förfaller idag':`förfaller om ${d} dagar`;
    return `${i.status==='Attest väntar'?'ATTEST BRÅDSKAR':'Betalning prioriterad'} – ${when}`;
  }
  function flowHealth(store, now = localToday()) {
    const bankDate = store.settings?.lastBankImport || (store.bankTransactions || []).map(item => item.date).filter(validDate).sort().at(-1) || '';
    const emailDate = store.settings?.lastInvoiceEmail || (store.supplierInvoices || []).map(item => item.received).filter(validDate).sort().at(-1) || '';
    const bankAge = bankDate ? Math.max(0, days(bankDate, now)) : null;
    const emailAge = emailDate ? Math.max(0, days(emailDate, now)) : null;
    return {
      bank: { lastDate: bankDate, ageDays: bankAge, warning: bankAge == null || bankAge > 2, message: bankAge == null ? 'Ingen bankimport registrerad.' : bankAge > 2 ? `Ingen bankfil har kommit in på ${bankAge} dagar.` : 'Bankflödet är aktuellt.' },
      email: { lastDate: emailDate, ageDays: emailAge, warning: emailAge == null || emailAge > 5, message: emailAge == null ? 'Ingen fakturamejlregistrering finns.' : emailAge > 5 ? `Ingen fakturamejlregistrering på ${emailAge} dagar.` : 'Fakturamejlflödet är aktuellt.' }
    };
  }
  function partyDirectory(store, kind, query='') {
    const list = items(store, kind);
    const groups = new Map();
    for (const item of list) {
      const number = item.partyNumber || '';
      const key = `${number}::${item.party}`;
      if (!groups.has(key)) groups.set(key, { kind, number, party:item.party, invoices:[], open:0, overdue:0, pending:0, latest:'' });
      const group = groups.get(key);
      group.invoices.push(item);
      if (item.booked && item.remaining !== 0) group.open += item.remaining;
      if (item.booked && item.overdueDays > 0 && item.remaining > 0) group.overdue += item.remaining;
      if (!item.booked) group.pending += item.total;
      if (!group.latest || item.invoiceDate > group.latest) group.latest = item.invoiceDate;
    }
    const term = String(query || '').toLocaleLowerCase('sv');
    return [...groups.values()]
      .filter(group => !term || `${group.number} ${group.party}`.toLocaleLowerCase('sv').includes(term))
      .sort((a,b) => a.party.localeCompare(b.party,'sv'));
  }
  function customerGroups(store, query='') {
    const all=items(store,'customer');
    const key=i=>JSON.stringify([i.partyNumber,i.party]);
    const matches=new Set(items(store,'customer',{search:query}).map(key));
    const groups=new Map();
    for(const i of all){if(!matches.has(key(i)))continue;if(!groups.has(key(i)))groups.set(key(i),{key:key(i),number:i.partyNumber,party:i.party,invoices:[]});groups.get(key(i)).invoices.push(i);}
    return [...groups.values()];
  }
  function csvCell(value) {
    if (value == null) return '';
    if (typeof value === 'number') return String(Math.round(value));
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csv(list) {
    return '\uFEFF' + [['Motpart', ...headers], ...list.flatMap(i => rows(i).map(r => [i.party, ...values(r)]))].map(line => line.map(csvCell).join(';')).join('\r\n');
  }
  return { headers, cents, amount, sum, localToday, validDate, days, invoiceDate, invoiceNumber, paidAmount, remaining, normalize, updateStatus, items, rows, values, totals, aging, dashboard, reconciliationAudit, validatePayment, validatePayout, csv, csvCell, supplierAlert, customerGroups, partyDirectory, flowHealth };
});
