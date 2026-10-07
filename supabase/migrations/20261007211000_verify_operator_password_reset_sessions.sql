-- Verify administrative password-reset session revocation without writing to auth internals.
-- Both helpers are service-role only and only expose/inspect the target user's
-- pre-reset session IDs to the trusted operator Edge Function.

create or replace function public.operator_capture_user_sessions(
  p_company_id text,
  p_target_auth_user_id uuid,
  p_operator_auth_user_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ids uuid[];
begin
  if coalesce(p_company_id,'')='' or p_target_auth_user_id is null or p_operator_auth_user_id is null then
    raise exception 'INVALID_SESSION_VERIFICATION_REQUEST';
  end if;

  if not exists(
    select 1
    from public.platform_operators o
    where o.auth_user_id=p_operator_auth_user_id
      and o.disabled=false
  ) then
    raise exception 'OPERATOR_ACCESS_DENIED';
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=p_target_auth_user_id
  ) then
    raise exception 'MEMBERSHIP_NOT_FOUND';
  end if;

  select coalesce(array_agg(s.id order by s.created_at),'{}'::uuid[])
  into v_ids
  from auth.sessions s
  where s.user_id=p_target_auth_user_id;

  return coalesce(v_ids,'{}'::uuid[]);
end;
$$;

create or replace function public.operator_count_remaining_previous_sessions(
  p_company_id text,
  p_target_auth_user_id uuid,
  p_operator_auth_user_id uuid,
  p_previous_session_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
begin
  if coalesce(p_company_id,'')='' or p_target_auth_user_id is null or p_operator_auth_user_id is null then
    raise exception 'INVALID_SESSION_VERIFICATION_REQUEST';
  end if;

  if not exists(
    select 1
    from public.platform_operators o
    where o.auth_user_id=p_operator_auth_user_id
      and o.disabled=false
  ) then
    raise exception 'OPERATOR_ACCESS_DENIED';
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=p_target_auth_user_id
  ) then
    raise exception 'MEMBERSHIP_NOT_FOUND';
  end if;

  select count(*)::integer
  into v_count
  from auth.sessions s
  where s.user_id=p_target_auth_user_id
    and s.id=any(coalesce(p_previous_session_ids,'{}'::uuid[]));

  return coalesce(v_count,0);
end;
$$;

revoke all on function public.operator_capture_user_sessions(text,uuid,uuid)
from public,anon,authenticated;
revoke all on function public.operator_count_remaining_previous_sessions(text,uuid,uuid,uuid[])
from public,anon,authenticated;

grant execute on function public.operator_capture_user_sessions(text,uuid,uuid)
to service_role;
grant execute on function public.operator_count_remaining_previous_sessions(text,uuid,uuid,uuid[])
to service_role;
