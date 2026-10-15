'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publicUatConfig, checkPortal, checkSupabaseAuth, retryProbe, runChecks } = require('../scripts/public-uat-monitor.js');

const settings = Object.freeze({
  portalUrl: 'https://example.org/portal/index.html',
  supabaseBaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_test'
});

test('UAT config only accepts HTTPS Supabase and a public key', () => {
  const base = "  url: 'https://project.supabase.co',\n  publishableKey: 'sb_publishable_test',\n  environment: 'uat',";
  const config = publicUatConfig(base);
  assert.equal(config.supabaseBaseUrl, 'https://project.supabase.co');
  assert.equal(config.publishableKey, 'sb_publishable_test');
  assert.throws(() => publicUatConfig(base.replace('https:', 'http:')), /PUBLIC_UAT_CONFIG_INVALID/);
  assert.throws(() => publicUatConfig(base.replace('sb_publishable_test', 'a-private-secret')), /PUBLIC_UAT_CONFIG_INVALID/);
  assert.throws(() => publicUatConfig(base.replace("'uat'", "'staging'")), /PUBLIC_UAT_CONFIG_INVALID/);
});

test('portal rejects unrelated HTTP 200 page', async () => {
  const report = await checkPortal({
    portalUrl: settings.portalUrl,
    fetchImpl: async () => ({ status: 200, text: async () => '<html>Other site</html>' })
  });
  assert.deepEqual(report, { name: 'github-pages-portal', ok: false, code: 'unexpected-page' });
});

test('portal checks correct page with redirects disabled', async () => {
  const report = await checkPortal({
    portalUrl: settings.portalUrl,
    fetchImpl: async (url, options) => {
      assert.equal(url, settings.portalUrl);
      assert.equal(options.redirect, 'error');
      return { status: 200, text: async () => '<title>LT Studio</title> supabase-config.js' };
    }
  });
  assert.equal(report.ok, true);
});

test('Supabase Auth sends only the public key and validates GoTrue', async () => {
  const report = await checkSupabaseAuth({
    ...settings,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://project.supabase.co/auth/v1/health');
      assert.equal(options.headers.apikey, 'sb_publishable_test');
      assert.equal(options.redirect, 'error');
      return { status: 200, json: async () => ({ name: 'GoTrue', version: 'test' }) };
    }
  });
  assert.equal(report.ok, true);
});

test('Supabase Auth rejects unrelated JSON, even for HTTP 200', async () => {
  const report = await checkSupabaseAuth({
    ...settings,
    fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true }) })
  });
  assert.equal(report.code, 'unexpected-health-response');
});

test('transient failures are retried', async () => {
  let calls = 0;
  const report = await retryProbe(async () => {
    calls++;
    if (calls === 1) throw new Error('do-not-log-secret');
    return { name: 'test', ok: true, code: 'ok' };
  }, 'test', { delay: async () => {} });
  assert.equal(calls, 2);
  assert.equal(report.ok, true);
});

test('persistent transport errors never leak error messages', async () => {
  const report = await retryProbe(async () => { throw new Error('do-not-log-secret'); }, 'test', { delay: async () => {} });
  assert.deepEqual(report, { name: 'test', ok: false, code: 'network-error' });
  assert.doesNotMatch(JSON.stringify(report), /do-not-log-secret/);
});

test('a healthy static page cannot hide broken Supabase Auth', async () => {
  const report = await runChecks({
    config: settings, delay: async () => {},
    fetchImpl: async (url) => url.includes('auth/v1/health')
      ? { status: 503 }
      : { status: 200, text: async () => '<title>LT Studio</title> supabase-config.js' }
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks[0].ok, true);
  assert.equal(report.checks[1].ok, false);
});

test('manual alert drill forces failure without faking a service outage', async () => {
  const report = await runChecks({
    config: settings, delay: async () => {}, simulateFailure: true,
    fetchImpl: async (url) => url.includes('auth/v1/health')
      ? { status: 200, json: async () => ({ name: 'GoTrue' }) }
      : { status: 200, text: async () => '<title>LT Studio</title> supabase-config.js' }
  });
  assert.equal(report.ok, false);
  assert.equal(report.simulatedAlert, true);
  assert.equal(report.checks.every(check => check.ok), true);
});
