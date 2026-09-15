import {escapeHtml, readLocalJson, writeLocalJson} from '../shared/content.js';

const STORAGE_KEY = 'rollands-money-calculator-v1';
const money = globalThis.RollandsMoney;

function defaultRows() {
  return [
    {description: 'Fruktlåda', quantity: '2', unitPrice: '149,50', vatRate: '12'},
    {description: 'Leverans', quantity: '1', unitPrice: '75,00', vatRate: '25'}
  ];
}

function normalizedRows(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return defaultRows();
  return value.map(row => ({
    description: String(row?.description || ''),
    quantity: String(row?.quantity || '1'),
    unitPrice: String(row?.unitPrice || '0,00'),
    vatRate: ['0', '6', '12', '25'].includes(String(row?.vatRate)) ? String(row.vatRate) : '25'
  }));
}

let rows = normalizedRows(readLocalJson(STORAGE_KEY));

function persist() {
  writeLocalJson(STORAGE_KEY, rows);
}

function calculation() {
  if (!money) throw new Error('Öresmodulen kunde inte laddas.');
  return money.calculateInvoice(rows.map((row, index) => ({
    description: row.description || `Rad ${index + 1}`,
    quantityMilli: money.parseQuantityMilli(row.quantity, {label: `Antal på rad ${index + 1}`}),
    unitPriceOre: money.parseOre(row.unitPrice, {label: `Styckepris på rad ${index + 1}`}),
    vatBasisPoints: money.parseVatBasisPoints(row.vatRate, {label: `Moms på rad ${index + 1}`})
  })));
}

function lineMarkup(row, index) {
  const options = ['0', '6', '12', '25'].map(rate => `
    <option value="${rate}" ${row.vatRate === rate ? 'selected' : ''}>${rate} %</option>
  `).join('');

  return `
    <div class="money-line" data-money-row="${index}">
      <label class="money-field">
        <span>Beskrivning</span>
        <input data-money-index="${index}" data-money-field="description" value="${escapeHtml(row.description)}" placeholder="Exempel: Fruktlåda">
      </label>
      <label class="money-field">
        <span>Antal</span>
        <input data-money-index="${index}" data-money-field="quantity" value="${escapeHtml(row.quantity)}" inputmode="decimal" aria-label="Antal på rad ${index + 1}">
      </label>
      <label class="money-field">
        <span>Pris exkl. moms</span>
        <input data-money-index="${index}" data-money-field="unitPrice" value="${escapeHtml(row.unitPrice)}" inputmode="decimal" aria-label="Styckepris på rad ${index + 1}">
      </label>
      <label class="money-field">
        <span>Moms</span>
        <select data-money-index="${index}" data-money-field="vatRate" aria-label="Moms på rad ${index + 1}">${options}</select>
      </label>
      <button class="money-remove" type="button" data-action="remove-money-row" data-index="${index}" ${rows.length === 1 ? 'disabled' : ''} aria-label="Ta bort rad ${index + 1}">×</button>
    </div>
  `;
}

function breakdownMarkup(invoice) {
  return invoice.vatBreakdown.map(group => `
    <tr>
      <th>${escapeHtml(String(group.vatBasisPoints / money.BASIS_POINTS_PER_PERCENT))} %</th>
      <td>${escapeHtml(money.formatSek(group.netOre))}</td>
      <td>${escapeHtml(money.formatSek(group.vatOre))}</td>
      <td>${escapeHtml(money.formatSek(group.grossOre))}</td>
    </tr>
  `).join('');
}

function resultMarkup() {
  try {
    const invoice = calculation();
    return `
      <div class="money-summary">
        <article><span>Exklusive moms</span><strong>${escapeHtml(money.formatSek(invoice.netOre))}</strong></article>
        <article><span>Moms</span><strong>${escapeHtml(money.formatSek(invoice.vatOre))}</strong></article>
        <article><span>Att betala</span><strong>${escapeHtml(money.formatSek(invoice.grossOre))}</strong></article>
      </div>
      <div class="money-breakdown">
        <h3>Momsfördelning</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Sats</th><th>Underlag</th><th>Moms</th><th>Totalt</th></tr></thead>
            <tbody>${breakdownMarkup(invoice)}</tbody>
          </table>
        </div>
      </div>
      <div class="money-technical">
        <strong>Exakt lagring</strong>
        <span>${invoice.grossOre} öre lagras som heltal. Ingen flyttalsavrundning används i bokföringsunderlaget.</span>
      </div>
    `;
  } catch (error) {
    return `<div class="money-error"><strong>Kontrollera uppgifterna.</strong><br>${escapeHtml(error.message)}</div>`;
  }
}

export function moneyView() {
  const lines = rows.map(lineMarkup).join('');
  return `
    <section class="money-layout">
      <article class="panel money-panel">
        <div class="panel-heading">
          <div>
            <span class="kicker">Ny gemensam domänmodell</span>
            <h2>Fakturakalkylator med öresprecision</h2>
            <p>Ange antal med högst tre decimaler och pris med högst två decimaler. Komma eller punkt fungerar som decimaltecken.</p>
          </div>
        </div>
        <div class="money-lines">
          <div class="money-line money-line-head" aria-hidden="true">
            <span>Beskrivning</span><span>Antal</span><span>Pris exkl. moms</span><span>Moms</span><span></span>
          </div>
          ${lines}
        </div>
        <div class="form-actions">
          <button class="button primary" type="button" data-action="add-money-row">Lägg till rad</button>
          <button class="button ghost" type="button" data-action="reset-money-calculator">Återställ exempel</button>
        </div>
        <div class="money-note">
          <span class="kicker">Varför detta byggs först</span>
          <p>Fakturor, betalningar, lager, lön och huvudbok måste använda samma exakta regler. Modulen ligger därför separat i <code>packages/accounting/money.js</code>.</p>
        </div>
      </article>
      <aside class="panel money-result-panel">
        <span class="kicker">Beräknat underlag</span>
        <h2>Summering</h2>
        <div id="money-result" aria-live="polite">${resultMarkup()}</div>
      </aside>
    </section>
  `;
}

function updateResult() {
  const target = document.getElementById('money-result');
  if (target) target.innerHTML = resultMarkup();
}

export function handleMoneyInput(target) {
  const field = target?.dataset?.moneyField;
  const index = Number(target?.dataset?.moneyIndex);
  if (!field || !Number.isInteger(index) || !rows[index] || !Object.hasOwn(rows[index], field)) return false;
  rows[index][field] = target.value;
  persist();
  updateResult();
  return true;
}

export function handleMoneyClick(button, rerender) {
  const action = button?.dataset?.action;
  if (!['add-money-row', 'remove-money-row', 'reset-money-calculator'].includes(action)) return false;

  if (action === 'add-money-row') {
    if (rows.length >= 30) return true;
    rows.push({description: '', quantity: '1', unitPrice: '0,00', vatRate: '12'});
    persist();
  }

  if (action === 'remove-money-row') {
    const index = Number(button.dataset.index);
    if (rows.length > 1 && Number.isInteger(index) && rows[index]) {
      rows.splice(index, 1);
      persist();
    }
  }

  if (action === 'reset-money-calculator') {
    rows = defaultRows();
    localStorage.removeItem(STORAGE_KEY);
  }

  rerender();
  return true;
}
