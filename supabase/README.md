# Supabase shared UAT foundation

This directory contains version-controlled PostgreSQL/Supabase migrations for LT Studio.

## Purpose

The goal is a shared UAT environment where Ludwig and Theodor use the same data and the same application version.

- GitHub remains source of truth for code, tests, schema and migrations.
- Supabase becomes the shared PostgreSQL database/backend for UAT.
- Only synthetic test data may be used until production-readiness requirements are met.
- Secrets must never be committed to GitHub.

## Current state

The runtime still uses SQLite. The Supabase migration is intentionally not activated yet.

The switch to PostgreSQL must happen only after:

1. a server-side PostgreSQL adapter exists,
2. critical accounting flows pass against PostgreSQL,
3. tenant isolation tests prove company A cannot read/write company B,
4. migration verification checks counts, balances and identifiers,
5. shared UAT bootstrap creates only synthetic companies/users,
6. the UAT deployment has working HTTPS and server-side secrets.

## Authentication

Do not migrate authentication and the business database in the same first cutover.

The first safe target is:

- existing LT Studio login/session behaviour,
- shared PostgreSQL business data,
- server-side database access,
- no browser access using the service-role key.

Supabase Auth can be evaluated as a later, separate security change.

## RLS

RLS is enabled on the foundation tables, but no permissive client policies are created yet.

This is deliberate. A browser must not be able to select arbitrary company data. The first UAT adapter should run server-side and derive the active company from a validated LT Studio session.

## Files

Supabase Storage can later hold synthetic UAT PDFs and attachments. The bucket must be private and paths must be company-scoped. Storage migration is not activated by the foundation migration.

## Cutover rule

Never dual-write financial events to SQLite and PostgreSQL. Use a controlled UAT cutover after migration checks are green.


## Shared UAT bootstrap

The shared Supabase UAT uses only synthetic data.

Apply in this order to a dedicated Supabase UAT project:

1. Run the SQL migration in `supabase/migrations/20260926_001_shared_uat_foundation.sql`.
2. Run `supabase/seeds/shared-uat-synthetic.sql`.
3. Store the real project URL, service-role key and database URL only in the hosting secret manager.
4. Set `ROLLANDS_ENV=staging`, `ROLLANDS_DATA_CLASSIFICATION=synthetic`, `ROLLANDS_REAL_DATA_ALLOWED=0`, and `LT_DATABASE_ENGINE=postgresql`.
5. Set `LT_SUPABASE_UAT_COMPANY_ID` to one of the seeded synthetic company IDs.
6. Run `npm run staging:supabase:preflight`.

The preflight only verifies read access to tenant-scoped customers, suppliers, customer invoices and supplier invoices. It does not enable writes or migrate authentication.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in GitHub Pages, browser JavaScript, screenshots, issues, pull requests or chat messages.
