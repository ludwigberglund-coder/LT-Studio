# AI pilot: bounded provider responses (2026-10-16)

## Scope

Continues #797 after merged PR #821. Baseline main:
`b2c2e4dbd6ece9a3073752ddb44498ec1173eea2`.
Only the server-side Cloudflare adapters, a shared response reader and synthetic
regression tests change. Bank PR #802 is not touched.

Both adapters already used `AbortSignal.timeout(timeoutMs)`. The defect addressed
here is calling `response.text()` before enforcing a character-count limit. This
can buffer an oversized response and does not count the actual UTF-8 bytes.
This is not a new model, a release approval or an automatic accounting engine.

## Implementation

- Read native response streams incrementally, enforcing 32,768 bytes for invoice
  suggestions and 8,192 bytes for finance-process advice before decoding/buffering.
- Reuse the same abort signal used by fetch throughout body consumption. A stalled
  read must reject on abort even if an injected reader ignores cancellation.
- Cancel rejected or oversized response bodies; do not wait indefinitely for
  cancellation. Release reader locks where possible.
- Fail closed on missing streams, malformed UTF-8, invalid declared lengths and
  zero-byte/non-byte chunks. Never fall back to unbounded `text()` or `json()`.
- Treat Content-Length only as an early rejection signal. An absent or understated
  header never bypasses counting actual received bytes.
- Preserve the existing independent JSON/schema/account/amount validators and
  synthetic-only source checks. No retries, fallback provider, additional network
  calls, credentials logging, database changes or financial writes are added.

The zero-byte-chunk rejection deliberately fails closed on a no-progress stream;
it does not reject the normal end-of-stream marker.

## Verification

`test/ai-provider-response.test.js` exercises native Response/ReadableStream objects,
exact bounds, split Swedish UTF-8, byte-vs-character limits, false/missing length
headers, invalid/truncated encodings, missing bodies, no-progress streams, aborted
and stalled readers, non-resolving/rejected cleanup, safe errors and both actual
provider adapters. Existing synthetic invoice and finance integration tests remain
unchanged and still check validated structured proposals and manual-review status.

Run in GitHub Actions before merge:

```sh
node --test test/ai-provider-response.test.js test/ai-cloudflare-bookkeeping.test.js test/ai-finance-cloudflare.test.js
npm test
```

Full Quality/security, CodeQL and Supabase clean rebuild remain required.
Test results and exact commit SHA belong in the linked PR after the runs finish.
This document does not claim a run succeeded before its result is verified.

## Environment observations and release blockers

Read-only inspection on 2026-10-16 found the AI pilot absent from deployed Edge
Functions in staging (`rwnqkgbbbxjjfhwtepsi`) and LT Studio
(`bwbhnotpuuhgghjpmflk`). Staging runtime was disabled; configured quotas were
30 global / 10 per company / 5 per user per day, and 10 requests per 300-second IP
window. These observations are not a proof of live end-to-end enforcement.

No gates or runtime settings are changed by this patch. In particular, keep
`RELEASE_APPROVED`, `DURABLE_IP_LIMITER_VERIFIED` and `AI_PILOT_RELEASED` false.
Before deployment/activation, the separate release needs:

1. Proof that the chosen client-IP value cannot be supplied/spoofed by the caller
   through the actual edge/proxy chain, with durable shared quota enforcement.
2. End-to-end MFA/session revocation, two-company isolation, parallel/idempotent
   request and daily quota tests in the isolated synthetic environment.
3. Confirmation of provider secrets/configuration through approved secret handling,
   without exposing secret values in GitHub or logs.
4. An authorized release decision and a real synthetic Cloudflare call, with its
   independently validated result and minimal audit evidence recorded in GitHub.

No actual Cloudflare model call has been made as part of this transport patch.
Mocks are not evidence of live model quality. No real customer data may be sent
without approved data processing. Automatic saving, approval and posting remain
disabled; future work must reuse the existing protected accounting RPCs.
