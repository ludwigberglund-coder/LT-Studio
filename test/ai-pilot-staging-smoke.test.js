'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const NOW = Date.parse('2026-10-17T12:00:00Z');
const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const REF = 'rwnqkgbbbxjjfhwtepsi';
const URL = `https://${REF}.supabase.co`;
const ID = 'ai-pilot-smoke-33333333-3333-4333-8333-333333333333';
const KEY = 'sb_publishable_synthetic_not_a_real_key';
const TOKEN = patch => ['e30', Buffer.from(JSON.stringify({ iss: `${URL}/auth/v1`, role: 'authenticated',
  sub: USER, session_id: SESSION, aal: 'aal2', exp: NOW / 1000 + 600, ...patch })).toString('base64url'), 'c2ln'].join('.');
const config = patch => ({ AI_PILOT_STAGING_PROJECT_REF: REF, AI_PILOT_STAGING_PUBLISHABLE_KEY: KEY,
  AI_PILOT_STAGING_ACCESS_TOKEN: TOKEN(), AI_PILOT_STAGING_COMPANY_ID: 'tenant-qa-smoke-a', ...patch });
const modulePromise = import('../scripts/ai-pilot-staging-smoke.mjs');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function fixtureReply(request) {
  // Use the existing invoice/provider boundary, not a new bookkeeping engine.
  const { syntheticInvoice, expectedPilotAccount } = await import('../packages/automation/ai-gateway-security.mjs');
  const { suggestSyntheticInvoice } = await import('../packages/automation/cloudflare-bookkeeping.mjs');
  const proposal = await suggestSyntheticInvoice({ invoice: syntheticInvoice(request, { companyId: request.companyId }),
    trustedContext: { verified: true, pilotMode: 'synthetic', companyId: request.companyId, actorId: USER, aal: 'aal2' },
    provider: async () => ({ expenseAccount: expectedPilotAccount(request.scenario), reason: 'SYNTHETIC_PRIVATE_PROSE_NOT_FOR_LOGS', ambiguous: true }) });
  return { status: 'manual-review', sourceId: proposal.sourceId, companyId: proposal.companyId,
    reason: proposal.reason, suggestion: proposal.suggestion, engine: proposal.engine, posted: false, synthetic: true };
}
async function run(options = {}) {
  const { runStagingSmoke } = await modulePromise;
  let calls = 0, captured;
  const report = await runStagingSmoke({ args: ['--run', '--request-id', ID], now: NOW,
    env: config(), release: { server: true, browser: true }, ...options,
    fetchImpl: async (url, init) => {
      calls++; captured = { url, init };
      assert.equal(url, `${URL}/functions/v1/ai-bookkeeping-pilot`);
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['companyId', 'requestId', 'scenario']);
      return options.fetchImpl ? options.fetchImpl(url, init) : json(await fixtureReply(JSON.parse(init.body)));
    } });
  return { report, calls, captured };
}
const sanitized = report => assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PRIVATE|PRIVATE_ERROR|sb_publishable_|Bearer|tenant-qa-smoke-a|11111111|22222222|c2ln/);

