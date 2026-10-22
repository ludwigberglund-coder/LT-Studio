# Supplier workspace - Issue #849 / PR #850

## Scope of this delivery

Continue the existing `payables.html` and `supplier-ledger.html` pages. No new financial data model, bank adapter, RPC, migration, permission, AI release or mailbox connection is introduced.

The invoice queue now offers four task groups: **Att godkänna**, **Att betala**, **Behöver hjälp**, and **Historik**. Search intersects the chosen group. Counts explicitly describe only the loaded snapshot, not all invoices in the company or the mailbox. Existing filters, original-PDF controls and accounting actions remain available. A native invoice button supports keyboard opening and mobile rows show field labels. The shared design-system stylesheet remains last.

`Att betala` is intentionally not called `Planerade betalningar`: a posted and approved invoice can still lack any payment plan. `Godkänn faktura` invokes the existing attestation action, never a payment operation.

## Mapping current data without inventing bank evidence

| Persisted invoice status | Display group | Meaning |
| --- | --- | --- |
| registered / coding-review | Behöver hjälp | Invoice/accounting preparation needs review |
| coded | Att godkänna | Saved coding exists; all existing approval checks still apply |
| approved, no posted liability | Behöver hjälp | Approval is recorded; bookkeeping/batch approval is still needed |
| approved + posted liability reference/flag | Att betala | Eligible to continue to existing payment preparation, not sent |
| payment-prepared | Att betala | Preparation recorded, not independent bank confirmation |
| paid | Historik | Payment registered in LT Studio, not independently bank-verified |
| cancelled | Historik | Invoice cancelled |
| rejected / unknown / malformed | Behöver hjälp | Never silently hidden or treated as complete |

The display adapter never derives `bankSettlementVerified` or `reconciled` from a legacy `paid` flag, typed bank reference, journal ID or invoice approval. The separate future evidence helper gives failures, returns and unknown results precedence over stale success. Its booleans are a display contract, NOT a server security boundary or a claim that bank integration exists.

## Selected-invoice continuity

The planning link carries the exact invoice ID and current company ID to the existing ledger page. The target is resolved only against the already authenticated, tenant-filtered invoice list. Wrong company, missing/malformed invoice or an unposted invoice yields no selected invoice and a neutral explanation; it never silently opens a different invoice. Navigation does not prepare, authorize, send or confirm payment.

Changing groups removes an out-of-group selected invoice from the action panel. Supabase drafts use the existing company/user/version-scoped in-memory draft store; legacy/demo unsaved edits block group switching until saved. Existing session rechecks and async sequence protections are retained. A genuine zero remaining balance no longer falls back to the original amount through a truthiness check.

## Verification performed for this change

- Exact GitHub source blobs used for temporary authoring; GitHub remains the source of truth.
- `node --check` for changed JavaScript.
- `node --test test/supplier-journey.test.js test/supplier-payment-journey-ui.test.js`: **27 passed, 0 failed**, using Node 22.16.0 in the disposable test environment. Repository CI uses the required Node >=24 and must independently pass.
- Runtime tests execute the actual portal script with synthetic tenant-scoped transport, count all attempted writes and reject them. They cover grouping/search, selected deep links, wrong company/unknown/unposted links, retained drafts, company switches, mixed-tenant responses, escaped text, zero remaining balance and missing helper. These tests do not prove hosted RLS/MFA.
- Isolated Chromium component smoke using the actual queue/helper/UI code with synthetic location/session/transport: 320, 375 and 1280px, light and dark; working group buttons and keyboard opening, no component horizontal overflow, >=44px targets, zero write attempts, five read calls, zero page errors. This preview uses a minimal base stylesheet, NOT the complete published portal/theme bundle and NOT authenticated hosted UAT.
- Existing full `test/payables-browser.test.cjs` updated for the new labels and selected-invoice link, while retaining PDF, unbalanced/unsaved approval guards, missing bank-recipient block, role transitions and ledger assertions. It also checks four task groups, keyboard invoice opening and no payment created by navigation. This backend/browser test was NOT run in the disposable environment; it must pass in the normal CI browser matrix.
- Replaced the two original `.test.cjs` helper tests (which `npm test` did not discover) with `.test.js` tests covered by the existing `node --test test/*.test.js` command. No CI permission/workflow changes.

## Remaining gates and follow-up

PR #850 is not a completed end-to-end banking or autonomous accounting implementation. Issue #849 remains open. Before merge: current-head Quality including the full browser suite, CodeQL, Supabase clean rebuild, independent review, current-main conflict check and visual inspection using the full portal styles. Publication and authenticated synthetic UAT must be verified separately.

Future work: reliable per-company invoice-mail intake, approved real-document AI extraction, safely orchestrated server-side approval/bookkeeping/planning with separate permissions and idempotency, payment-date scheduling, verified recipient/version checks, genuine bank authorization/submission/settlement evidence, partial payments/returns and reconciliation. Preserve mandatory bank-provider test gates and production-readiness approval. No fake bank execution or automatic release is added here.
