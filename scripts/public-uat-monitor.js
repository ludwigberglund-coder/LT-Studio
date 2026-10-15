'use strict';

// GitHub-hosted read-only checks, independent of the LT Studio runtime.
const fs = require('node:fs');
const path = require('node:path');

const PORTAL_URL = 'https://ludwigberglund-coder.github.io/LT-Studio/portal/index.html';
const CONFIG_PATH = path.resolve(__dirname, '../apps/portal/supabase-config.js');

function publicUatConfig(source = fs.readFileSync(CONFIG_PATH, 'utf8')) {
  const url = String(source).match(/^\s*url:\s*['"]([^'"]+)['"]\s*,?\s*$/m)?.[1];
  const key = String(source).match(/^\s*publishableKey:\s*['"]([^'"]+)['"]\s*,?\s*$/m)?.[1];
  const environment = String(source).match(/^\s*environment:\s*['"]([^'"]+)['"]\s*,?\s*$/m)?.[1];
  if (!url || !key || environment !== 'uat' || !key.startsWith('sb_publishable_')) {
    throw new Error('PUBLIC_UAT_CONFIG_INVALID');
  }
  let base;
  try { base = new URL(url); } catch { throw new Error('PUBLIC_UAT_CONFIG_INVALID'); }
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') ||
      base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    throw new Error('PUBLIC_UAT_CONFIG_INVALID');
  }
  return Object.freeze({ supabaseBaseUrl: base.origin, publishableKey: key, portalUrl: PORTAL_URL });
}

function result(name, ok, code = ok ? 'ok' : 'unavailable') {
  return Object.freeze({ name, ok, code });
}

async function checkPortal({ fetchImpl, portalUrl }) {
  const response = await fetchImpl(portalUrl, {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10000)
  });
  if (response.status !== 200) return result('github-pages-portal', false, 'http-status');
  const body = await response.text();
  if (!body.includes('LT Studio') || !body.includes('supabase-config.js')) {
    return result('github-pages-portal', false, 'unexpected-page');
  }
  return result('github-pages-portal', true);
}

async function checkSupabaseAuth({ fetchImpl, supabaseBaseUrl, publishableKey }) {
  const response = await fetchImpl(supabaseBaseUrl + '/auth/v1/health', {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: { accept: 'application/json', apikey: publishableKey },
    signal: AbortSignal.timeout(10000)
  });
  if (response.status !== 200) return result('supabase-uat-auth', false, 'http-status');
  let body;
  try { body = await response.json(); } catch { return result('supabase-uat-auth', false, 'invalid-json'); }
  if (!body || body.name !== 'GoTrue') {
    return result('supabase-uat-auth', false, 'unexpected-health-response');
  }
  return result('supabase-uat-auth', true);
}

async function retryProbe(probe, name, { delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let last = result(name, false);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await probe();
      if (last.ok) return last;
    } catch {
      // Never print request headers, credentials, URL bodies, or raw response text.
      last = result(name, false, 'network-error');
    }
    if (attempt === 0) await delay(1500);
  }
  return last;
}

async function runChecks({ fetchImpl = globalThis.fetch, config = publicUatConfig(), delay, simulateFailure = false } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_NOT_AVAILABLE');
  const checks = await Promise.all([
    retryProbe(() => checkPortal({ fetchImpl, portalUrl: config.portalUrl }), 'github-pages-portal', { delay }),
    retryProbe(() => checkSupabaseAuth({
      fetchImpl, supabaseBaseUrl: config.supabaseBaseUrl, publishableKey: config.publishableKey
    }), 'supabase-uat-auth', { delay })
  ]);
  return Object.freeze({
    ok: checks.every(check => check.ok) && !simulateFailure,
    checks,
    simulatedAlert: Boolean(simulateFailure)
  });
}

async function main() {
  const report = await runChecks({ simulateFailure: process.env.LT_MONITOR_SIMULATE_FAILURE === '1' });
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(['FETCH_NOT_AVAILABLE', 'PUBLIC_UAT_CONFIG_INVALID'].includes(error?.message)
      ? error.message : 'PUBLIC_UAT_MONITOR_FAILED');
    process.exitCode = 1;
  });
}
module.exports = Object.freeze({
  PORTAL_URL, publicUatConfig, checkPortal, checkSupabaseAuth, retryProbe, runChecks
});
