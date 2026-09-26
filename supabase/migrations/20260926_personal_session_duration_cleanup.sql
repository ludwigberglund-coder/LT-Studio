-- Remove the older duplicate permissive update policy.
-- The retained policy "users can update own session duration" is owner-scoped,
-- and the separate restrictive AAL2 policy applies to every app_users command.

drop policy if exists "users update own session duration" on public.app_users;
