-- Fix live-tested ambiguity in save_company_revenue_account.
-- The RETURNS TABLE output names shadow unqualified column names in an ON CONFLICT target.
-- Use the primary-key constraint name explicitly so Postgres cannot confuse them.

create or replace function public.save_company_revenue_account(
  p_company_id text,p_account_number text,p_account_name text,p_vat_rate integer
)
returns table(account_number text,account_name text,vat_rates smallint[])
language plpgsql security invoker set search_path=''
as $function$
declare v_uid uuid:=auth.uid();
begin
  perform set_config('app.revenue_account_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((select auth.jwt()->>'aal'),'aal1')<>'aal2' or not (select lt_security.session_within_personal_limit()) then raise exception 'SESSION_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if coalesce(p_account_number,'') !~ '^3[0-9]{3}$' or p_account_number='3740' then raise exception 'INVALID_REVENUE_ACCOUNT'; end if;
  if char_length(btrim(coalesce(p_account_name,''))) not between 1 and 120 then raise exception 'INVALID_ACCOUNT_NAME'; end if;
  if p_vat_rate not in (0,6,12,25) then raise exception 'INVALID_VAT_RATE'; end if;

  insert into public.company_revenue_accounts(
    company_id,account_number,account_name,vat_rates,created_by,updated_by
  )
  values(
    p_company_id,p_account_number,btrim(p_account_name),array[p_vat_rate]::smallint[],v_uid,v_uid
  )
  on conflict on constraint company_revenue_accounts_pkey do update
    set account_name=excluded.account_name,
        vat_rates=excluded.vat_rates,
        updated_by=v_uid,
        updated_at=now();

  perform set_config('app.audit_event_write','1',true);
  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    p_company_id,v_uid,'REVENUE_ACCOUNT_SAVED','revenue_account',p_account_number,
    jsonb_build_object('accountName',btrim(p_account_name),'vatRate',p_vat_rate)
  );

  return query
  select a.account_number,a.account_name,a.vat_rates
  from public.company_revenue_accounts a
  where a.company_id=p_company_id
    and a.account_number=p_account_number;
end;
$function$;

revoke all on function public.save_company_revenue_account(text,text,text,integer) from public,anon;
grant execute on function public.save_company_revenue_account(text,text,text,integer) to authenticated;
