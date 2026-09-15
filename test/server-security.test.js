'use strict';

const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.ROLLANDS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rollands-security-test-'));
process.env.ROLLANDS_ADMIN_TOKEN = 'correct-horse-battery-staple';
process.env.ROLLANDS_MAX_REQUEST_BYTES = '65536';
delete process.env.ROLLANDS_DEMO_DATA;

const {server, emptyState, today, dataFile} = require('../server.js');
let base;
let cookie;

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

async function post(url, body, headers = {}) {
  return fetch(base + url, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
}
function authHeaders() { return {Cookie: cookie}; }

test('normal drift startar tomt och använder fullständiga UUID', async () => {
  const draft = emptyState();
  assert.equal(draft.invoices.length, 0);
  assert.equal(draft.journal.length, 0);
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);

  const denied = await fetch(base + '/api/state');
  assert.equal(denied.status, 401);
  const wrong = await post('/api/session', {token: 'fel'});
  assert.equal(wrong.status, 401);
  const login = await post('/api/session', {token: process.env.ROLLANDS_ADMIN_TOKEN});
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];

  const response = await post('/api/supplier-invoices', {
    supplier: 'Säker Leverantör AB', invoiceNumber: 'SEC-1', received: today(), dueDate: today(), net: 100,
    vatRate: 25, account: '4010 Inköp av varor', source: '=HYPERLINK(1)'
  }, authHeaders());
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.match(data.invoice.id, /^sup_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(data.invoice.suggestedAccount, '4010 Inköp av varor');
});

test('förfalskat värdnamn stoppas före webb- och API-hantering', async () => {
  const address = server.address();
  const result = await new Promise((resolve, reject) => {
    const request = http.request({host: '127.0.0.1', port: address.port, path: '/', headers: {Host: 'evil.example'}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(result.status, 421);
  assert.match(JSON.parse(result.body).error, /värdnamnet/i);
});

test('säkerhetsrubriker, hälsokontroll och backup finns', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');

  const health = await fetch(base + '/api/health', {headers: authHeaders()});
  assert.equal(health.status, 200);
  const report = await health.json();
  assert.equal(report.integrity.ok, true);
  assert.equal(report.demoMode, false);
  assert.ok(fs.existsSync(dataFile));
  assert.ok(fs.existsSync(dataFile + '.bak'));
});

test('fel innehållstyp, för stora anrop och sökvägsförsök stoppas', async () => {
  const media = await fetch(base + '/api/settings', {method: 'POST', headers: {...authHeaders(), 'Content-Type': 'text/plain'}, body: '{}'});
  assert.equal(media.status, 415);
  const huge = await fetch(base + '/api/settings', {method: 'POST', headers: {...authHeaders(), 'Content-Type': 'application/json'}, body: JSON.stringify({value: 'x'.repeat(70000)})});
  assert.equal(huge.status, 413);
  const traversal = await fetch(base + '/%2e%2e/server.js');
  assert.ok([403, 404].includes(traversal.status));
  assert.doesNotMatch(await traversal.text(), /createServer/);

  const link = path.join(__dirname, '..', 'public', 'security-link-test');
  try {
    fs.symlinkSync('../server.js', link);
    const symlinkEscape = await fetch(base + '/security-link-test');
    assert.equal(symlinkEscape.status, 404);
    assert.doesNotMatch(await symlinkEscape.text(), /createServer/);
  } finally {
    fs.rmSync(link, {force: true});
  }
});

test('bokföringsexport neutraliserar kalkylbladsformler', async () => {
  const state = await (await fetch(base + '/api/state', {headers: authHeaders()})).json();
  const invoice = state.supplierInvoices.find(item => item.invoiceNumber === 'SEC-1');
  const approval = await post('/api/supplier-invoices/approve', {id: invoice.id, postingDate: today()}, authHeaders());
  const approvalData = await approval.json();
  assert.equal(approval.status, 200, JSON.stringify(approvalData));
  const csv = await (await fetch(base + '/api/export/excel', {headers: authHeaders()})).text();
  assert.ok(csv.includes("'=HYPERLINK(1)"));
});

test('integritetsfel spärrar data men visas i autentiserad hälsokontroll', async () => {
  const original = fs.readFileSync(dataFile, 'utf8');
  try {
    const damaged = JSON.parse(original);
    damaged.journal[0].rows[0].debit += 1;
    fs.writeFileSync(dataFile, JSON.stringify(damaged, null, 2));

    const stateResponse = await fetch(base + '/api/state', {headers: authHeaders()});
    assert.equal(stateResponse.status, 503);
    const stateError = await stateResponse.json();
    assert.match(stateError.error, /spärrat/i);

    const health = await fetch(base + '/api/health', {headers: authHeaders()});
    assert.equal(health.status, 503);
    const report = await health.json();
    assert.equal(report.integrity.ok, false);
    assert.ok(report.integrity.errors.some(error => /balanserar inte/.test(error)));
  } finally {
    fs.writeFileSync(dataFile, original);
  }
});
