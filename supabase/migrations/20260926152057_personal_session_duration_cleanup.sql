-- Recovered from live Supabase migration history (20260926152057 personal_session_duration_cleanup).
-- GitHub is source of truth for rebuilds.

-- Remove the older duplicate permissive update policy.
-- The retained policy "users can update own session duration" is owner-scoped,
-- and the separate restrictive AAL2 policy applies to every app_users command.

drop policy if exists "users update own session duration" on public.app_users;
;
