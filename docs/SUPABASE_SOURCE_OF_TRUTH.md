# Supabase UAT source of truth

Status captured: 2026-09-30.

GitHub is the source of truth for UAT infrastructure. Permanent Supabase schema, RLS, RPC, trigger, Storage, Realtime, and Edge Function changes must have a corresponding version-controlled change in this repository.

## Live project reconciled

- Supabase project: `LT-Studio`
- Region: `eu-north-1`
- PostgreSQL: 17
- Live migration-history entries: 40
- Public application tables: 49
- Public tables with RLS disabled: 0
- Realtime publications: 46 public tables
- Storage buckets: `lt-documents` (private, PDF only, 10 MiB limit)
- Edge Functions: `operator-admin`, `uat-bootstrap`, `verify-customer-invoice-document`, `manual-customer-payment`

The reconciliation found one concrete source-control drift on 2026-09-30: the live `manual-customer-payment` Edge Function and its server-only RPC bridge existed in Supabase but were missing from `main`. This change versions both.

The repository also contains recovered replay-only SQL steps that are required to rebuild the final schema from an empty project even though those steps do not each have a separate row in the hosted project's migration-history table. The authoritative check is therefore two-part: every hosted migration version must exist in GitHub, and the full GitHub migration chain must pass the clean-rebuild workflow from zero.

## Rebuild contract

A replacement UAT environment must be built from this repository, not by manually recreating dashboard state.

1. Create/link the Supabase project.
2. Apply every SQL file in `supabase/migrations/` in filename order.
3. Apply the synthetic UAT seed from `supabase/seeds/`; never copy real customer data into source control.
4. Deploy every directory in `supabase/functions/`.
5. Use `supabase/config.toml` as the Edge Function JWT policy.
6. Configure secrets outside GitHub.
7. Verify the private `lt-documents` bucket, its policies, the Realtime publication, RLS, RPC execute grants, triggers, and Security Advisor.
8. Run application UAT against GitHub Pages + the rebuilt Supabase project.

## Change rule

Do not make a permanent database or Edge Function change only in the Supabase dashboard. The GitHub migration/function must be committed in the same change. If an emergency change is made live first, the matching GitHub change is P0 and must be reconciled immediately.

## Security boundary

The browser-facing manual-payment route is:

`browser -> manual-customer-payment Edge Function -> stage_manual_customer_payment_server(...) -> stage_manual_customer_payment(...)`

The server bridge is `SECURITY DEFINER`, has an empty `search_path`, validates the actor/session/company membership, and is executable only by `service_role`. It must not be granted to `anon` or `authenticated`.
