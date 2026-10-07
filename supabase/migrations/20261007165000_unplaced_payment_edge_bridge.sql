-- Route unplaced-payment resolution through a JWT-verified Edge Function.
-- The browser-facing SECURITY DEFINER RPC is revoked from authenticated users.

create or replace function public.resolve_unplaced_bank_payment_server(
  p_actor_uid uuid,
  p_session_id uuid,
  p_company_id text,
  p_bank_payment_id text,
  p_resolution_type text,
  p_counter_account text,
  p_description text,
  p_request_id text
)
returns table(resolution_id text,journal_number text,duplicate boolean)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_minutes integer;
  v_session_created_at timestamptz;
begin
  if p_actor_uid is null or p_session_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select u.session_duration_minutes,s.created_at
  into v_minutes,v_session_created_at
  from public.app_users u
  join auth.sessions s
    on s.id=p_session_id
   and s.user_id=p_actor_uid
  where u.auth_user_id=p_actor_uid
    and u.disabled=false;

  if not found or v_session_created_at is null then
    raise exception 'SESSION_EXPIRED';
  end if;

  if v_minutes is not null
     and now()>=v_session_created_at+make_interval(mins=>v_minutes) then
    raise exception 'SESSION_EXPIRED';
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=p_actor_uid
      and m.role in ('admin','accountant')
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  perform set_config('request.jwt.claim.sub',p_actor_uid::text,true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',p_actor_uid::text,
      'aal','aal2',
      'session_id',p_session_id::text,
      'role','authenticated'
    )::text,
    true
  );

  return query
  select *
  from public.resolve_unplaced_bank_payment(
    p_company_id,
    p_bank_payment_id,
    p_resolution_type,
    p_counter_account,
    p_description,
    p_request_id
  );
end;
$$;

revoke all on function public.resolve_unplaced_bank_payment_server(uuid,uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.resolve_unplaced_bank_payment_server(uuid,uuid,text,text,text,text,text,text)
  to service_role;

revoke execute on function public.resolve_unplaced_bank_payment(text,text,text,text,text,text)
  from authenticated;
grant execute on function public.resolve_unplaced_bank_payment(text,text,text,text,text,text)
  to service_role;
