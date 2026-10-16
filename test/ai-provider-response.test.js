'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const enc = new TextEncoder();
const load = () => import('../packages/automation/ai-provider-response.mjs');
const code = expected => error => error?.code === expected;
function streamed(chunks, headers = {}, status = 200) {
  const stats = { pulls: 0, cancelled: 0 };
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      stats.pulls++;
      if (offset === chunks.length) controller.close();
      else controller.enqueue(chunks[offset++]);
    },
    cancel() { stats.cancelled++; }
  }, { highWaterMark: 0 });
  return { stats, response: new Response(body, {
    status, headers: { 'content-type': 'application/json', ...headers }
  }) };
}
async function read(response, maxBytes, signal = new AbortController().signal) {
  return (await load()).readBoundedResponseText(response, { maxBytes, signal });
}
async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('test deadline exceeded')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

test('bounded reader accepts exact byte boundary and split UTF-8 characters', async () => {
  const expected = '{"text":"åäö"}';
  const bytes = enc.encode(expected);
  const chunks = Array.from(bytes, value => Uint8Array.of(value));
  const { response, stats } = streamed(chunks);
  assert.equal(await read(response, bytes.length), expected);
  assert.equal(stats.cancelled, 0);
  assert.equal(response.body.locked, false);
});

test('reader enforces actual bytes without trusting absent or understated content-length', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const { response, stats } = streamed([
      enc.encode('1234'), enc.encode('5'), enc.encode('not read')
    ], headers);
    await assert.rejects(() => read(response, 4), code('MODEL_INVALID_RESPONSE'));
    assert.equal(stats.pulls, 2);
    assert.equal(stats.cancelled, 1);
    assert.equal(response.body.locked, false);
  }
});

test('UTF-8 byte count, not JavaScript character count, controls the bound', async () => {
  const { response, stats } = streamed([enc.encode('åä')]);
  assert.equal('åä'.length, 2);
  await assert.rejects(() => read(response, 3), code('MODEL_INVALID_RESPONSE'));
  assert.equal(stats.cancelled, 1);
});

test('invalid or oversized declared length is rejected before reading the body', async () => {
  for (const length of ['5', '-1', '2.5', 'Infinity', '99999999999999999999']) {
    const { response, stats } = streamed([enc.encode('ok')], { 'content-length': length });
    await assert.rejects(() => read(response, 4), code('MODEL_INVALID_RESPONSE'));
    assert.equal(stats.pulls, 0);
    assert.equal(stats.cancelled, 1);
  }
});

test('malformed or incomplete UTF-8 is not silently repaired', async () => {
  for (const bytes of [Uint8Array.of(0xff), Uint8Array.of(0xc3)]) {
    const { response } = streamed([bytes]);
    await assert.rejects(() => read(response, 8), code('MODEL_INVALID_RESPONSE'));
    assert.equal(response.body.locked, false);
  }
});

test('missing stream never falls back to unbounded text or JSON reads', async () => {
  let unbounded = 0;
  const response = { text: () => { unbounded++; return 'private body'; } };
  await assert.rejects(() => read(response, 8), code('MODEL_INVALID_RESPONSE'));
  assert.equal(unbounded, 0);
});

test('zero-byte and non-byte chunks fail closed instead of allowing no-progress loops', async () => {
  for (const chunk of [new Uint8Array(0), 'not bytes']) {
    const { response, stats } = streamed([chunk, enc.encode('unread')]);
    await assert.rejects(() => read(response, 8), code('MODEL_INVALID_RESPONSE'));
    assert.equal(stats.pulls, 1);
    assert.equal(stats.cancelled, 1);
  }
});

test('aborted request never starts reading and cancels the unused body', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private abort details'));
  const { response, stats } = streamed([enc.encode('unread')]);
  await assert.rejects(() => read(response, 8, controller.signal), error =>
    error.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('private'));
  assert.equal(stats.pulls, 0);
  assert.equal(stats.cancelled, 1);
});

test('abort ends a stalled read even when reader and cancellation never resolve', async () => {
  const controller = new AbortController();
  const stats = { cancelled: 0, released: 0 };
  const reader = {
    read() {
      queueMicrotask(() => controller.abort());
      return new Promise(() => {});
    },
    cancel() { stats.cancelled++; return new Promise(() => {}); },
    releaseLock() { stats.released++; }
  };
  const response = { body: { getReader: () => reader } };
  await deadline(assert.rejects(() => read(response, 8, controller.signal),
    code('PROVIDER_UNAVAILABLE')));
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.released, 1);
});

