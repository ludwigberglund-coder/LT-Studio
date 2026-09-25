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
- Private Storage is PDF-only and company-scoped.
- Operator/global-admin access is **not** granted through tenant RLS. The operator browser calls the `operator-admin` Edge Function.
- `operator-admin` validates the Supabase user token, requires JWT `aal2` (MFA), verifies an active row in `platform_operators`, and only then uses server-side privileged credentials.
- Operator audit and security-incident state are stored in locked-down tables that browser roles cannot query directly.
- Supabase Security Advisor is expected to remain at zero findings before merge.

## Intentionally write-protected until equivalent audit controls exist

These old Node/SQLite write flows are not yet enabled in Supabase UAT:

- General accounting correction/reversal from the accounting page.
- Accounting period lock/unlock decision workflow.
- Opening-balance import.
- Reclassification of an already-posted customer payment.

Read surfaces remain available where applicable. Do not reopen these writes by bypassing the controlled RPC model.

## Remaining prerequisites for end-to-end UAT

- Provision real Supabase Auth users for the two UAT collaborators and create their `app_users` / `company_memberships` rows.
- Explicitly designate at least one Auth user in `platform_operators` and enroll verified TOTP MFA before operator UAT.
- Complete `company_invoice_settings` with verified invoice identity/payment details.
- Run full cross-company tenant-isolation, accounting-integrity, PDF/storage and browser UAT.
- Review CI/CodeQL and merge PR only when all required checks pass.
- Only after successful UAT remove obsolete Railway/Node/SQLite deployment configuration.

## GitHub rule

All schema, RPC, Edge Function, UI and security changes must be committed to GitHub in the same change. Supabase must never become an undocumented second source of truth.
