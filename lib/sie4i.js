'use strict';

const AccountPlan = require('../public/account-plan.js');

const CP437_EXTENDED = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const CP437_INDEX = new Map([...CP437_EXTENDED].map((character, index) => [character, index + 128]));

function compactDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`Ogiltigt SIE-datum: ${text || '(tomt)'}.`);
  return text.replaceAll('-', '');
}

function generationDate(value = new Date()) {
  if (typeof value === 'string') return compactDate(value);
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Ogiltigt genereringsdatum för SIE-export.');
  return value.toISOString().slice(0, 10).replaceAll('-', '');
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoted(value) {
  const text = cleanText(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${text}"`;
}

function encodeCp437(text) {
  const bytes = [];
  for (const character of String(text)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }
    const mapped = CP437_INDEX.get(character);
    if (mapped == null) {
      const error = new Error(`Tecknet ${JSON.stringify(character)} (U+${codePoint.toString(16).toUpperCase()}) kan inte representeras i SIE:s teckenuppsättning PC8/Codepage 437.`);
      error.code = 'SIE_UNSUPPORTED_CHARACTER';
      throw error;
    }
    bytes.push(mapped);
  }
  return Buffer.from(bytes);
}

function parseAccount(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})(?:\s+(.+))?$/);
  if (!match) throw new Error(`Ogiltigt konto för SIE-export: ${text || '(tomt)'}. Kontot måste börja med fyra siffror.`);
  return {code: match[1], inlineName: cleanText(match[2] || '')};
}

function accountName(code, inlineName) {
  return AccountPlan.byCode?.[code]?.name || inlineName || `Konto ${code}`;
}

function amount(row) {
  const debit = Number(row.debit || 0);
  const credit = Number(row.credit || 0);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) throw new Error('SIE-export kräver bokföringsbelopp i hela kronor och utan negativa radbelopp.');
  if ((debit > 0) === (credit > 0)) throw new Error('Varje SIE-transaktion måste ha exakt ett debet- eller kreditbelopp.');
  return debit - credit;
}

function formatAmount(value) {
  if (!Number.isSafeInteger(value)) throw new Error('SIE-export kräver heltalsbelopp i kronor i nuvarande datamodell.');
  return `${value.toFixed(2)}`;
}

function seriesAndNumber(entry) {
  const rawNumber = cleanText(entry.number || entry.id);
  let series = cleanText(entry.series || '');
  if (!series) {
    const prefix = rawNumber.match(/^([A-Za-z][A-Za-z0-9_-]*?)(?=\d+$)/);
    series = prefix ? prefix[1] : 'A';
  }
  let number = rawNumber;
  if (number.startsWith(series) && number.length > series.length) number = number.slice(series.length);
  if (!number) number = rawNumber || cleanText(entry.id);
  if (!number) throw new Error('Verifikation saknar nummer för SIE-export.');
  return {series, number};
}

function assertBalanced(entry) {
  if (!Array.isArray(entry.rows) || entry.rows.length < 2) throw new Error(`Verifikation ${entry.number || entry.id || ''} saknar tillräckliga konteringsrader.`);
  const total = entry.rows.reduce((sum, row) => sum + amount(row), 0);
  if (total !== 0) throw new Error(`Verifikation ${entry.number || entry.id || ''} balanserar inte och kan därför inte SIE-exporteras.`);
}

function journalForExport(store) {
  return [...(store.journal || [])].sort((a, b) => {
    const dateComparison = String(a.date || '').localeCompare(String(b.date || ''));
    if (dateComparison) return dateComparison;
    return String(a.number || '').localeCompare(String(b.number || ''), 'sv', {numeric: true});
  });
}

function usedAccounts(journal) {
  const accounts = new Map();
  for (const entry of journal) {
    for (const row of entry.rows || []) {
      const parsed = parseAccount(row.account);
      if (!accounts.has(parsed.code)) accounts.set(parsed.code, accountName(parsed.code, parsed.inlineName));
    }
  }
  return [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b, 'sv', {numeric: true}));
}

function buildSie4iText(store, options = {}) {
  if (!store || typeof store !== 'object') throw new Error('Datalager saknas för SIE-export.');
  const journal = journalForExport(store);
  for (const entry of journal) assertBalanced(entry);

  const business = store.business || {};
  const companyName = cleanText(business.name);
  if (!companyName) throw new Error('Företagsnamn saknas och SIE-filen kan därför inte skapas.');

  const lines = [
    '#FLAGGA 0',
    `#PROGRAM ${quoted(options.programName || 'Rollands Ekonomi')} ${cleanText(options.programVersion || '0.1.0')}`,
    '#FORMAT PC8',
    `#GEN ${generationDate(options.generatedAt)} ${cleanText(options.signature || 'Rollands')}`,
    '#SIETYP 4',
    `#FNAMN ${quoted(companyName)}`
  ];

  const organisationNumber = cleanText(business.orgNumber || business.organizationNumber || business.orgnr || '');
  if (organisationNumber) lines.push(`#ORGNR ${organisationNumber}`);
  lines.push('#FTYP AB');
  lines.push(`#VALUTA ${cleanText(options.currency || 'SEK')}`);

  const dates = journal.map(entry => String(entry.date || '')).filter(Boolean).sort();
  if (dates.length) {
    const firstYear = dates[0].slice(0, 4);
    const sameYear = dates.every(date => date.startsWith(firstYear));
    if (sameYear) lines.push(`#RAR 0 ${firstYear}0101 ${firstYear}1231`);
  }

  for (const [code, name] of usedAccounts(journal)) lines.push(`#KONTO ${code} ${quoted(name)}`);

  for (const entry of journal) {
    const {series, number} = seriesAndNumber(entry);
    lines.push(`#VER ${quoted(series)} ${quoted(number)} ${compactDate(entry.date)} ${quoted(entry.description || entry.source || '')}`);
    lines.push('{');
    for (const row of entry.rows) {
      const {code} = parseAccount(row.account);
      lines.push(`#TRANS ${code} {} ${formatAmount(amount(row))} ""`);
    }
    lines.push('}');
  }

  return `${lines.join('\n')}\n`;
}

function buildSie4i(store, options = {}) {
  return encodeCp437(buildSie4iText(store, options));
}

module.exports = {
  buildSie4i,
  buildSie4iText,
  encodeCp437,
  compactDate,
  parseAccount,
  seriesAndNumber
};