test('reader and cleanup exceptions never leak vendor details', async () => {
  const reader = {
    read() { return Promise.reject(new Error('private vendor credentials')); },
    cancel() { return Promise.reject(new Error('private cancellation')); },
    releaseLock() { throw new Error('private lock'); }
  };
  await assert.rejects(() => read({ body: { getReader: () => reader } }, 8), error =>
    error.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('private'));
});

test('invalid bounds fail closed before reading', async () => {
  for (const limit of [0, -1, 1.5, 65537, Infinity]) {
    const { response, stats } = streamed([enc.encode('ok')]);
    await assert.rejects(() => read(response, limit), code('MODEL_INVALID_RESPONSE'));
    assert.equal(stats.pulls, 0);
  }
});

const ACCOUNT = 'a'.repeat(32);
const TOKEN = 'synthetic-fake-token-not-a-real-secret';
async function invokeInvoice(fetchImpl) {
  const { cloudflareProvider, validateSyntheticInvoice } =
    await import('../packages/automation/cloudflare-bookkeeping.mjs');
  const source = {
    synthetic: true, companyId: 'tenant-a-001', sourceId: 'invoice-a-001',
    documentType: 'supplier-invoice', supplierName: 'Testkontor AB',
    description: 'Kontorspapper A4', invoiceDate: '2026-09-15',
    currency: 'SEK', sellerCountry: 'SE', vatRateBps: 2500,
    netOre: 100000, vatOre: 25000, grossOre: 125000
  };
  const trusted = { verified: true, pilotMode: 'synthetic',
    companyId: 'tenant-a-001', actorId: 'person-a-001', aal: 'aal2' };
  return cloudflareProvider({ enabled: true, accountId: ACCOUNT, apiToken: TOKEN,
    timeoutMs: 1000, fetchImpl })(validateSyntheticInvoice(source, trusted));
}
async function invokeFinance(fetchImpl) {
  const { createFinanceCloudflareProvider } =
    await import('../packages/automation/ai-finance-cloudflare.mjs');
  const { runSyntheticFinanceProcess } =
    await import('../packages/automation/ai-finance-process-orchestrator.mjs');
  const user = '11111111-1111-4111-8111-111111111111';
  const session = '22222222-2222-4222-8222-222222222222';
  const companyId = 'tenant-a-001';
  const accessToken = ['e30', Buffer.from(JSON.stringify({ sub: user,
    session_id: session, aal: 'aal2' })).toString('base64url'), 'c2ln'].join('.');
  const chain = { select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ error: null, data: {
      company_id: companyId, auth_user_id: user, role: 'accountant'
    } }) };
  return runSyntheticFinanceProcess({
    body: { companyId, purpose: 'vat-review', requestId: 'finance-pilot-0000001' },
    accessToken, userClient: { auth: {
      getUser: async () => ({ error: null, data: { user: { id: user } } })
    }, from: () => chain }, enabled: true, privacyApproved: true,
    reserveBudget: async () => ({ persisted: true, companyAllowed: true,
      globalAllowed: true, idempotent: true, reservationId: 'reserved-finance-00001' }),
    provider: createFinanceCloudflareProvider({ enabled: true, accountId: ACCOUNT,
      apiToken: TOKEN, timeoutMs: 1000, fetchImpl })
  });
}
for (const [name, invoke, limit] of [
  ['invoice', invokeInvoice, 32768], ['finance', invokeFinance, 8192]
]) {
  test(name + ' provider stops streaming at byte limit with no retry', async () => {
    let calls = 0;
    const { response, stats } = streamed([
      enc.encode('x'.repeat(limit)), enc.encode('x'), enc.encode('never read')
    ]);
    await assert.rejects(() => invoke(async () => { calls++; return response; }),
      code('MODEL_INVALID_RESPONSE'));
    assert.equal(calls, 1);
    assert.equal(stats.pulls, 2);
    assert.equal(stats.cancelled, 1);
  });
  test(name + ' provider cancels rejected HTTP response without reading vendor data', async () => {
    let calls = 0;
    const { response, stats } = streamed([enc.encode(TOKEN)], {}, 429);
    await assert.rejects(() => invoke(async () => { calls++; return response; }), error =>
      error.code === 'PROVIDER_REJECTED' && !error.message.includes(TOKEN));
    assert.equal(calls, 1);
    assert.equal(stats.pulls, 0);
    assert.equal(stats.cancelled, 1);
  });
  test(name + ' provider deadline still applies after response headers arrive', async () => {
    let calls = 0;
    let cancelled = 0;
    let signal;
    const response = new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
      cancel() { cancelled++; }
    }, { highWaterMark: 0 }), { headers: { 'content-type': 'application/json' } });
    await deadline(assert.rejects(() => invoke(async (_url, options) => {
      calls++;
      signal = options.signal;
      return response;
    }), code('PROVIDER_UNAVAILABLE')));
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
  });
}
