-- Personal Supabase session limits for LT Studio UAT.
-- Finite limits are enforced server-side through restrictive RLS using the
-- original Supabase auth.sessions.created_at value for the JWT session_id.

create schema if not exists lt_security;
revoke all on schema lt_security from public;
revoke all on schema lt_security from anon;
revoke all on schema lt_security from authenticated;
grant usage on schema lt_security to authenticated;

create or replace function lt_security.session_within_personal_limit()
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_minutes integer;
  v_created_at timestamptz;
begin
  if v_uid is null then
    return false;
  end if;

  begin
    v_session_id := nullif((select auth.jwt()->>'session_id'),'')::uuid;
  exception when others then
    return false;
  end;

  if v_session_id is null then
    return false;
  end if;

  select u.session_duration_minutes, s.created_at
  into v_minutes, v_created_at
  from public.app_users u
  join auth.sessions s
    on s.id = v_session_id
   and s.user_id = v_uid
  where u.auth_user_id = v_uid
    and u.disabled = false;

  if not found or v_created_at is null then
    return false;
  end if;

  -- NULL means "this browser session only". The browser stores those tokens
  -- in sessionStorage; RLS still requires a real active Supabase session.
  if v_minutes is null then
    return true;
  end if;

  return now() < v_created_at + make_interval(mins => v_minutes);
end;
$$;

revoke all on function lt_security.session_within_personal_limit() from public;
revoke all on function lt_security.session_within_personal_limit() from anon;
revoke all on function lt_security.session_within_personal_limit() from authenticated;
grant execute on function lt_security.session_within_personal_limit() to authenticated;

grant update(session_duration_minutes) on table public.app_users to authenticated;

drop policy if exists "users update own session duration" on public.app_users;
create policy "users update own session duration"
on public.app_users
for update
to authenticated
using (
  auth_user_id = (select auth.uid())
)
with check (
  auth_user_id = (select auth.uid())
  and (
    session_duration_minutes is null
    or session_duration_minutes in (120,240,360,480)
  )
);

do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name,c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_policies p
      on p.schemaname=n.nspname
     and p.tablename=c.relname
     and p.policyname='UAT requires AAL2'
    where n.nspname='public'
      and c.relkind='r'
      and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on %I.%I','UAT requires AAL2',r.schema_name,r.table_name);
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using (coalesce((select auth.jwt()->>''aal''),''aal1'')=''aal2'' and (select lt_security.session_within_personal_limit())) with check (coalesce((select auth.jwt()->>''aal''),''aal1'')=''aal2'' and (select lt_security.session_within_personal_limit()))',
      'UAT requires AAL2',r.schema_name,r.table_name
    );
  end loop;
end
$$;
