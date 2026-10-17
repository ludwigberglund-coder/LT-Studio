// Operator-only connection test. Not bundled into Pages; no credentials in CLI args.
// This client never unlocks the server, deploys, changes quotas or writes accounts.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SUPPORTED_SCENARIOS, validateRequest, expectedPilotAccount, syntheticInvoice } from '../packages/automation/ai-gateway-security.mjs';
import { MODEL } from '../packages/automation/cloudflare-bookkeeping.mjs';
import { readBoundedResponseText, cancelQuietly } from '../packages/automation/ai-provider-response.mjs';

export const STAGING_REF = 'rwnqkgbbbxjjfhwtepsi';
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const ENDPOINT = `${STAGING_URL}/functions/v1/ai-bookkeeping-pilot`;
const ORIGIN = 'https://ludwigberglund-coder.github.io';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^ai-pilot-smoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = code => Object.assign(new Error(code), { code });
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length &&
  Object.keys(value).every(key => keys.includes(key));
const clean = (value, min, max) => typeof value === 'string' && value.trim() === value &&
  value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export function checkReleaseSources(server, browser) {
  // This is a conservative operator check, NOT evidence of review or a deployed
  // release. The remote server must still independently authorize every request.
  const flag = (source, name) => {
    if (typeof source !== 'string') return false;
    const lines = source.split(/\r?\n/).filter(line => new RegExp(`^\\s*const ${name} = (?:true|false);\\s*$`).test(line));
    return lines.length === 1 && lines[0].trim() === `const ${name} = true;`;
  };
  return Object.freeze({ server: flag(server, 'RELEASE_APPROVED'), browser: flag(browser, 'AI_PILOT_RELEASED') });
}
function releaseFromRepository() {
  try {
    return checkReleaseSources(
      readFileSync(new URL('../supabase/functions/ai-bookkeeping-pilot/index.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../apps/portal/ai-bookkeeping.js', import.meta.url), 'utf8'));
  } catch { return Object.freeze({ server: false, browser: false }); }
}
export function parseArguments(args) {
  let mode = 'plan', scenario = 'office-paper', requestId;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw fail('INVALID_SMOKE_ARGUMENTS');
    seen.add(key);
    if (key === '--plan' || key === '--run') {
      if (seen.has(key === '--run' ? '--plan' : '--run')) throw fail('INVALID_SMOKE_ARGUMENTS');
      mode = key.slice(2);
    } else if (key === '--scenario') scenario = args[++i];
    else if (key === '--request-id') requestId = args[++i];
    else throw fail('INVALID_SMOKE_ARGUMENTS');
  }
  if (!SUPPORTED_SCENARIOS.includes(scenario) || (seen.has('--request-id') && !REQUEST_ID.test(requestId || ''))) {
    throw fail('INVALID_SMOKE_ARGUMENTS');
  }
  return Object.freeze({ mode, scenario, requestId });
}
function configuration(env, now) {
  // Do not even read credentials until the exact staging ref is confirmed.
  if (env.AI_PILOT_STAGING_PROJECT_REF !== STAGING_REF) throw fail('WRONG_STAGING_PROJECT');
  const key = env.AI_PILOT_STAGING_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,160}$/.test(key)) throw fail('INVALID_PUBLIC_KEY');
  const token = env.AI_PILOT_STAGING_ACCESS_TOKEN;
  if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw fail('INVALID_STAGING_SESSION');
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw fail('INVALID_STAGING_SESSION'); }
  // Unverified JWT decoding only rejects obvious mistakes. It never grants
  // access: the gateway performs getUser + current-session + MFA + RLS checks.
  if (claims?.iss !== `${STAGING_URL}/auth/v1` || claims.role !== 'authenticated' ||
      claims.aal !== 'aal2' || !UUID.test(claims.sub || '') || !UUID.test(claims.session_id || '') ||
      !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now + 30000 ||
      claims.is_anonymous === true) throw fail('INVALID_STAGING_SESSION');
  return Object.freeze({ key, token, companyId: env.AI_PILOT_STAGING_COMPANY_ID });
}
export function verifySyntheticReply(value, request) {
  const input = validateRequest(request);
  const source = syntheticInvoice(input, { companyId: input.companyId });
  const account = expectedPilotAccount(input.scenario);
  if (!exact(value, ['status', 'sourceId', 'companyId', 'reason', 'suggestion', 'engine', 'posted', 'synthetic']) ||
      value.status !== 'manual-review' || value.posted !== false || value.synthetic !== true ||
      value.companyId !== input.companyId || value.sourceId !== source.sourceId || !clean(value.reason, 12, 400) ||
      !exact(value.engine, ['kind', 'name', 'version']) || value.engine.kind !== 'ai' ||
      value.engine.name !== 'cloudflare-workers-ai' || value.engine.version !== MODEL) throw fail('UNSAFE_SMOKE_REPLY');
  const suggestion = value.suggestion;
  if (!exact(suggestion, ['expenseAccount', 'invoiceDate', 'rows', 'requiresHumanApproval', 'ambiguous']) ||
      suggestion.expenseAccount !== account || suggestion.invoiceDate !== source.invoiceDate ||
      suggestion.requiresHumanApproval !== true || typeof suggestion.ambiguous !== 'boolean' ||
      !Array.isArray(suggestion.rows) || suggestion.rows.length !== 3) throw fail('UNSAFE_SMOKE_REPLY');
  const expected = [[account, source.netOre, 0], ['2641', source.vatOre, 0], ['2440', 0, source.grossOre]];
  for (let i = 0; i < expected.length; i++) {
    const row = suggestion.rows[i], [expectedAccount, debit, credit] = expected[i];
    if (!exact(row, ['account', 'debitOre', 'creditOre']) || row.account !== expectedAccount ||
        !Number.isSafeInteger(row.debitOre) || !Number.isSafeInteger(row.creditOre) ||
        row.debitOre !== debit || row.creditOre !== credit) throw fail('UNSAFE_SMOKE_REPLY');
  }
  // Return no provider prose, company/user identity, headers, token or raw body.
  return true;
}
const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401, ACCESS_DENIED: 403, TENANT_MISMATCH: 403,
  INVALID_INPUT: 422, INVALID_COMPANY: 422, UNSUPPORTED_SCENARIO: 422, INVALID_REQUEST_ID: 422,
  BUDGET_NOT_RESERVED: 429, AI_RATE_LIMITED: 429, BUDGET_NOT_CONFIGURED: 503,
  AI_PILOT_NOT_RELEASED: 503, AI_PILOT_DISABLED: 503, AI_BACKEND_NOT_CONFIGURED: 503,
  PROVIDER_REJECTED: 503, PROVIDER_UNAVAILABLE: 503, MODEL_INVALID_RESPONSE: 503,
  UNSAFE_AI_PROPOSAL: 503, AI_PILOT_ERROR: 503
});
const LOCAL_CODES = new Set(['INVALID_SMOKE_ARGUMENTS', 'WRONG_STAGING_PROJECT', 'INVALID_PUBLIC_KEY',
  'INVALID_STAGING_SESSION', 'UNSAFE_SMOKE_REPLY', 'INVALID_SMOKE_RESPONSE', 'AI_SMOKE_TIMEOUT',
  'AI_SMOKE_NETWORK_ERROR', 'AI_FUNCTION_NOT_DEPLOYED', 'UNEXPECTED_HTTP_STATUS', 'AI_PILOT_NOT_RELEASED']);

