# Supabase-only UAT architecture

Status: major domain migration implemented on `feat/supabase-only-uat`. GitHub remains source of truth.

## Target

- GitHub `main`: source code, tests, documentation and versioned Supabase migrations/functions.
- GitHub Pages: shared browser-accessible UAT frontend.
- Supabase project `LT-Studio` (`eu-north-1`): PostgreSQL, Auth, RLS, private Storage, RPCs and Edge Functions.
- Railway/Node/SQLite: legacy UAT runtime to keep only until final migration UAT is approved.

The browser may contain only the Supabase project URL and a **publishable** key. Secret/service-role keys must never be committed or exposed in GitHub Pages.

## Migrated shared UAT areas

The branch now uses Supabase for:

- Auth and company context.
- Customers and customer receivables.
- Suppliers and supplier invoices.
- Supplier coding, approval, liability posting and payments.
- Customer invoices, negative invoices, credit notes and credit refunds.
- Private PDF/document archive with SHA-256.
- Accounting journal read model.
- Reports.
- Bank reconciliation and customer-payment proposals.
- Human-reviewed automation queue and approved customer-payment posting.
- Inventory, movements and four-eyes inventory adjustments.
- Aggregated payroll journal import and posting.
- LT Studio operator/admin backend through an MFA-gated Supabase Edge Function.

## Security model

- Tenant data is protected by RLS and `company_memberships`.
- Financial and inventory writes use controlled RPCs plus trigger guards that block direct browser writes to protected core tables.
- Economic RPCs remain `SECURITY INVOKER`.
- Private Storage is PDF-only, company-scoped and max 10 MB.
- Archived document metadata is insert/read-only for browser roles. Archived PDF originals cannot be deleted; only orphan uploads that are not referenced by `documents` may be cleaned up.
- Operator/global-admin access is **not** granted through tenant RLS. The operator browser calls the `operator-admin` Edge Function.
- `operator-admin` validates the Supabase user token, requires JWT `aal2` (MFA), verifies an active row in `platform_operators`, and only then uses server-side privileged credentials.
- Operator audit and security-incident state are stored in locked-down tables that browser roles cannot query directly.
- Supabase Security Advisor is expected to remain at zero findings before merge.

## Advanced guarded accounting flows

The following former Node/SQLite blocker flows are now migrated behind controlled Supabase RPCs:

- Manual-journal correction through an immutable reversal entry. Source-generated customer/supplier/payment/payroll journals remain protected and must be corrected in their source flow.
- Accounting period lock plus two-person unlock request/decision. The requester cannot decide their own unlock.
- Opening-balance import for an otherwise empty year, restricted to balance-sheet classes 1–2 and blocking 1510/2440 totals without subledger evidence.
- Reclassification of an already-posted customer payment when the current allocation is fully paid and the new target has an exact matching open balance. Partial-payment reclassification stays blocked.

These flows also use the controlled financial-write guard; direct browser writes to the financial core remain rejected.

## Verified rollback-UAT checks

Synthetic test identities and data were created only inside SQL transactions and rolled back afterwards. Verified:

- Cross-company RLS isolation: user A saw 1/1 own customer+invoice and 0 rows from company B; user B saw the inverse.
- Browser roles cannot read operator-only tables.
- Direct browser-style writes to protected invoice and inventory tables are rejected by the controlled-write guards.
- Controlled inventory RPCs still work through those guards.
- Four-eyes inventory approval blocks self-approval and succeeds for a second authorized user.
- Accounting period unlock blocks self-approval and succeeds for a second authorized user.
- Payroll import + posting completes and creates an L-series journal.
- Automation proposal approval moves the proposal to approved and the bank event to reviewed.
- Supabase Security Advisor remained at 0 findings after the fixes.

## Secure UAT onboarding

GitHub Pages now includes `/portal/uat-setup.html` for first-time UAT activation.

- Account creation uses a dedicated `uat-bootstrap` Edge Function.
- Each collaborator receives a separate long, one-time invite code. Only its SHA-256 hash is stored in Supabase; plaintext invite codes are runtime credentials and are never committed to GitHub.
- The user chooses their own email and password. The password must be at least 12 characters and include uppercase, lowercase, number and special character.
- Bootstrap creates the Supabase Auth identity, `app_users`, company membership and optionally `platform_operators` server-side.
- Failed partial bootstrap is rolled back by deleting any partially created operator/membership/profile/Auth identity before the invite is released.
- The whole shared Supabase UAT requires a verified TOTP factor and an `aal2` session, not only the operator portal.
- The setup page supports resuming MFA enrollment if account creation succeeded but the browser was closed before TOTP verification.
- Edge Function Supabase JS dependencies are pinned to `2.117.1`.
- Browser host detection requires the exact host `ludwigberglund-coder.github.io`; suffix matching is not accepted.

## Safe UAT invoice identity

The shared UAT company uses clearly synthetic invoice identity/payment details. In UAT, customer invoices and credit notes set `document.demo=true`, so generated PDFs visibly say **DEMO – INTE BETALNINGSUNDERLAG**. The configured UAT bankgiro is `EJ-BETALNING` and the identity must never be reused for production.

## Remaining prerequisites for end-to-end UAT

- Generate two one-time bootstrap invite codes after CI/CodeQL are green, then let each UAT collaborator create their own Auth identity and enroll TOTP through GitHub Pages.
- Verify both resulting accounts have `admin` membership in the synthetic UAT company and active `platform_operators` rows.
- UAT invoice settings are intentionally synthetic and already configured; production identity/payment details must not be introduced during UAT.
- Run full cross-company tenant-isolation, accounting-integrity, four-eyes workflows, PDF/storage, operator MFA and browser UAT.
- Review CI/CodeQL and merge PR only when all required checks pass.
- Only after successful UAT remove obsolete Railway/Node/SQLite deployment configuration.

## GitHub rule

All schema, RPC, Edge Function, UI and security changes must be committed to GitHub in the same change. Supabase must never become an undocumented second source of truth.
