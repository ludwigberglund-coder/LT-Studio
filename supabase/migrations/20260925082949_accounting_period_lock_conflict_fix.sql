-- Recovered from live Supabase migration history (20260925082949 accounting_period_lock_conflict_fix).
-- GitHub is source of truth for rebuilds.


create or replace function public.lock_accounting_period(p_company_id text,p_period text)
returns table(period text,status text,locked_by uuid,locked_at timestamptz,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_current public.accounting_periods%rowtype;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_current from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=p_period for update;
  if found and v_current.status='locked' then
    if v_current.locked_by=v_uid then return query select v_current.period,v_current.status,v_current.locked_by,v_current.locked_at,true;return;end if;
    raise exception 'PERIOD_ALREADY_LOCKED';
  end if;
  insert into public.accounting_periods(company_id,period,status,locked_by,locked_at)
  values(p_company_id,p_period,'locked',v_uid,now())
  on conflict on constraint accounting_periods_pkey
  do update set status='locked',locked_by=v_uid,locked_at=now();
  return query select ap.period,ap.status,ap.locked_by,ap.locked_at,false
  from public.accounting_periods ap
  where ap.company_id=p_company_id and ap.period=p_period;
end;
$$;
revoke all on function public.lock_accounting_period(text,text) from public,anon;
grant execute on function public.lock_accounting_period(text,text) to authenticated;
;
