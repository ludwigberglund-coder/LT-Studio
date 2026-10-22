'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Queue = require('../apps/portal/payables-queue.js');
const Journey = require('../apps/portal/supplier-journey.js');
const source = fs.readFileSync(path.join(__dirname, '../apps/portal/payables.js'), 'utf8');

function invoice(id, status, extra = {}) {
  return { id, company_id: 'tenant-a', supplier_id: 'supplier-a', status,
    supplier_invoice_number: id, invoice_date: '2026-10-20', due_date: '2026-11-20',
    total_ore: 12500, vat_ore: 2500, remaining_ore: status === 'paid' ? 0 : 12500,
    coding_json: [], ...extra };
}
function fixture() {
  return [invoice('review', 'registered'), invoice('approve', 'coded'),
    invoice('unposted', 'approved'), invoice('plan', 'approved', { liability_accounting_entry_id: 'journal-a' }),
    invoice('prepared', 'payment-prepared'), invoice('paid', 'paid'),
    invoice('cancelled', 'cancelled'), invoice('rejected', 'rejected'), invoice('unknown', 'future-status')];
}
function ui(options = {}) {
  const handlers = {}, attempts = [], reads = [];
  const app = { innerHTML: '', insertAdjacentHTML: (_where, html) => { app.innerHTML += html; } };
  let context = { authenticated: true, company: { id: 'tenant-a', name: 'Synthetic company' },
    user: { displayName: 'Synthetic reviewer' }, authUser: { id: 'user-a' },
    membership: { role: 'accountant' }, accessToken: 'synthetic-token' };
  const tables = { suppliers: [{ id: 'supplier-a', company_id: 'tenant-a', name: options.name || 'Synthetic supplier' }],
    supplier_invoices: options.rows || fixture(), documents: [], supplier_payments: [], financial_batches: [] };
  const deny = kind => (...args) => { attempts.push({ kind, args }); throw new Error('Unexpected mutation: ' + kind); };
  const document = { getElementById: id => id === 'payables-app' ? app : null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener: (name, callback) => { handlers[name] = callback; } };
  const sandbox = vm.createContext({ document,
    globalThis: { RollandsPayablesQueue: Queue, LTStudioSupplierJourney: options.missingJourney ? undefined : Journey },
    window: { LTSupabaseUat: { context: async () => structuredClone(context) },
      LTSupabase: { from: (table, token) => ({ select: async (_columns, filter) => {
        assert.equal(token, 'synthetic-token'); assert.match(filter, /^company_id=eq\.tenant-a(?:&|$)/);
        reads.push(table); return structuredClone(tables[table]);
      }, insert: deny('insert'), update: deny('update'), delete: deny('delete') }),
      rpc: deny('rpc'), functions: { invoke: deny('edge') }, storage: { download: deny('download'), upload: deny('upload') } } },
    sessionStorage: { getItem: () => '', setItem: deny('session-write') },
    localStorage: { getItem: () => '', setItem: deny('local-write') }, fetch: deny('fetch'),
    location: { hostname: 'ludwigberglund-coder.github.io', pathname: options.ledger ? '/portal/supplier-ledger.html' : '/portal/payables.html', search: options.search || '', href: '' },
    URLSearchParams, Intl, Map, Set, Number, Boolean, JSON, Object, Error, String, Array, structuredClone,
    requestAnimationFrame: fn => fn(), setTimeout: () => 1, clearTimeout: () => {}, console });
  vm.runInContext(source, sandbox, { filename: 'payables.js' });
  const run = code => vm.runInContext(code, sandbox);
  const click = async (selector, dataset) => handlers.click({ target: {
    matches: () => false, closest: query => query === selector ? { dataset } : null
  } });
  return { app, attempts, reads, tables,
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); },
    state: () => JSON.parse(run('JSON.stringify({selected,invoices,queueFilter,message,codingDirty,drafts:supplierReviewDrafts.size})')),
    filter: value => click('[data-filter]', { filter: value }),
    openPayment: () => click('[data-action]', { action: 'open-payment-plan' }),
    closePayment: () => click('[data-payment-plan-cancel]', {}),
    choose: id => click('[data-invoice-id]', { invoiceId: id }),
    visible: () => JSON.parse(run('JSON.stringify(queueInvoices().map(row=>row.id))')),
    query: value => { sandbox.searchTerm = value; run('queueQuery=searchTerm;render()'); },
    setContext: changes => { context = { ...context, ...changes }; },
    markDraft: () => run('codingDirty=true;selected={...selected,coding:[{account:"6110",debitOre:12500,creditOre:0}]}'),
    planningLink: () => run('paymentPlanningHref(selected)'),
    rowMarkup: () => run('queueRows()'),
    ledgerMarkup: () => run('ledgerRows()') };
}

