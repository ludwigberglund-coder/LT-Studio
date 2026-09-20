import {escapeHtml} from '../shared/content.js';

const STORAGE_KEY = 'rollands-journal-domain-demo-v1';

let accessConfig;
let accessModel;
let ledger;
let selectedUserId = 'demo-user-1';
let message = '';
let messageIsError = false;
let formState = {
  date: '2026-09-15',
  description: 'Manuell omföring i utvecklingsdemo',
  amount: '1 120,00',
  debitAccount: '4010',
  creditAccount: '2440'
};

function api() {
  if (!globalThis.RollandsJournal) throw new Error('Verifikationsmotorn kunde inte laddas.');
  return globalThis.RollandsJournal;
}

function money() {
  if (!globalThis.RollandsMoney) throw new Error('Öresmodulen kunde inte laddas.');
  return globalThis.RollandsMoney;
}

function access() {
  if (!globalThis.RollandsAccessControl) throw new Error('Behörighetsmodulen kunde inte laddas.');
  return globalThis.RollandsAccessControl;
}

function actor() {
  return {id:selectedUserId,companyId:'demo-company',authenticated:true,membershipActive:true};
}

function context(extra = {}) {
  return {
    actor: actor(),
    access: accessModel,
    now: new Date().toISOString(),
    ...extra
  };
}

function createSeedLedger() {
  let state = api().createLedger({
    fiscalYearStart: '2026-01-01',
    fiscalYearEnd: '2026-12-31',
    defaultSeries: 'A'
  });
  const seed = api().postEntry(state, {
    date: '2026-09-01',
    description: 'Demofaktura – företagsfrukt',
    source: {type: 'demo', reference: 'DEMO-1001'},
    rows: [
      {account: '1510', text: 'Kundfordran', debitOre: 112000, creditOre: 0},
      {account: '3052', text: 'Försäljning 12 %', debitOre: 0, creditOre: 100000},
      {account: '2621', text: 'Utgående moms 12 %', debitOre: 0, creditOre: 12000}
    ]
  }, {
    actor: {id:'demo-user-1',companyId:'demo-company',authenticated:true,membershipActive:true},
    access: accessModel,
    now: '2026-09-01T08:00:00.000Z',
    idFactory: prefix => `${prefix}-seed-1001`
  });
  return seed.state;
}

function loadLedger() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && api().validateLedger(saved).ok) return saved;
  } catch {}
  return createSeedLedger();
}

function saveLedger() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
}

function showMessage(text, isError = false) {
  message = text;
  messageIsError = isError;
}

export function configureJournal(config) {
  accessConfig = config;
  accessModel = access().createModel(config);
  ledger = loadLedger();
}

function userOptions() {
  return ['demo-user-1','demo-user-2'].map(id=>`<option value="${id}" ${id===selectedUserId?'selected':''}>${id}</option>`).join('');
}

function kindLabel(kind) {
  return ({standard: 'Normal', reversal: 'Motverifikation', replacement: 'Ersättning', opening: 'Ingående balans'})[kind] || kind;
}

