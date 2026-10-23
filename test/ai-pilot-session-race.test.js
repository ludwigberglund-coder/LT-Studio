'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../apps/portal/ai-bookkeeping.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
function session() {
  return { authenticated: true, company: { id: 'tenant-a-001', name: 'SYNTHETIC_COMPANY_A' },
    authUser: { id: 'synthetic-user-a' }, user: { displayName: 'Synthetic operator A' },
    membership: { role: 'accountant' }, accessToken: 'synthetic-session-a' };
}
function fixture({ released = true } = {}) {
  const app = { innerHTML: '' }, events = {}, reply = deferred();
  const initial = session();
  let current = initial, contextHook = null, payload, authCalls = 0, calls = 0;
  const sandbox = {
    document: { getElementById: () => app, addEventListener: (name, fn) => { events[name] = fn; } },
    window: {
      LTSupabaseUat: { context: async () => {
        authCalls++;
        return contextHook ? contextHook(authCalls) : current;
      } },
      LTSupabase: { functions: { invoke: async (name, body, token) => {
        calls++;
        assert.equal(name, 'ai-bookkeeping-pilot');
        assert.equal(token, 'synthetic-session-a');
        assert.deepEqual(Object.keys(body).sort(), ['companyId', 'requestId', 'scenario']);
        payload = body;
        return reply.promise;
      } } }
    },
    location: { search: '', hostname: 'ludwigberglund-coder.github.io', href: '' },
    URLSearchParams, Intl, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' }
  };
  // The committed client remains hard-disabled until a separate staging release.
  // This fixture can simulate that reviewed release path without network.
  const code = released ? source.replace('const AI_PILOT_RELEASED = false;', 'const AI_PILOT_RELEASED = true;') : source;
  if (released) assert.notEqual(code, source);
  vm.runInNewContext(code, sandbox, { filename: 'ai-bookkeeping.js' });
  const click = action => events.click({ target: { closest: () => ({ disabled: false, dataset: { aiAction: action } }) } });
  return {
    app, initial, click, reply,
    setContext: value => { current = value; },
    contextHook: hook => { contextHook = hook; },
    get calls() { return calls; }, get authCalls() { return authCalls; },
    answer(patch = {}) {
      assert.ok(payload);
      return { status: 'manual-review', posted: false, synthetic: true,
        companyId: payload.companyId, sourceId: 'synthetic-' + payload.requestId,
        reason: 'SYNTHETIC_PROVIDER_RESULT',
        suggestion: { expenseAccount: '6110', invoiceDate: '2026-09-15', requiresHumanApproval: true,
          rows: [{ account: '6110', debitOre: 100000, creditOre: 0 },
            { account: '2641', debitOre: 25000, creditOre: 0 },
            { account: '2440', debitOre: 0, creditOre: 125000 }] }, ...patch };
    }
  };
}
async function started() {
  const f = fixture();
  await tick(); f.click('analyze'); await tick();
  assert.equal(f.calls, 1);
  return f;
}
function hidden(f) {
  assert.doesNotMatch(f.app.innerHTML, /AI-FÖRSLAG|SYNTHETIC_PROVIDER_RESULT|SYNTHETIC_COMPANY_A/);
  assert.match(f.app.innerHTML, /ändrades|inloggning|session/i);
}
test('future pilot revalidates context after reply before displaying its synthetic result', async () => {
  const f = await started(); f.reply.resolve(f.answer()); await tick();
  assert.equal(f.authCalls, 3);
  assert.match(f.app.innerHTML, /AI-FÖRSLAG/);
  assert.doesNotMatch(f.app.innerHTML, /synthetic-session-a|synthetic-user-a/);
});
for (const [name, change] of [
  ['company switch', ctx => ({ ...ctx, company: { id: 'tenant-b-002', name: 'Synthetic B' } })],
  ['user switch in same company', ctx => ({ ...ctx, authUser: { id: 'synthetic-user-b' } })],
  ['session replacement', ctx => ({ ...ctx, accessToken: 'synthetic-session-b' })],
  ['logout', ctx => ({ ...ctx, authenticated: false })],
  ['role revoked', ctx => ({ ...ctx, membership: { role: 'readonly' } })],
  ['missing verified user', ctx => ({ ...ctx, authUser: null })]
]) {
  test('late synthetic response is discarded after ' + name, async () => {
    const f = await started(); f.setContext(change(session()));
    f.reply.resolve(f.answer()); await tick(); hidden(f);
    f.click('analyze'); f.click('example'); await tick();
    assert.equal(f.calls, 1); hidden(f);
  });
}
test('in-place context mutation cannot rewrite the request scope snapshot', async () => {
  const f = await started();
  f.initial.company.id = 'tenant-b-002'; f.initial.company.name = 'Synthetic B';
  f.reply.resolve(f.answer()); await tick(); hidden(f);
});
test('failed post-response session verification cannot display a model result', async () => {
  const f = await started();
  f.contextHook(() => { throw new Error('PRIVATE_TEST_ERROR'); });
  f.reply.resolve(f.answer()); await tick(); hidden(f);
  assert.doesNotMatch(f.app.innerHTML, /PRIVATE_TEST_ERROR/);
});
test('company changing while preflight is pending stops before invoking AI', async () => {
  const f = fixture(), pending = deferred(); await tick();
  f.contextHook(() => pending.promise); f.click('analyze'); await tick();
  pending.resolve({ ...session(), company: { id: 'tenant-b-002', name: 'Synthetic B' } });
  await tick(); assert.equal(f.calls, 0); hidden(f);
});
test('late provider failure also revalidates and cannot restore the old company view', async () => {
  const f = await started(); f.setContext({ ...session(), authenticated: false });
  f.reply.reject(Object.assign(new Error('PRIVATE_TEST_ERROR'), { status: 503 }));
  await tick(); hidden(f); assert.doesNotMatch(f.app.innerHTML, /PRIVATE_TEST_ERROR/);
});
test('response without explicit synthetic marker is not trusted', async () => {
  for (const synthetic of [false, undefined, 'true']) {
    const f = await started(); f.reply.resolve(f.answer({ synthetic })); await tick();
    assert.doesNotMatch(f.app.innerHTML, /AI-FÖRSLAG|SYNTHETIC_PROVIDER_RESULT/);
  }
});
test('a fresh token before invocation is usable, but identity must still match the visible page', async () => {
  const f = fixture(); await tick();
  f.initial.accessToken = 'old-synthetic-token';
  f.setContext(session()); f.click('analyze'); await tick();
  assert.equal(f.calls, 1); f.reply.resolve(f.answer()); await tick();
  assert.match(f.app.innerHTML, /AI-FÖRSLAG/);
});
test('hard-disabled production path never invokes a provider or triggers extra auth checks', async () => {
  const f = fixture({ released: false }); await tick(); f.click('analyze'); await tick();
  assert.equal(f.calls, 0); assert.equal(f.authCalls, 1);
  assert.match(source, /const AI_PILOT_RELEASED = false;/);
});
