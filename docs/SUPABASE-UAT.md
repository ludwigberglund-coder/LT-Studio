# Supabase-only UAT architecture

Status: migration in progress. GitHub is source of truth.

## Target

- GitHub `main`: source code, tests, documentation, migrations and GitHub Pages UAT frontend.
- GitHub Pages: browser UI only.
- Supabase project `LT-Studio` (`eu-north-1`): PostgreSQL, Auth, tenant isolation and shared UAT data.
- Railway: not part of the target architecture.

The browser may contain only the Supabase project URL and a **publishable** key. Secret/service-role keys must never be committed or exposed in GitHub Pages.

## Current Supabase foundation

The live project now has RLS-enabled tables for companies, memberships, app users, customers, customer invoices, invoice transactions, suppliers, supplier invoices, journal entries/lines, documents and audit events.

Security Advisor currently reports no findings. Tenant access is based on authenticated Supabase users plus `company_memberships`; accounting writes require an admin/accountant membership.

## Important limitation

The existing LT Studio application is still substantially coupled to the Node/SQLite API in `apps/api`. GitHub Pages cannot run that Node server. Therefore removing Railway safely requires migrating each API/domain flow to Supabase/PostgreSQL/Edge Functions or browser-safe RLS-backed calls. Do not delete the old API until its behavior and tests have equivalent Supabase coverage.

## Migration order

1. Auth + company context.
2. Customer master data and receivables.
3. Supplier master data and payables.
4. Journal/accounting.
5. PDF/document storage.
6. Admin/operator functions and audit.
7. Remaining bank, inventory, payroll, reports, CMS and automation flows.
8. Full UAT and tenant-isolation tests.
9. Only then remove obsolete Railway deployment configuration.

All future schema changes must be represented as versioned SQL under `supabase/migrations/` in the same PR as the application change.