export async function runStagingSmoke({ args = [], env = process.env, fetchImpl = globalThis.fetch,
  release = releaseFromRepository(), now = Date.now(), timeoutMs = 15000 } = {}) {
  const report = { schemaVersion: 1, projectRef: STAGING_REF, mode: 'plan', liveAttempted: false,
    responseVerified: false, releaseAuthorized: false, ok: false, code: 'INVALID_SMOKE_ARGUMENTS' };
  let response, timer, controller;
  try {
    const options = parseArguments(args);
    report.mode = options.mode; report.scenario = options.scenario;
    if (release?.server !== true || release?.browser !== true) throw fail('AI_PILOT_NOT_RELEASED');
    if (options.mode === 'plan') { report.code = 'OPERATOR_APPROVAL_STILL_REQUIRED'; return report; }
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw fail('INVALID_SMOKE_ARGUMENTS');
    const config = configuration(env, now);
    const request = Object.freeze(validateRequest({ companyId: config.companyId, scenario: options.scenario,
      requestId: options.requestId || `ai-pilot-smoke-${randomUUID()}` }));
    report.requestId = request.requestId;
    controller = new AbortController();
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(fail('AI_SMOKE_TIMEOUT'));
    }, timeoutMs); });
    report.liveAttempted = true;
    try {
      response = await Promise.race([fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { apikey: config.key, Authorization: `Bearer ${config.token}`,
          Origin: ORIGIN, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request)
      }), deadline]);
    } catch { throw fail(controller.signal.aborted ? 'AI_SMOKE_TIMEOUT' : 'AI_SMOKE_NETWORK_ERROR'); }
    if (response?.redirected || (response?.url && response.url !== ENDPOINT)) throw fail('INVALID_SMOKE_RESPONSE');
    if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) throw fail('INVALID_SMOKE_RESPONSE');
    report.httpStatus = response.status;
    if (response.status === 404) throw fail('AI_FUNCTION_NOT_DEPLOYED');
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers?.get('content-type') || '')) throw fail('INVALID_SMOKE_RESPONSE');
    let body;
    try {
      const raw = await Promise.race([readBoundedResponseText(response, { maxBytes: 8192, signal: controller.signal }), deadline]);
      body = JSON.parse(raw);
    } catch { throw fail(controller.signal.aborted ? 'AI_SMOKE_TIMEOUT' : 'INVALID_SMOKE_RESPONSE'); }
    if (response.status !== 200) {
      if (typeof body?.code === 'string' && Object.hasOwn(ERROR_STATUS, body.code) && ERROR_STATUS[body.code] === response.status) {
        report.code = body.code; return report;
      }
      throw fail('UNEXPECTED_HTTP_STATUS');
    }
    verifySyntheticReply(body, request);
    report.responseVerified = true; report.ok = true; report.code = 'SYNTHETIC_REPLY_VERIFIED';
    return report;
  } catch (error) {
    report.code = LOCAL_CODES.has(error?.code) ? error.code : 'INVALID_SMOKE_CONFIGURATION';
    return report;
  } finally {
    clearTimeout(timer); controller?.abort(); cancelQuietly(response?.body);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runStagingSmoke({ args: process.argv.slice(2) });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.ok ? 0 : 1;
}
