-- Enforce the personal 2/4/6/8 hour session limit at the database boundary.
-- The helper lives in a non-exposed schema and verifies auth.uid(), JWT session_id,
-- the live auth.sessions row, AAL2, disabled state and the user's own duration.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.lt_personal_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_started_at timestamptz;
  v_not_after timestamptz;
  v_duration integer;
  v_disabled boolean;
begin
  if v_uid is null then
    return false;
  end if;

  if coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2' then
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

  select s.created_at, s.not_after, u.session_duration_minutes, u.disabled
    into v_started_at, v_not_after, v_duration, v_disabled
  from auth.sessions s
  join public.app_users u on u.auth_user_id = s.user_id
  where s.id = v_session_id
    and s.user_id = v_uid;

  if not found or coalesce(v_disabled,false) then
    return false;
  end if;

  if v_not_after is not null and now() >= v_not_after then
    return false;
  end if;

  if v_duration is null then
    return true;
  end if;

  return now() < v_started_at + make_interval(mins => v_duration);
end;
$function$;

revoke all on function private.lt_personal_session_allowed() from public;
grant execute on function private.lt_personal_session_allowed() to authenticated;

do $block$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I','personal session limit',r.table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (private.lt_personal_session_allowed()) with check (private.lt_personal_session_allowed())',
      'personal session limit',
      r.table_name
    );
  end loop;
end;
$block$;
