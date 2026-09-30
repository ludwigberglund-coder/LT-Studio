# Supabase UAT source of truth

Status captured: 2026-09-30.

GitHub is the source of truth for UAT infrastructure. Permanent Supabase schema, RLS, RPC, trigger, Storage, Realtime, and Edge Function changes must have a corresponding version-controlled change in this repository.

## Live project reconciled

- Supabase project: `LT-Studio`
- Region: `eu-north-1`
- PostgreSQL: 17
- Live migration-history entries: 39
- Public application tables: 49
- Public tables with RLS disabled: 0
- Realtime publications: 46 public tables
- Storage buckets: `lt-documents` (private, PDF only, 10 MiB limit)
- Edge Functions: `operator-admin`, `uat-bootstrap`, `verify-customer-invoice-document`, `manual-customer-payment`

During the 2026-09-30 reconciliation, the manual-payment Edge Function/RPC bridge, live migration history, and current FK indexes were recovered into `main` through earlier PRs. This follow-up normalizes the remaining migration filenames to full 14-digit versions and adds an automated clean-rebuild gate so ordering problems are caught before merge.

## Rebuild contract

A replacement UAT environment must be built from this repository, not by manually recreating dashboard state.

1. Create/link the Supabase project.
2. Apply every SQL file in `supabase/migrations/` in filename order. Active migration filenames use full 14-digit versions so Supabase CLI applies them in the intended sequence.
3. Apply the synthetic UAT seed from `supabase/seeds/`; never copy real customer data into source control.
4. Deploy every directory in `supabase/functions/`.
5. Use `supabase/config.toml` as the Edge Function JWT policy.
6. Configure secrets outside GitHub.
7. Verify the private `lt-documents` bucket, its policies, the Realtime publication, RLS, RPC execute grants, triggers, and Security Advisor.
8. Run `Supabase clean rebuild` / `supabase db reset --local` and database linting before using the environment.
9. Run application UAT against GitHub Pages + the rebuilt Supabase project.

## Change rule

Do not make a permanent database or Edge Function change only in the Supabase dashboard. The GitHub migration/function must be committed in the same change. If an emergency change is made live first, the matching GitHub change is P0 and must be reconciled immediately.

## Security boundary

The browser-facing manual-payment route is:

`browser -> manual-customer-payment Edge Function -> stage_manual_customer_payment_server(...) -> stage_manual_customer_payment(...)`

The server bridge is `SECURITY DEFINER`, has an empty `search_path`, validates the actor/session/company membership, and is executable only by `service_role`. It must not be granted to `anon` or `authenticated`.


## Automated rebuild gate

Changes under `supabase/**` run the GitHub Actions workflow `Supabase clean rebuild`. It starts a clean local Supabase Postgres, replays the repository migrations and synthetic seed, runs database linting, and fails the PR if GitHub can no longer reconstruct the database chain.
