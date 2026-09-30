-- Recovered from live Supabase migration 20260926152057.
-- Remove the older duplicate permissive update policy.

drop policy if exists "users update own session duration" on public.app_users;
