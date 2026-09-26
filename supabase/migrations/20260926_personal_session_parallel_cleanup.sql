-- Reconcile parallel personal-session hardening work.
-- Keep the original lt_security guard from personal_session_limits and remove
-- the temporary duplicate private-schema guard, which required broader schema USAGE.

do $block$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind='r'
      and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I','personal session limit',r.table_name);
  end loop;
end;
$block$;

drop function if exists private.lt_personal_session_allowed();
revoke usage on schema private from authenticated;

revoke all on table public.app_users from authenticated;
grant select on table public.app_users to authenticated;
grant update (session_duration_minutes) on table public.app_users to authenticated;

drop policy if exists "users can update own session duration" on public.app_users;
drop policy if exists "users update own session duration" on public.app_users;
create policy "users update own session duration"
on public.app_users
for update
to authenticated
using (
  auth_user_id=(select auth.uid())
)
with check (
  auth_user_id=(select auth.uid())
  and (
    session_duration_minutes is null
    or session_duration_minutes in (120,240,360,480)
  )
);

drop policy if exists "UAT requires AAL2" on public.app_users;
create policy "UAT requires AAL2"
on public.app_users
as restrictive
for all
to authenticated
using (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
)
with check (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
);
