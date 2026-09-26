-- Route personal session-duration changes through one audited Supabase RPC.
-- Direct browser UPDATE on app_users is removed after this migration.
-- The function is SECURITY DEFINER because audit_events is intentionally append-only
-- through controlled paths; every caller is still validated against auth.uid(), AAL2,
-- the live Auth session and company membership.

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
security definer
set search_path=''
as $function$
declare
  v_uid uuid := auth.uid();
  v_app_user_id text;
  v_before integer;
  v_changed boolean := false;
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

  select u.id,u.session_duration_minutes
    into v_app_user_id,v_before
  from public.app_users u
  where u.auth_user_id=v_uid
    and u.disabled=false
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if v_before is distinct from p_session_duration_minutes then
    update public.app_users u
       set session_duration_minutes=p_session_duration_minutes
     where u.id=v_app_user_id
       and u.auth_user_id=v_uid;

    insert into public.audit_events(
      company_id,actor_user_id,event_type,entity_type,entity_id,details
    )
    values(
      p_company_id,
      v_uid,
      'USER_SESSION_DURATION_CHANGED',
      'user',
      v_app_user_id,
      jsonb_build_object('before',v_before,'after',p_session_duration_minutes)
    );

    v_changed := true;
  end if;

  return query
  select p_session_duration_minutes,v_before,v_changed;
end;
$function$;

revoke all on function public.set_personal_session_duration(text,integer)
from public, anon, authenticated;
grant execute on function public.set_personal_session_duration(text,integer)
to authenticated;

revoke update(session_duration_minutes) on table public.app_users from authenticated;
drop policy if exists "users update own session duration" on public.app_users;
