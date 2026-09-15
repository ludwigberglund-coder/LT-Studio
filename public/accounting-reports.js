(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RollandsAccountingReports = api;
})(globalThis, function() {
  function accountParts(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})(?:\s+(.+))?$/);
    if (!match) return {code: text.slice(0, 4), name: text.slice(5).trim()};
    return {code: match[1], name: match[2] || ''};
  }

  function inRange(date, from, to) {
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  function journal(store) {
    return [...(store?.journal || [])].sort((a, b) => {
      const date = String(a.date || '').localeCompare(String(b.date || ''));
      if (date) return date;
      return String(a.number || '').localeCompare(String(b.number || ''), 'sv', {numeric: true});
    });
  }

  function trialBalance(store, options = {}) {
    const {from = '', to = ''} = options;
    const accounts = new Map();
    for (const entry of journal(store)) {
      for (const row of entry.rows || []) {
        const {code, name} = accountParts(row.account);
        if (!/^\d{4}$/.test(code)) continue;
        if (!accounts.has(code)) accounts.set(code, {code, name, opening: 0, debit: 0, credit: 0, closing: 0, transactions: 0});
        const account = accounts.get(code);
        if (!account.name && name) account.name = name;
        const debit = Number(row.debit || 0);
        const credit = Number(row.credit || 0);
        if (from && entry.date < from) {
          account.opening += debit - credit;
        } else if (inRange(entry.date, from, to)) {
          account.debit += debit;
          account.credit += credit;
          account.closing += debit - credit;
          account.transactions += 1;
        }
      }
    }
    for (const account of accounts.values()) account.closing += account.opening;
    return [...accounts.values()].filter(account => account.opening || account.debit || account.credit || account.closing).sort((a, b) => a.code.localeCompare(b.code));
  }

  function generalLedger(store, accountCode, options = {}) {
    const code = String(accountCode || '').trim();
    const {from = '', to = ''} = options;
    let opening = 0;
    let running = 0;
    const rows = [];
    let name = '';
    for (const entry of journal(store)) {
      for (const row of entry.rows || []) {
        const parts = accountParts(row.account);
        if (parts.code !== code) continue;
        if (!name && parts.name) name = parts.name;
        const debit = Number(row.debit || 0);
        const credit = Number(row.credit || 0);
        const net = debit - credit;
        if (from && entry.date < from) {
          opening += net;
          continue;
        }
        if (!inRange(entry.date, from, to)) continue;
        running += net;
        rows.push({date: entry.date, number: entry.number, batchNumber: entry.batchNumber, description: entry.description, debit, credit, balance: opening + running});
      }
    }
    return {code, name, opening, closing: opening + running, rows};
  }

  function journalList(store, options = {}) {
    const {from = '', to = ''} = options;
    return journal(store).filter(entry => inRange(entry.date, from, to)).map(entry => ({
      id: entry.id,
      date: entry.date,
      number: entry.number,
      batchNumber: entry.batchNumber,
      description: entry.description,
      source: entry.source,
      debit: (entry.rows || []).reduce((sum, row) => sum + Number(row.debit || 0), 0),
      credit: (entry.rows || []).reduce((sum, row) => sum + Number(row.credit || 0), 0),
      rowCount: (entry.rows || []).length
    }));
  }

  function sequenceGapsFromEntries(entries) {
    const bySeries = new Map();
    for (const entry of entries || []) {
      const number = String(entry.number || '');
      const match = number.match(/^([A-Za-z]+)(\d+)$/);
      if (!match) continue;
      const series = match[1];
      if (!bySeries.has(series)) bySeries.set(series, []);
      bySeries.get(series).push(Number(match[2]));
    }
    const gaps = [];
    for (const [series, numbers] of bySeries) {
      const unique = [...new Set(numbers)].sort((a, b) => a - b);
      for (let index = 1; index < unique.length; index += 1) {
        for (let value = unique[index - 1] + 1; value < unique[index]; value += 1) gaps.push(`${series}${value}`);
      }
    }
    return gaps;
  }

  function sequenceGaps(store) {
    return sequenceGapsFromEntries(journal(store));
  }

  function periodControl(store, options = {}) {
    const entries = journalList(store, options);
    const unbalanced = entries.filter(entry => entry.debit !== entry.credit).map(entry => entry.number || entry.id);
    const missingDescription = entries.filter(entry => !String(entry.description || '').trim()).map(entry => entry.number || entry.id);
    const duplicateNumbers = [];
    const seen = new Set();
    for (const entry of entries) {
      const number = String(entry.number || '');
      if (!number) continue;
      if (seen.has(number) && !duplicateNumbers.includes(number)) duplicateNumbers.push(number);
      seen.add(number);
    }
    return {
      entries: entries.length,
      debit: entries.reduce((sum, entry) => sum + entry.debit, 0),
      credit: entries.reduce((sum, entry) => sum + entry.credit, 0),
      unbalanced,
      missingDescription,
      duplicateNumbers,
      sequenceGaps: sequenceGapsFromEntries(entries),
      ok: !unbalanced.length && !missingDescription.length && !duplicateNumbers.length
    };
  }

  return {accountParts, trialBalance, generalLedger, journalList, sequenceGaps, periodControl};
});
