-- Admins may always unlock their own accounting periods.
-- The request/decision history remains in period_unlock_requests for traceability.

create or replace function public.decide_accounting_period_unlock(
  p_company_id text,
  p_request_id text,
  p_decision text,
  p_reason text default null
)
returns table(request_id text,request_status text,period text,period_status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_req public.period_unlock_requests%rowtype;
  v_reason text:=left(btrim(coalesce(p_reason,'')),500);
  v_role text;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select m.role into v_role
  from public.company_memberships m
  where m.company_id=p_company_id
    and m.auth_user_id=v_uid
    and m.role in ('admin','accountant')
  limit 1;

  if v_role is null then raise exception 'ACCESS_DENIED'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_UNLOCK_DECISION'; end if;

  select * into v_req
  from public.period_unlock_requests r
  where r.company_id=p_company_id and r.id=p_request_id
  for update;

  if not found then raise exception 'UNLOCK_REQUEST_NOT_FOUND'; end if;
  if v_req.status<>'pending' then
    if v_req.status=p_decision and v_req.decided_by=v_uid then
      return query
      select v_req.id,v_req.status,v_req.period,
        coalesce((select ap.status from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_req.period),'open');
      return;
    end if;
    raise exception 'UNLOCK_ALREADY_DECIDED';
  end if;

  if v_req.requested_by=v_uid and v_role<>'admin' then
    raise exception 'SEPARATION_OF_DUTIES_FAILED';
  end if;

  if p_decision='approved' then
    update public.accounting_periods ap
    set status='open',locked_by=null,locked_at=null
    where ap.company_id=p_company_id and ap.period=v_req.period and ap.status='locked';
    if not found then raise exception 'PERIOD_NOT_LOCKED'; end if;
  end if;

  update public.period_unlock_requests r
  set status=p_decision,
      decided_by=v_uid,
      decided_at=now(),
      decision_reason=nullif(v_reason,'')
  where r.company_id=p_company_id and r.id=p_request_id and r.status='pending';

  return query
  select p_request_id,p_decision,v_req.period,
    coalesce((select ap.status from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_req.period),'open');
end;
$$;

revoke all on function public.decide_accounting_period_unlock(text,text,text,text) from public,anon;
grant execute on function public.decide_accounting_period_unlock(text,text,text,text) to authenticated;
