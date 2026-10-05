# Supabase UAT source of truth

Status captured: 2026-10-05.

GitHub is the source of truth for UAT infrastructure. Permanent Supabase schema, RLS, RPC, trigger, Storage, Realtime, and Edge Function changes must have a corresponding version-controlled change in this repository.

## Live project reconciled

- Supabase project: `LT-Studio`
- Region: `eu-north-1`
- PostgreSQL: 17
- Live migration-history entries: 43
- Public application tables: 49
- Public tables with RLS disabled: 0
- Realtime publications: 46 public tables
- Storage buckets: `lt-documents` (private, PDF only, 10 MiB limit)
- Edge Functions: `operator-admin`, `uat-bootstrap`, `verify-customer-invoice-document`, `manual-customer-payment`

The 2026-09-30 reconciliation found one concrete source-control drift: the live `manual-customer-payment` Edge Function and its server-only RPC bridge existed in Supabase but were missing from `main`. That drift was versioned and resolved.

The 2026-10-05 reconciliation found the opposite kind of drift: two migrations existed in GitHub but had not been applied to live UAT. They are now applied and recorded with the exact hosted migration versions:

- `20261005122517_customer_invoice_defaults.sql` — adds customer-level invoice defaults for payment terms and references.
- `20261005122527_current_fk_covering_indexes.sql` — adds the 25 FK covering indexes that Supabase Performance Advisor reported as missing.

After the FK migration, the `unindexed_foreign_keys` advisor group is 0. The subsequent hosted RLS performance cleanup is recorded as `20261005135109_rls_advisor_performance_cleanup.sql`; GitHub uses that exact hosted version so migration-history reconciliation remains exact. Remaining performance findings are tracked separately in issue #645.

The repository still contains recovered replay-only SQL steps that are required to rebuild the final schema from an empty project even though those steps do not each have a separate row in the hosted project's migration-history table. The authoritative check is therefore two-part: every hosted migration version must exist in GitHub, and the full GitHub migration chain must pass the clean-rebuild workflow from zero.

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


## Verification 2026-10-05

- All 49 public application tables have RLS enabled.
- The four deployed Edge Functions are byte-for-byte identical to the files in `supabase/functions/`.
- Edge Function JWT settings match `supabase/config.toml`.
- `lt-documents` is private, PDF-only, and limited to 10 MiB.
- `supabase_realtime` publishes 46 public tables.
- Hosted migration history has 43 entries, and every hosted version has an exact matching GitHub migration filename.
- Latest `main` clean-rebuild workflow passed before this reconciliation.
- Security Advisor has one remaining warning: Leaked Password Protection, tracked in #530 and blocked by the current Supabase Free plan.
