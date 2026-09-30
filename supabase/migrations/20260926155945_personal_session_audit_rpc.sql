-- Audited personal session-duration changes for Supabase UAT.
-- The exposed RPC is SECURITY INVOKER, so RLS and column grants still apply.
-- A private SECURITY DEFINER trigger owns the append-only audit write and rejects
-- direct browser updates that do not originate from the controlled RPC.

grant update(session_duration_minutes) on table public.app_users to authenticated;

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

create or replace function private.audit_personal_session_duration_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_company_id text := nullif(current_setting('app.profile_company_id',true),'');
begin
  if current_setting('app.profile_session_write',true) <> '1' then
    raise exception 'CONTROLLED_PROFILE_WRITE_REQUIRED';
  end if;

  if v_uid is null or new.auth_user_id <> v_uid then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_company_id is null or not exists (
    select 1
    from public.company_memberships m
    where m.company_id=v_company_id
      and m.auth_user_id=v_uid
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  if old.session_duration_minutes is distinct from new.session_duration_minutes then
    insert into public.audit_events(
      company_id,actor_user_id,event_type,entity_type,entity_id,details
    )
    values(
      v_company_id,
      v_uid,
      'USER_SESSION_DURATION_CHANGED',
      'user',
      new.id,
      jsonb_build_object(
        'before',old.session_duration_minutes,
        'after',new.session_duration_minutes
      )
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.audit_personal_session_duration_change()
from public, anon, authenticated;

drop trigger if exists app_users_personal_session_audit on public.app_users;
create trigger app_users_personal_session_audit
after update of session_duration_minutes on public.app_users
for each row
execute function private.audit_personal_session_duration_change();

create or replace function public.set_personal_session_duration(
  p_company_id text,
  p_session_duration_minutes integer
)
returns table(
  session_duration_minutes integer,
  previous_session_duration_minutes integer,
  changed boolean
)
language plpgsql
security invoker
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_before integer;
  v_after integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2' then
    raise exception 'MFA_REQUIRED';
  end if;

  if not (select lt_security.session_within_personal_limit()) then
    raise exception 'SESSION_EXPIRED';
  end if;

  if p_session_duration_minutes is not null
     and p_session_duration_minutes not in (120,240,360,480) then
    raise exception 'INVALID_SESSION_DURATION';
  end if;

  if not exists (
    select 1
    from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=v_uid
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  select u.session_duration_minutes
    into v_before
  from public.app_users u
  where u.auth_user_id=v_uid
    and u.disabled=false
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  perform set_config('app.profile_session_write','1',true);
  perform set_config('app.profile_company_id',p_company_id,true);

  update public.app_users u
     set session_duration_minutes=p_session_duration_minutes
   where u.auth_user_id=v_uid
     and u.disabled=false
  returning u.session_duration_minutes into v_after;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  return query
  select v_after,v_before,(v_before is distinct from v_after);
end;
$function$;

revoke all on function public.set_personal_session_duration(text,integer)
from public, anon, authenticated;
grant execute on function public.set_personal_session_duration(text,integer)
to authenticated;
