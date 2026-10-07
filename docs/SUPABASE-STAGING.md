# Isolated Supabase staging

Status: staging contract prepared in GitHub. No paid staging resource is created by this document.

GitHub remains the source of truth.

## Goal

Create a separate Supabase staging environment that can be rebuilt from this repository and that contains synthetic data only. It must not share data, secrets, users, storage objects or credentials with UAT/pilot/production.

The active application model is:

- static frontend from reviewed GitHub code,
- Supabase PostgreSQL/Auth/MFA/RLS/Realtime/private Storage/RPC/Edge Functions,
- no Railway/SQLite staging backend.

## What is versioned

A staging rebuild uses:

1. every SQL file in `supabase/migrations/` in filename order,
2. `supabase/config.toml` for versioned function JWT and Storage configuration,
3. every Edge Function directory in `supabase/functions/`,
4. `supabase/seeds/staging_synthetic_tenants.sql` for staging-only fixture data,
5. database contract tests in `supabase/tests/`.

Secrets, invite plaintexts, project keys and user passwords must remain outside GitHub.

## Why staging has a separate seed

The shared UAT seed intentionally represents one UAT company. Staging must prove cross-tenant isolation, so its seed creates two clearly fictitious tenants:

- `staging-alpha` / Synthetic Alpha,
- `staging-beta` / Synthetic Beta.

The staging seed is deliberately not included in `[db.seed]` in `supabase/config.toml`. That prevents local/shared UAT rebuilds from silently becoming staging and keeps the environments conceptually separate.

The seed contains no Auth users or passwords. Login-capable identities must be created in the dedicated staging project using staging-only credentials and the supported Auth/bootstrap path. Each person gets a separate account and MFA/TOTP enrollment.

## Automated rebuild gate

The `Supabase clean rebuild` workflow must:

- rebuild from all migrations,
- run the normal synthetic UAT seed,
- lint database functions,
- run pgTAP database contract tests.

The contract test verifies at minimum:

- every public application table has RLS enabled,
- `lt-documents` is private, PDF-only and limited to 10 MiB,
- the expected Realtime publication is rebuilt,
- operator/bootstrap control tables have no direct browser table grants,
- the manual-customer-payment service bridge cannot be executed by `anon` or `authenticated`,
- the same bridge remains executable by `service_role`.

These checks exist so staging does not depend on whatever defaults happen to be selected in a new Supabase project's Dashboard.

## Provisioning gate

Do not create a second project, paid branch or plan upgrade automatically.

Before provisioning:

1. verify the current Supabase plan and available quota,
2. verify the exact cost of the selected staging option,
3. obtain explicit owner approval for any non-zero cost,
4. create staging with unique project URL/keys/secrets,
5. apply GitHub migrations and the staging-only seed,
6. deploy all four Edge Functions with the JWT settings from `supabase/config.toml`,
7. create separate synthetic Auth users and enroll MFA,
8. verify Security and Performance Advisors,
9. run two-tenant isolation and full end-to-end UAT,
10. record the exact Git commit and evidence in issue #364.

## Required live staging verification

A real staging environment is not approved merely because CI passes. Issue #364 remains open until the separate hosted environment proves:

- two-tenant isolation,
- MFA/AAL2 and session/logout behavior,
- private Storage access,
- Realtime behavior,
- operator security boundary,
- manual customer payment boundary,
- customer invoice -> batch -> receivables -> payment/credit/settlement -> ledger -> PDF,
- restore/rebuild procedure,
- Advisor results,
- signoff tied to an exact Git commit.

No real customer, bank, payroll, invoice, document or pilot/production backup may be loaded into staging.