test('CLI defaults to offline plan; no arbitrary endpoint, token, prompt, file or model flags', async () => {
  const { parseArguments } = await modulePromise;
  assert.equal(parseArguments([]).mode, 'plan');
  for (const args of [['--token', 'PRIVATE_ERROR'], ['--url', URL], ['--prompt', 'x'], ['--file', 'x'], ['--model', 'x'],
    ['--scenario'], ['--scenario', 'real-invoice'], ['--request-id'], ['--request-id', 'PRIVATE_ERROR'],
    ['--run', '--plan'], ['--run', '--run'], ['--scenario', 'office-paper', '--scenario', 'software-service']]) {
    assert.throws(() => parseArguments(args), { code: 'INVALID_SMOKE_ARGUMENTS' });
  }
});
test('missing, false or duplicated source release flags remain locked', async () => {
  const { checkReleaseSources } = await modulePromise;
  const server = 'const RELEASE_APPROVED = true;', browser = 'const AI_PILOT_RELEASED = true;';
  assert.deepEqual(checkReleaseSources(server, browser), { server: true, browser: true });
  for (const source of ['', undefined, '// ' + server, server.replace('true', 'false'), server + '\n' + server])
    assert.equal(checkReleaseSources(source, browser).server, false);
});
test('current checked-in CLI stays locked even with run requested and enabling environment flags', () => {
  const out = spawnSync(process.execPath, ['scripts/ai-pilot-staging-smoke.mjs', '--run'], {
    cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, RELEASE_APPROVED: 'true', AI_PILOT_RELEASED: 'true', AI_SYNTHETIC_PILOT_ENABLED: 'true' }
  });
  assert.equal(out.status, 1); assert.equal(out.stderr, '');
  const report = JSON.parse(out.stdout);
  assert.equal(report.code, 'AI_PILOT_NOT_RELEASED'); assert.equal(report.liveAttempted, false); sanitized(report);
});
test('plan and either unreleased source read no credentials and contact no server', async () => {
  for (const options of [{ args: [] }, { release: { server: false, browser: true } }, { release: { server: true, browser: false } }]) {
    const f = await run({ ...options, env: new Proxy({}, { get() { throw new Error('PRIVATE_ERROR'); } }) });
    assert.equal(f.calls, 0); assert.equal(f.report.liveAttempted, false); sanitized(f.report);
    assert.notEqual(f.report.code, 'INVALID_SMOKE_CONFIGURATION');
  }
});
test('wrong project is rejected before accessing even a credential value', async () => {
  const reads = [];
  const env = new Proxy({}, { get(_obj, key) { reads.push(key); return 'bwbhnotpuuhgghjpmflk'; } });
  const f = await run({ env });
  assert.deepEqual(reads, ['AI_PILOT_STAGING_PROJECT_REF']);
  assert.equal(f.calls, 0); assert.equal(f.report.code, 'WRONG_STAGING_PROJECT');
});
for (const [name, patch] of [
  ['UAT token', { iss: 'https://bwbhnotpuuhgghjpmflk.supabase.co/auth/v1' }], ['AAL1', { aal: 'aal1' }],
  ['service role', { role: 'service_role' }], ['anonymous user', { is_anonymous: true }],
  ['expired', { exp: NOW / 1000 - 1 }], ['almost expired', { exp: NOW / 1000 + 20 }],
  ['no current session', { session_id: '' }], ['no user', { sub: '' }]
]) test(`obviously unsuitable ${name} is rejected locally without claiming authentication`, async () => {
  const f = await run({ env: config({ AI_PILOT_STAGING_ACCESS_TOKEN: TOKEN(patch) }) });
  assert.equal(f.calls, 0); assert.equal(f.report.code, 'INVALID_STAGING_SESSION'); sanitized(f.report);
});
test('malformed JWT, secret API keys and invalid tenant inputs cannot invoke the gateway', async () => {
  for (const patch of [{ AI_PILOT_STAGING_ACCESS_TOKEN: 'PRIVATE_ERROR' }, { AI_PILOT_STAGING_ACCESS_TOKEN: 'e30.bm90anNvbg.c2ln' },
    { AI_PILOT_STAGING_PUBLISHABLE_KEY: 'sb_secret_PRIVATE_ERROR' }, { AI_PILOT_STAGING_PUBLISHABLE_KEY: TOKEN() },
    { AI_PILOT_STAGING_COMPANY_ID: 'bad company' }]) {
    const f = await run({ env: config(patch) }); assert.equal(f.calls, 0); assert.equal(f.report.ok, false); sanitized(f.report);
  }
});
for (const scenario of ['office-paper', 'software-service', 'cleaning-supplies']) test(`one fixed ${scenario} request verifies the existing review-only contract`, async () => {
  const f = await run({ args: ['--run', '--scenario', scenario, '--request-id', ID] });
  assert.equal(f.calls, 1); assert.equal(f.report.ok, true); assert.equal(f.report.responseVerified, true);
  assert.equal(f.report.releaseAuthorized, false); assert.equal(f.report.requestId, ID); sanitized(f.report);
  assert.equal(f.captured.init.headers.Origin, 'https://ludwigberglund-coder.github.io');
  assert.equal(f.captured.init.headers.Authorization, `Bearer ${TOKEN()}`);
});
test('generated request IDs can be reused without silently choosing a new one', async () => {
  const f = await run({ args: ['--run'] });
  assert.match(f.report.requestId, /^ai-pilot-smoke-[a-f0-9-]{36}$/);
  const again = await run({ args: ['--run', '--request-id', f.report.requestId] });
  assert.equal(again.report.requestId, f.report.requestId); assert.equal(again.calls, 1);
});
test('HTTP 200 is not proof: wrong tenant, invoice, safety markers, model, numbers or keys are rejected', async () => {
  const mutations = [
    r => { r.companyId = 'tenant-qa-other'; }, r => { r.sourceId += '-wrong'; }, r => { r.posted = true; },
    r => { r.synthetic = 'true'; }, r => { r.status = 'posted'; }, r => { r.payment = 'forbidden'; },
    r => { r.suggestion.requiresHumanApproval = false; }, r => { r.suggestion.ambiguous = null; },
    r => { r.suggestion.invoiceDate = '2026-09-16'; }, r => { r.suggestion.expenseAccount = '6540'; },
    r => { r.engine.kind = 'rules'; }, r => { r.engine.version = 'unreviewed-model'; },
    r => { r.suggestion.rows[0].debitOre++; }, r => { r.suggestion.rows[1].debitOre = '25000'; },
    r => { r.suggestion.rows[2].account = '1930'; }, r => { r.suggestion.rows[0].extra = true; },
    r => { r.suggestion.rows.push(r.suggestion.rows[0]); }, r => { r.reason = 'PRIVATE_ERROR\n'; }
  ];
  for (const mutate of mutations) {
    const f = await run({ fetchImpl: async (_url, init) => { const r = await fixtureReply(JSON.parse(init.body)); mutate(r); return json(r); } });
    assert.equal(f.report.code, 'UNSAFE_SMOKE_REPLY'); assert.equal(f.report.ok, false); assert.equal(f.calls, 1); sanitized(f.report);
  }
});
for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'ACCESS_DENIED'], [429, 'BUDGET_NOT_RESERVED'],
  [503, 'AI_PILOT_NOT_RELEASED'], [503, 'AI_BACKEND_NOT_CONFIGURED'], [503, 'PROVIDER_REJECTED']])
  test(`safe ${status}/${code} survives, raw error text never does and no retry occurs`, async () => {
    const f = await run({ fetchImpl: async () => json({ code, error: 'PRIVATE_ERROR Bearer SECRET', private: 'SYNTHETIC_PRIVATE' }, status) });
    assert.equal(f.report.code, code); assert.equal(f.report.ok, false); assert.equal(f.calls, 1); sanitized(f.report);
  });