test('actual portal renders four useful task groups with counts from the same loaded invoices', async () => {
  const page = ui(); await page.settle();
  for (const label of ['Att godkänna', 'Att betala', 'Behöver hjälp', 'Historik']) assert.ok(page.app.innerHTML.includes(label), label);
  for (const [filter, count] of [['approval', 1], ['payment', 2], ['help', 4], ['history', 2]]) {
    assert.match(page.app.innerHTML, new RegExp('data-filter="' + filter + '"[^>]*>[\\s\\S]*?supplier-task-count">' + count + '<'));
  }
  assert.match(page.app.innerHTML, /9 inlästa fakturor/); assert.equal(page.reads.length, 5); assert.equal(page.attempts.length, 0);
});
test('clicking each task filter changes actual rows, never makes a financial call', async () => {
  const page = ui(); await page.settle();
  for (const [filter, ids] of [['approval', ['approve']], ['payment', ['plan', 'prepared']],
    ['help', ['review', 'unposted', 'unknown', 'rejected']], ['history', ['cancelled', 'paid']]]) {
    await page.filter(filter); assert.deepEqual(page.visible(), ids, filter);
    assert.equal(page.state().selected, null, 'a hidden earlier invoice must not remain actionable');
    assert.match(page.app.innerHTML, new RegExp('data-filter="' + filter + '" aria-pressed="true"'));
  }
  assert.equal(page.attempts.length, 0); assert.equal(page.reads.length, 5);
});
test('unknown filter names cannot expand access or change the current queue', async () => {
  const page = ui(); await page.settle(); const before = page.state().queueFilter;
  await page.filter('__proto__'); assert.equal(page.state().queueFilter, before); assert.equal(page.attempts.length, 0);
});
test('search is intersected with the chosen queue and counters remain loaded-snapshot totals', async () => {
  const page = ui(); await page.settle(); await page.filter('payment');
  page.query('prepared'); assert.deepEqual(page.visible(), ['prepared']);
  page.query('approve'); assert.deepEqual(page.visible(), []);
  assert.match(page.app.innerHTML, /Inga fakturor matchar/); assert.match(page.app.innerHTML, /9 inlästa fakturor/);
  assert.equal(page.attempts.length, 0);
});
test('one supplier page opens an explicit payment review without any bank or accounting mutation', async () => {
  const page = ui(); await page.settle(); await page.choose('plan');
  assert.match(page.app.innerHTML, /Leverantörsfakturor & betalning/);
  assert.match(page.app.innerHTML, /data-action="open-payment-plan">Betala/);
  await page.openPayment();
  assert.match(page.app.innerHTML, /role="dialog" aria-modal="true" aria-labelledby="supplier-plan-title"/);
  assert.match(page.app.innerHTML, /Förbered betalning – inte skicka/);
  assert.match(page.app.innerHTML, /Inga pengar skickas till banken/);
  assert.equal(page.attempts.length,0);
  await page.closePayment();
  assert.doesNotMatch(page.app.innerHTML, /supplier-plan-title/);
  assert.equal(page.attempts.length,0);
});
test('unapproved invoice cannot open a payment operation', async () => {
  const page = ui(); await page.settle(); await page.choose('approve');
  await page.openPayment();
  assert.doesNotMatch(page.app.innerHTML, /supplier-plan-title/);
  assert.equal(page.attempts.length,0);
});
test('planning link carries the chosen invoice and company, and opens that invoice on the existing page', async () => {
  const page = ui(); await page.settle(); await page.choose('plan');
  const href = page.planningLink(); const url = new URL(href, 'https://synthetic.example/portal/payables.html');
  assert.equal(url.pathname, '/portal/supplier-ledger.html'); assert.equal(url.searchParams.get('invoiceId'), 'plan');
  assert.equal(url.searchParams.get('companyId'), 'tenant-a');
  const ledger = ui({ ledger: true, search: url.search }); await ledger.settle();
  assert.equal(ledger.state().selected.id, 'plan'); assert.equal(ledger.attempts.length, 0);
});
for (const [name, search] of [
  ['unknown invoice', '?invoiceId=not-here&companyId=tenant-a'],
  ['wrong company', '?invoiceId=plan&companyId=tenant-b'],
  ['unposted liability', '?invoiceId=unposted&companyId=tenant-a'],
  ['empty identifier', '?invoiceId='], ['malformed identifier', '?invoiceId=%3Cscript%3E']
]) test('deep link fails without falling back to another invoice: ' + name, async () => {
  const page = ui({ ledger: true, search }); await page.settle();
  assert.equal(page.state().selected, null); assert.match(page.state().message, /kan inte visas/);
  assert.equal(page.attempts.length, 0);
});
test('draft remains in the existing scoped draft store when its queue is hidden', async () => {
  const page = ui(); await page.settle(); page.markDraft(); await page.filter('approval');
  assert.equal(page.state().selected, null); assert.equal(page.state().drafts, 1);
  await page.choose('review'); assert.equal(page.state().selected.coding[0].account, '6110');
  assert.equal(page.state().codingDirty, true); assert.equal(page.attempts.length, 0);
});
test('company change before opening a queue result clears old-company data', async () => {
  const page = ui(); await page.settle(); await page.filter('approval');
  page.setContext({ company: { id: 'tenant-b', name: 'Another company' } }); await page.choose('approve');
  assert.equal(page.state().selected, null); assert.equal(page.state().invoices.length, 0);
  assert.doesNotMatch(page.app.innerHTML, /Synthetic supplier/); assert.equal(page.attempts.length, 0);
});
test('cross-company rows still fail before task counters or invoice details are rendered', async () => {
  const page = ui({ rows: [invoice('foreign', 'coded', { company_id: 'tenant-b' })] }); await page.settle();
  assert.match(page.app.innerHTML, /Kunde inte ladda/); assert.doesNotMatch(page.app.innerHTML, /supplier-task-count/);
  assert.equal(page.attempts.length, 0);
});
test('invoice buttons escape untrusted supplier text and remain keyboard accessible', async () => {
  const page = ui({ name: '<img src=x onerror=alert(1)>' }); await page.settle();
  assert.doesNotMatch(page.rowMarkup(), /<img/); assert.match(page.rowMarkup(), /&lt;img/);
  assert.match(page.rowMarkup(), /button type="button" class="supplier-open-invoice"/);
  for (const label of ['Nästa steg', 'Leverantör', 'Faktura', 'Fakturadatum', 'Förfallodatum', 'Belopp']) {
    assert.ok(page.rowMarkup().includes('data-label="' + label + '"'), label);
  }
});
test('zero remaining balance is not replaced by the original invoice total', async () => {
  const page = ui({ ledger: true, search: '?invoiceId=paid&companyId=tenant-a' }); await page.settle();
  assert.match(page.app.innerHTML, /<span>Restbelopp<\/span><strong>0,00/);
  assert.doesNotMatch(page.app.innerHTML, /Betald och avstämd/);
});
test('missing display helper shows an unavailable queue, not false successful counts', async () => {
  const page = ui({ missingJourney: true }); await page.settle();
  assert.match(page.app.innerHTML, /Arbetskön kunde inte laddas/); assert.doesNotMatch(page.app.innerHTML, /supplier-task-count/);
});
test('both existing entry points load the helper before the application; shared design system remains last', () => {
  for (const name of ['payables', 'supplier-ledger']) {
    const html = fs.readFileSync(path.join(__dirname, '../apps/portal/' + name + '.html'), 'utf8');
    assert.ok(html.indexOf('supplier-journey.js') < html.indexOf('payables.js?'));
    if (name === 'payables') assert.ok(html.indexOf('supplier-workspace.css') < html.indexOf('design-system.css'));
  }
});
