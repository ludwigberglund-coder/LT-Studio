-- Server-only bridge for staging manual customer payments through a JWT-verified Edge Function.
-- GitHub source of truth: 2026-09-30.
--
-- This migration is additive on purpose. The existing authenticated RPC remains
-- executable until the browser cutover has been deployed and verified.

create or replace function public.stage_manual_customer_payment_server(
  p_actor_uid uuid,
  p_session_id uuid,
  p_company_id text,
  p_request_id text,
  p_invoice_id text,
  p_payment_date date,
  p_amount_ore bigint,
  p_bank_account text,
  p_reference text default null,
  p_comment text default null
)
returns table(payment_id text,batch_id text,batch_number integer,status text)
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
  from public.stage_manual_customer_payment(
    p_company_id,
    p_request_id,
    p_invoice_id,
    p_payment_date,
    p_amount_ore,
    p_bank_account,
    p_reference,
    p_comment
  );
end;
$$;

revoke all on function public.stage_manual_customer_payment_server(uuid,uuid,text,text,text,date,bigint,text,text,text)
  from public,anon,authenticated;
grant execute on function public.stage_manual_customer_payment_server(uuid,uuid,text,text,text,date,bigint,text,text,text)
  to service_role;
