# Hosted staging – operator/onboarding parity verification (2026-10-12)

## Scope and source of truth

This documents the deployment of **existing migration files from GitHub main**, not new SQL definitions. Environment: isolated synthetic-only `LT-Studio-Staging` (`rwnqkgbbbxjjfhwtepsi`). No UAT schema changes, paid resources, real customer records, permanent financial postings or Auth users were created.

Baseline GitHub main before deployment: `834682802176e27c4954c8e34a9315a8029a900c`. The Supabase migration application endpoint assigned a separate hosted version to each source file. This is expected given the existing migration-name alias history; do not rewrite historical version IDs directly.

## Exact migration-to-source mapping (all successful)

| GitHub migration source in `supabase/migrations/` | GitHub file blob SHA | Hosted staging migration version |
|---|---|---|
| `20261007152000_company_activation_invites.sql` | `7463b10a46741d696f76e4eab47485433ae74e11` | `20261012115217` |
| `20261007152100_operator_create_company_onboarding.sql` | `c74ad3a979835bddbaf0692d3d79a809042aeaf6` | `20261012115223` |
| `20261007152200_claim_company_activation.sql` | `bfac144b5a747e6348e130aa79f7a24dd7f25fda` | `20261012115228` |
| `20261007152300_reissue_company_activation.sql` | `dd40d50aaed7969e60bafa097203884d6c5be332` | `20261012115231` |
| `20261007152400_single_active_company_activation.sql` | `4d50ce0d66a4fcb84551656b1c4a655c801d1bf8` | `20261012115234` |
| `20261007152500_realtime_tenant_filter_hardening.sql` | `682484419abad24a37ffd3e9a7c15276980f8607` | `20261012115239` |
| `20261007152600_customer_invoice_storage_delete_guard.sql` | `1fba1ff23d8ceb665e0f7049582bb6f5ea1a5618` | `20261012115242` |
| `20261007200500_protect_last_company_admin.sql` | `41f08ed9816eea914102e62356cbdd72c1fe6d87` | `20261012115247` |
| `20261007211000_verify_operator_password_reset_sessions.sql` | `1f2947c68617cb18a4cb923dc9bff31efd012a8f` | `20261012115250` |

Before applying: staging contained exactly two synthetic company seeds (Alpha/Beta), zero `auth.users`, zero memberships, zero operators, zero non-synthetic companies, no `company_activation_invites`, and zero public tables lacking RLS. The preflight therefore supported a controlled sync without disturbing real identities.

## Post-deployment read-only proof

- Supabase reported `success: true` for **all nine** applications.
- Hosted migration list rose from **78 to 87** entries.
- All six expected operator/activation RPC names now exist. For each one: `anon EXECUTE=false`, `authenticated EXECUTE=false`, `service_role EXECUTE=true`.
- The two operator session-inspection helpers remain `SECURITY DEFINER`; other four listed functions use invoker rights.
- Supabase staging Security Advisor: **zero notices**.
- All migration SQL files already existed in main; this PR records deployment evidence rather than adding duplicate schema code.

## Remaining open evidence — issue #364

This **does not** certify hosted multi-tenant end-to-end usage. Staging still requires distinct staging-only Supabase Auth identities and personal MFA/TOTP enrollment, separate Alpha/Beta memberships, negative authenticated access tests, private Storage/Realtime validation, synthetic accounting flow, and backup/restore evidence. Do not create Auth users by manually inserting into `auth.users`. Use supported Auth admin/invitation flows with credentials stored outside GitHub.

GitHub should remain the source of truth; runtime user data and passwords must stay in Supabase / secret storage. Before marking migration-history parity as exact, reconcile previously existing migration-version aliases with official Supabase migration history tools; **matching schema does not imply matching historical timestamps**.

Cost: no new resource or plan upgrade. Leave issue #364 open until all acceptance criteria are independently verified.