function entryRows() {
  return [...ledger.entries].reverse().map(entry => {
    const correction = ledger.corrections[entry.id];
    const canCorrect = entry.kind !== 'reversal' && !correction;
    return `
      <tr>
        <td><b>${escapeHtml(entry.number)}</b><small>${escapeHtml(kindLabel(entry.kind))}</small></td>
        <td>${escapeHtml(entry.date)}</td>
        <td><b>${escapeHtml(entry.description)}</b><small>${escapeHtml(entry.source.type)} · ${escapeHtml(entry.source.reference || 'utan referens')}</small></td>
        <td class="number-cell">${escapeHtml(money().formatSek(entry.totals.debitOre))}</td>
        <td>${escapeHtml(entry.createdBy)}</td>
        <td>
          ${correction ? '<span class="status ready">Rättad</span>' : '<span class="status progress">Bokförd</span>'}
          ${canCorrect ? `<button class="table-action" type="button" data-journal-action="correct" data-entry-id="${escapeHtml(entry.id)}">Skapa motverifikation</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function eventRows() {
  return [...ledger.events].reverse().slice(0, 8).map(event => `
    <li>
      <span>${escapeHtml(event.type)}</span>
      <div><b>${escapeHtml(event.details)}</b><small>${escapeHtml(event.actorId)} · ${escapeHtml(new Date(event.at).toLocaleString('sv-SE'))}</small></div>
    </li>
  `).join('');
}

function currentPeriod() {
  return /^\d{4}-\d{2}-\d{2}$/.test(formState.date) ? formState.date.slice(0, 7) : '2026-09';
}

function messageMarkup() {
  if (!message) return '';
  return `<div class="journal-message ${messageIsError ? 'error' : 'success'}" role="status">${escapeHtml(message)}</div>`;
}

export function journalView() {
  if (!ledger) return '<section class="panel"><p>Verifikationsmotorn är inte laddad.</p></section>';
  const report = api().validateLedger(ledger);
  const period = currentPeriod();
  const locked = api().periodStatus(ledger, period) === 'locked';

  return `
    <section class="metrics-grid journal-metrics">
      <article class="metric-card"><span>Verifikationer</span><strong>${report.summary.entries}</strong><p>Alla poster är balanserade och numrerade per serie.</p></article>
      <article class="metric-card"><span>Nästa nummer</span><strong>A${Number(ledger.sequences['A:2026'] || 0) + 1}</strong><p>Löpnummer återanvänds inte efter rättelser.</p></article>
      <article class="metric-card"><span>Rättelser</span><strong>${report.summary.corrections}</strong><p>Originalposter bevaras och vänds med nya poster.</p></article>
      <article class="metric-card"><span>Period ${escapeHtml(period)}</span><strong>${locked ? 'Låst' : 'Öppen'}</strong><p>${locked ? 'Nya poster stoppas.' : 'Bokföring är tillåten för företagets medlemmar.'}</p></article>
    </section>

    ${messageMarkup()}

    <section class="journal-layout">
      <form class="panel journal-form" data-journal-form>
        <div class="panel-heading">
          <div><span class="kicker">Domändemo</span><h2>Bokför en balanserad verifikation</h2><p>Alla belopp omvandlas till heltal i ören innan posten skapas.</p></div>
        </div>
        <div class="journal-form-grid">
          <label class="field"><span>Personlig demoanvändare</span><select data-journal-field="user">${userOptions()}</select></label>
          <label class="field"><span>Bokföringsdag</span><input type="date" value="${escapeHtml(formState.date)}" data-journal-field="date" required></label>
          <label class="field journal-wide"><span>Beskrivning</span><input value="${escapeHtml(formState.description)}" data-journal-field="description" required></label>
          <label class="field"><span>Belopp inklusive ören</span><input inputmode="decimal" value="${escapeHtml(formState.amount)}" data-journal-field="amount" required></label>
          <label class="field"><span>Debetkonto</span><input inputmode="numeric" maxlength="4" value="${escapeHtml(formState.debitAccount)}" data-journal-field="debitAccount" required></label>
          <label class="field"><span>Kreditkonto</span><input inputmode="numeric" maxlength="4" value="${escapeHtml(formState.creditAccount)}" data-journal-field="creditAccount" required></label>
        </div>
        <p>Alla demoanvändare har samma funktioner. Företagsisoleringen kontrolleras i den privata servern.</p>
        <div class="form-actions">
          <button class="button primary" type="submit">Bokför verifikation</button>
          <button class="button ghost" type="button" data-journal-action="lock">Lås ${escapeHtml(period)}</button>
          <button class="button ghost" type="button" data-journal-action="unlock">Lås upp ${escapeHtml(period)}</button>
          <button class="button danger" type="button" data-journal-action="reset">Återställ demo</button>
        </div>
      </form>

      <aside class="panel journal-rules">
        <span class="kicker">Regler som tillämpas</span>
        <h2>Ingen direkt redigering efter bokföring</h2>
        <ul>
          <li>Minst två konteringsrader.</li>
          <li>Debet och kredit måste vara exakt lika i ören.</li>
          <li>Fyra siffror krävs för varje konto.</li>
          <li>Låsta perioder stoppar nya poster.</li>
          <li>Rättelser skapar motverifikation, aldrig överskrivning.</li>
          <li>Behörighet kontrolleras före varje åtgärd.</li>
        </ul>
        <p>För upplåsning används en separat beställare i demon. Den aktiva rollen måste dessutom ha behörigheten <code>period.unlock</code>.</p>
      </aside>
    </section>

    <section class="panel journal-table-panel">
      <div class="panel-heading"><div><span class="kicker">Huvudbokskärna</span><h2>Postade verifikationer</h2><p>Senaste posten visas överst. Originalet ligger kvar även efter rättelse.</p></div></div>
      <div class="table-wrap">
        <table class="journal-table">
          <thead><tr><th>Nummer</th><th>Datum</th><th>Beskrivning</th><th>Debet</th><th>Skapad av</th><th>Status</th></tr></thead>
          <tbody>${entryRows()}</tbody>
        </table>
      </div>
    </section>

    <section class="panel journal-events">
      <div class="panel-heading"><div><span class="kicker">Behandlingshistorik</span><h2>Senaste domänhändelser</h2><p>Detta är demo för spårbarheten; produktion får permanent serverlogg och extern förankring.</p></div></div>
      <ol>${eventRows()}</ol>
    </section>
  `;
}

export function handleJournalInput(target, render) {
  const field = target?.dataset?.journalField;
  if (!field) return false;
  if (field === 'user') selectedUserId = target.value;
  else if (Object.hasOwn(formState, field)) formState[field] = target.value;
  message = '';
  if (field === 'user' || field === 'date') render();
  return true;
}

export function handleJournalSubmit(form, render) {
  if (!form?.matches?.('[data-journal-form]')) return false;
  try {
    const amountOre = money().parseOre(formState.amount, {label: 'Beloppet', allowNegative: false, allowZero: false});
    const result = api().postEntry(ledger, {
      date: formState.date,
      description: formState.description,
      source: {type: 'manual-demo', reference: ''},
      rows: [
        {account: formState.debitAccount, text: formState.description, debitOre: amountOre, creditOre: 0},
        {account: formState.creditAccount, text: formState.description, debitOre: 0, creditOre: amountOre}
      ]
    }, context());
    ledger = result.state;
    saveLedger();
    showMessage(`${result.entry.number} bokfördes med ${money().formatSek(amountOre)}.`);
  } catch (error) {
    showMessage(error.message, true);
  }
  render();
  return true;
}

export function handleJournalClick(button, render) {
  const actionName = button?.dataset?.journalAction;
  if (!actionName) return false;
  try {
    if (actionName === 'lock') {
      const result = api().lockPeriod(ledger, currentPeriod(), context({reason: 'Period låst i utvecklingsdemon efter kontroll'}));
      ledger = result.state;
      saveLedger();
      showMessage(`${currentPeriod()} är nu låst.`);
    }
    if (actionName === 'unlock') {
      const result = api().unlockPeriod(ledger, currentPeriod(), context({
        requestedBy: 'demo-requester',
        reason: 'Period upplåst i utvecklingsdemon för en spårbar rättelse'
      }));
      ledger = result.state;
      saveLedger();
      showMessage(`${currentPeriod()} är nu upplåst.`);
    }
    if (actionName === 'correct') {
      const entryId = button.dataset.entryId;
      const result = api().correctEntry(ledger, {
        entryId,
        date: formState.date,
        reason: 'Spårbar rättelse skapad i utvecklingsdemon'
      }, context());
      ledger = result.state;
      saveLedger();
      showMessage(`${result.original.number} rättades med ${result.reversal.number}.`);
    }
    if (actionName === 'reset') {
      localStorage.removeItem(STORAGE_KEY);
      ledger = createSeedLedger();
      showMessage('Verifikationsdemon är återställd.');
    }
  } catch (error) {
    showMessage(error.message, true);
  }
  render();
  return true;
}
