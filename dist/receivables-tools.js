(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./finance.js'));
  else root.ReceivablesTools = factory(root.RollandsFinance);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  'use strict';
  const ref = value => String(value || '').trim();
  function invoiceByRef(store, value) {
    const query = ref(value);
    const matches = (store.invoices || []).filter(i => query && [i.id, F.invoiceNumber(i), i.ocr, i.batchNumber, i.batch].some(v => ref(v) === query));
    if (matches.length !== 1) throw new Error(matches.length ? 'Referensen matchar flera fakturor. Ange fakturanumret.' : 'Fakturan hittades inte. Ange fakturanummer, OCR eller fakturans buntnummer.');
    return matches[0];
  }
  function paymentByBatch(store, value) {
    const batch = ref(value);
    if (!batch) throw new Error('Ange inbetalningens buntnummer.');
    const matches = (store.invoices || []).flatMap(invoice => (invoice.payments || []).filter(p => ref(p.batch) === batch && !p.reversed && !p.reclassified).map(payment => ({invoice, payment})));
    if (matches.length > 1) throw new Error('Bunten innehåller flera inbetalningar och måste först delas upp.');
    if (matches.length === 1) return matches[0];
    const entries = (store.journal || []).filter(j => ref(j.batchNumber || j.batch) === batch);
    if (entries.length !== 1) throw new Error('Ingen aktiv inbetalning hittades för buntnumret.');
    const entry = entries[0];
    const banks = (store.bankTransactions || []).filter(t => t.amount > 0 && t.status === 'Bokförd' && !t.invoiceId && (t.journalNumber === entry.number || ref(t.batch) === batch));
    if (banks.length !== 1) throw new Error('Bunten saknar en entydig, bokförd inbetalning som kan omföras.');
    const bank = banks[0];
    const rows = entry.rows || [];
    const debit = rows.filter(r => r.debit > 0), credit = rows.filter(r => r.credit > 0);
    if (debit.length !== 1 || credit.length !== 1 || !String(debit[0].account).startsWith('1930') || debit[0].debit !== bank.amount || credit[0].credit !== bank.amount || rows.some(r => r.debit && r.credit)) throw new Error('Bankbunten har en sammansatt kontering. Den behöver granskas manuellt före omföring.');
    return { bank, entry, account: credit[0].account, payment: { amount: bank.amount, date: bank.date, bankId: bank.id, reference: bank.transactionRef, batch, journalNumber: entry.number, method: 'Bank' } };
  }
  function plan(store, kind, payload) {
    const date = ref(payload.date) || F.localToday();
    if (!F.validDate(date) || date > F.localToday()) throw new Error('Välj en giltig bokföringsdag som inte ligger i framtiden.');
    if ((store.settings?.lockedPeriods || []).includes(date.slice(0, 7))) throw new Error('Bokföringsperioden är låst. Välj en öppen period.');
    const target = invoiceByRef(store, payload.targetInvoice || payload.invoiceId);
    if (target.credit || target.total <= 0) throw new Error('Målet måste vara en vanlig kundfaktura.');
    let source, available;
    if (kind === 'reclassify') {
      source = paymentByBatch(store, payload.sourceBatch);
      available = Number(source.payment.amount);
      if (source.payment.reclassifiedFrom) throw new Error('Denna betalning kommer från en omföring. Granska omföringsbunten innan ytterligare rättelse.');
      if (source.invoice && ((source.invoice.offsets || []).length || source.invoice.payoutAmount || source.invoice.writeOffAmount)) throw new Error('Ursprungsfakturan har kvittningar, återbetalningar eller utbokningar. Granska dessa innan betalningen omförs.');
    } else if (kind === 'offset') {
      source = { invoice: invoiceByRef(store, payload.creditInvoice || payload.creditInvoiceId) };
      available = -F.remaining(source.invoice);
      if (available <= 0) throw new Error('Källfakturan måste ha ett disponibelt kreditbelopp.');
    } else throw new Error('Okänt reskontraverktyg.');
    if (source.invoice) {
      if (source.invoice.id === target.id) throw new Error('Välj två olika fakturor.');
      if (!source.invoice.customerNumber || source.invoice.customerNumber !== target.customerNumber || source.invoice.customer !== target.customer) throw new Error('Åtgärden får endast göras mellan fakturor från samma kund.');
    }
    const earliest = [target.postingDate || F.invoiceDate(target), source.payment?.date, source.invoice?.postingDate || (source.invoice && F.invoiceDate(source.invoice))].filter(F.validDate).sort().at(-1);
    if (earliest && date < earliest) throw new Error('Bokföringsdagen får inte vara tidigare än de berörda underlagen.');
    const amount = ref(payload.amount) ? Number(payload.amount) : kind === 'reclassify' ? available : Math.min(available, F.remaining(target));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > available) throw new Error('Ange ett tillgängligt belopp i hela kronor.');
    if (kind === 'reclassify' && amount !== available) throw new Error('Omföringen omfattar hela inbetalningen.');
    if (kind === 'offset' && amount > F.remaining(target)) throw new Error('Kvittningsbeloppet överstiger målfakturans restbelopp.');
    const origin = source.invoice ? F.invoiceNumber(source.invoice) : 'bankbunt ' + source.payment.batch;
    const description = `${kind === 'offset' ? 'Kvittning' : 'Omföring inbetalning'} ${origin} → ${F.invoiceNumber(target)} · ${target.customer}`;
    const rows = [
      {account: source.account || '1510 Kundfordringar', debit: amount, credit: 0, invoiceId: source.invoice?.id || null, customerNumber: source.invoice?.customerNumber || '', description: `Från ${origin}`},
      {account: '1510 Kundfordringar', debit: 0, credit: amount, invoiceId: target.id, customerNumber: target.customerNumber, description: `Till ${F.invoiceNumber(target)}`}
    ];
    return { kind, date, source, target, amount, description, rows, origin };
  }
  function execute(store, kind, payload, addJournal, makeId) {
    const key = ref(payload.idempotencyKey);
    const previous = key && (store.journal || []).find(j => j.receivablesRequestKey === key);
    if (previous) return { entry: previous, duplicate: true };
    const p = plan(store, kind, payload);
    const entry = addJournal({date: p.date, description: p.description, rows: p.rows, source: kind === 'offset' ? 'Kvittning kreditbelopp' : 'Omföring inbetalning'});
    entry.receivablesRequestKey = key;
    entry.sourceBatch = p.source.payment?.batch || p.source.invoice?.batchNumber || '';
    entry.targetInvoiceId = p.target.id;
    entry.sourceInvoiceId = p.source.invoice?.id || null;
    if (kind === 'offset') {
      const credit = p.source.invoice;
      const record = { id: makeId(), amount: p.amount, date: p.date, journalNumber: entry.number, batch: entry.batchNumber, creditInvoiceId: credit.id, invoiceId: p.target.id };
      (credit.offsets ||= []).push(record); (p.target.offsets ||= []).push({...record});
      if (credit.credit || credit.total < 0) credit.offsetAmount = (credit.offsetAmount || 0) + p.amount;
      else credit.creditUsed = (credit.creditUsed || 0) + p.amount;
      p.target.offsetAmount = (p.target.offsetAmount || 0) + p.amount;
    } else {
      if (p.source.invoice) Object.assign(p.source.payment, {reclassified: true, reclassifiedTo: F.invoiceNumber(p.target), reclassifiedDate: p.date, reclassificationJournalNumber: entry.number, reclassificationBatch: entry.batchNumber});
      const moved = {id: makeId(), amount: p.amount, date: p.date, originalPaymentDate: p.source.payment.date, method: p.source.payment.method || 'Bank', reference: p.source.payment.reference, batch: entry.batchNumber, journalNumber: entry.number, source: 'Omförd inbetalning', reclassifiedFrom: p.origin, originalBatch: p.source.payment.batch, bankId: p.source.payment.bankId || null};
      (p.target.payments ||= []).push(moved);
      const bank = p.source.bank || (store.bankTransactions || []).find(t => t.id === moved.bankId);
      if (bank) Object.assign(bank, {status: 'Matchad', invoiceId: p.target.id, invoiceKind: 'customer', reclassificationJournalNumber: entry.number, reclassificationBatch: entry.batchNumber, proposal: `Omförd till faktura ${F.invoiceNumber(p.target)} · bunt ${entry.batchNumber}`});
    }
    if (p.source.invoice) F.updateStatus(p.source.invoice, 'customer');
    F.updateStatus(p.target, 'customer');
    return {entry, targetInvoice: p.target, sourceInvoice: p.source.invoice};
  }
  return {invoiceByRef, paymentByBatch, plan, execute};
});
