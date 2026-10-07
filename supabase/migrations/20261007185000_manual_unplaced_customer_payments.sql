-- Manual customer payment without invoice: create an unmatched bank payment for later placement.
-- Browser traffic continues through the MFA-verified manual-customer-payment Edge Function.

create or replace function public.stage_manual_unplaced_bank_payment_server(
  p_actor_uid uuid,
  p_session_id uuid,
  p_company_id text,
  p_request_id text,
  p_payment_date date,
  p_amount_ore bigint,
  p_reference text default null,
  p_payer_name text default null,
  p_comment text default null
)
returns table(bank_payment_id text,status text,duplicate boolean)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_minutes integer;
  v_session_created_at timestamptz;
  v_existing public.bank_payments%rowtype;
  v_bank_id text;
  v_external_id text;
  v_reference text:=nullif(btrim(coalesce(p_reference,'')),'');
  v_payer_name text:=nullif(btrim(coalesce(p_payer_name,'')),'');
  v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
  perform set_config('app.audit_event_write','1',true);

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

  if coalesce(p_request_id,'') !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_payment_date is null then raise exception 'INVALID_PAYMENT_DATE'; end if;
  if p_amount_ore is null or p_amount_ore<=0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
  if char_length(coalesce(v_reference,''))>160 then raise exception 'PAYMENT_REFERENCE_TOO_LONG'; end if;
  if char_length(coalesce(v_payer_name,''))>160 then raise exception 'PAYER_NAME_TOO_LONG'; end if;
  if char_length(coalesce(v_comment,''))>1000 then raise exception 'PAYMENT_COMMENT_TOO_LONG'; end if;

  v_external_id:='manual-unplaced:'||p_request_id;

  select * into v_existing
  from public.bank_payments b
  where b.company_id=p_company_id
    and b.external_id=v_external_id;

  if found then
    if v_existing.booking_date is distinct from p_payment_date
       or v_existing.value_date is distinct from p_payment_date
       or v_existing.amount_ore is distinct from p_amount_ore
       or v_existing.currency is distinct from 'SEK'
       or v_existing.reference is distinct from v_reference
       or v_existing.message is distinct from v_comment
       or v_existing.payer_name is distinct from v_payer_name
       or v_existing.payer_account is not null then
      raise exception 'BANK_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id,v_existing.status,true;
    return;
  end if;

  v_bank_id:='bank_'||replace(gen_random_uuid()::text,'-','');

  insert into public.bank_payments(
    id,company_id,external_id,booking_date,value_date,amount_ore,currency,
    reference,message,payer_name,payer_account,status,created_by
  ) values(
    v_bank_id,p_company_id,v_external_id,p_payment_date,p_payment_date,p_amount_ore,'SEK',
    v_reference,v_comment,v_payer_name,null,'unmatched',p_actor_uid
  );

  insert into public.audit_events(
    company_id,actor_user_id,event_type,entity_type,entity_id,details
  ) values(
    p_company_id,p_actor_uid,'MANUAL_UNPLACED_PAYMENT_CREATED','bank-payment',v_bank_id,
    jsonb_build_object(
      'requestId',p_request_id,
      'paymentDate',p_payment_date,
      'amountOre',p_amount_ore,
      'bankAccount','1930',
      'reference',v_reference,
      'payerName',v_payer_name,
      'comment',v_comment,
      'status','unmatched'
    )
  );

  return query select v_bank_id,'unmatched'::text,false;
end;
$$;

revoke all on function public.stage_manual_unplaced_bank_payment_server(uuid,uuid,text,text,date,bigint,text,text,text)
  from public,anon,authenticated;
grant execute on function public.stage_manual_unplaced_bank_payment_server(uuid,uuid,text,text,date,bigint,text,text,text)
  to service_role;
