-- Allow users to change only their own personal session duration in Supabase UAT.
-- The AAL2 requirement is restrictive so it combines with ownership policies instead of bypassing them.

revoke all on table public.app_users from authenticated;
grant select on table public.app_users to authenticated;
grant update (session_duration_minutes) on table public.app_users to authenticated;

drop policy if exists "UAT requires AAL2" on public.app_users;
create policy "UAT requires AAL2"
on public.app_users
as restrictive
for all
to authenticated
using (coalesce((select auth.jwt()->>'aal'),'aal1')='aal2')
with check (coalesce((select auth.jwt()->>'aal'),'aal1')='aal2');

drop policy if exists "users can update own session duration" on public.app_users;
create policy "users can update own session duration"
on public.app_users
for update
to authenticated
using ((select auth.uid()) is not null and auth_user_id=(select auth.uid()))
with check ((select auth.uid()) is not null and auth_user_id=(select auth.uid()));