test('404, unknown statuses, invalid bodies and redirects are failures, not successful AI tests', async () => {
  for (const [response, code] of [
    [new Response('PRIVATE_ERROR', { status: 404 }), 'AI_FUNCTION_NOT_DEPLOYED'],
    [json({ code: 'PRIVATE_ERROR' }, 503), 'UNEXPECTED_HTTP_STATUS'],
    [json({ code: 'PROVIDER_REJECTED' }, 200), 'UNSAFE_SMOKE_REPLY'],
    [json({ code: 'AUTH_REQUIRED' }, 503), 'UNEXPECTED_HTTP_STATUS'],
    [new Response('PRIVATE_ERROR', { headers: { 'content-type': 'text/html' } }), 'INVALID_SMOKE_RESPONSE'],
    [new Response('PRIVATE_ERROR', { headers: { 'content-type': 'application/json' } }), 'INVALID_SMOKE_RESPONSE'],
    [{ status: 200, redirected: true, url: 'https://untrusted.invalid' }, 'INVALID_SMOKE_RESPONSE']
  ]) {
    const f = await run({ fetchImpl: async () => response });
    assert.equal(f.report.code, code); assert.equal(f.report.ok, false); assert.equal(f.calls, 1); sanitized(f.report);
  }
});
test('network exception and deadline do not leak credentials or initiate retries', async () => {
  for (const [fetchImpl, code] of [[async () => { throw new Error('PRIVATE_ERROR Bearer SECRET'); }, 'AI_SMOKE_NETWORK_ERROR'],
    [async () => new Promise(() => {}), 'AI_SMOKE_TIMEOUT']]) {
    const f = await run({ fetchImpl, timeoutMs: 15 });
    assert.equal(f.report.code, code); assert.equal(f.calls, 1); sanitized(f.report);
  }
});
test('actual streamed size, invalid UTF-8 and stalled bodies are bounded, including hanging cancellation', async () => {
  for (const [make, code] of [
    [() => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8193)); c.close(); } }), 'INVALID_SMOKE_RESPONSE'],
    [() => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([255])); c.close(); } }), 'INVALID_SMOKE_RESPONSE'],
    [() => new ReadableStream({ cancel() { return new Promise(() => {}); } }), 'AI_SMOKE_TIMEOUT']
  ]) {
    const f = await run({ timeoutMs: 20, fetchImpl: async () => new Response(make(), { headers: { 'content-type': 'application/json' } }) });
    assert.equal(f.report.code, code); assert.equal(f.calls, 1); sanitized(f.report);
  }
});
