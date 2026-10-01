# Pre-launch integrations: BankID and Tink

Status: **planned, not implemented**.

This document replaces the older pre-launch plan from PR #355 and is aligned with the current shared UAT architecture:

- GitHub Pages serves the LT Studio portal.
- Supabase provides PostgreSQL, Auth, MFA, RLS, Realtime, Storage, RPCs and Edge Functions.
- GitHub is source of truth for code, migrations, functions, tests and documentation.
- Secrets, bank tokens and real customer data must never be committed to GitHub.

The purpose of this document is to preserve the launch requirements without pretending that either integration is already production-ready.

## 1. BankID login

### Goal

Before broad commercial launch, LT Studio should support a verified BankID login flow if that remains the selected identity strategy.

BankID must prove the identity of the person. It must **not** replace LT Studio's authorization model.

After successful identity verification, the normal LT Studio controls must still decide:

- which Supabase Auth user the identity belongs to,
- whether the user is active,
- which company memberships the user has,
- which role the user has in that company,
- whether the current session satisfies the required authentication level,
- what RLS policies and protected write flows allow.

### Security boundary

A BankID provider secret, certificate, client secret or private signing material must never be exposed in GitHub Pages or browser JavaScript.

The provider interaction must therefore terminate in a trusted server-side boundary, such as an approved identity-provider integration or a protected backend/Edge Function design.

No BankID identity may be linked to an LT Studio user merely because a name or email address matches.

The identity-linking model must use a stable verified provider identifier and must be auditable.

Personal identity numbers must not appear in URLs, normal logs, analytics, GitHub, browser storage or client-visible debug output.

### Required login flow

A future implementation must at minimum:

1. start a BankID authentication request through the trusted server-side boundary,
2. validate provider response, state/nonce and request correlation,
3. map the verified identity to one explicit LT Studio/Supabase identity,
4. reject disabled or unlinked users,
5. create or continue the approved Supabase Auth session,
6. preserve the current company-membership and RLS model,
7. preserve MFA/session-duration requirements unless a reviewed policy explicitly changes them,
8. audit the authentication method without leaking sensitive identity data,
9. make logout invalidate the active session path correctly,
10. handle cancelled, expired, replayed and failed authentication safely.

### Launch gate for BankID

BankID must not be called production-ready until all of the following are complete:

- provider selected,
- commercial and data-processing agreements reviewed,
- production callback/redirect domains decided,
- secrets-management design approved,
- identity-linking schema reviewed,
- account-linking and recovery rules decided,
- test environment working,
- same-device and QR flows tested where applicable,
- disabled-user and wrong-company cases tested,
- session, MFA, logout and re-authentication tested,
- audit logging verified,
- security review completed,
- production UAT completed.

## 2. Tink bank connection

### Goal

LT Studio should use an established bank-connectivity provider rather than building bank-specific credential flows itself.

Tink remains a planned integration. No real bank credentials or production bank data should be connected until the security and accounting flows are ready.

### Security boundary

The browser may initiate a consent/link flow, but long-lived provider credentials, refresh tokens and bank API secrets must not be stored in browser storage or committed to GitHub.

Token exchange, refresh and privileged bank operations must run in a trusted server-side boundary.

Imported bank data must remain tenant-isolated and must not bypass the economic review/batch controls used elsewhere in LT Studio.

### Required implementation stages

1. choose the exact Tink product/API scope,
2. document the bank data that LT Studio genuinely needs,
3. implement test/fake-bank flow first,
4. build the trusted token-exchange and refresh boundary,
5. define encrypted secret/token storage,
6. map imported transactions to the correct company,
7. make imports idempotent,
8. log provider/request identifiers without leaking credentials,
9. handle revoked consent and provider outages,
10. connect imported transactions to the existing bank/reconciliation and approval flows,
11. run security, accounting and recovery tests before real-bank UAT.

## 3. Decisions deliberately not frozen here

This document intentionally does not preserve old vendor pricing or select a BankID reseller.

Pricing, provider capabilities, contractual terms and Supabase/provider integration options change over time and must be verified again when implementation is scheduled.

The implementation PR must record the provider and architecture decision that is current at that time.

## 4. Commercial launch gate

Before broad commercial launch, LT Studio must have a documented decision for both areas:

- BankID: implemented and production-verified, or explicitly deferred with an approved alternative login strategy.
- Bank connectivity: implemented and production-verified, or explicitly deferred with a clearly documented first-release scope.

In all cases, real credentials, bank tokens, personal identity data and customer secrets stay outside GitHub.
