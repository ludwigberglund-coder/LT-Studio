-- Applied to Supabase UAT on 2026-09-25.
-- Accounting corrections, period lock/unlock and simple opening-balance import.

create table if not exists public.accounting_corrections(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  original_entry_id text not null,
  reversal_entry_id text not null,
  replacement_entry_id text,
  reason text not null check(char_length(reason) between 5 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id,original_entry_id),
  foreign key(company_id,original_entry_id) references public.journal_entries(company_id,id) on delete restrict,
  foreign key(company_id,reversal_entry_id) references public.journal_entries(company_id,id) on delete restrict,
  foreign key(company_id,replacement_entry_id) references public.journal_entries(company_id,id) on delete restrict
);
alter table public.accounting_corrections enable row level security;
create index if not exists accounting_corrections_created_by_idx on public.accounting_corrections(created_by);
create index if not exists accounting_corrections_reversal_idx on public.accounting_corrections(company_id,reversal_entry_id);
create index if not exists accounting_corrections_replacement_idx on public.accounting_corrections(company_id,replacement_entry_id);

create table if not exists public.period_unlock_requests(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  reason text not null check(char_length(reason) between 5 and 500),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  unique(company_id,id)
);
create unique index if not exists period_unlock_one_pending_idx on public.period_unlock_requests(company_id,period) where status='pending';
create index if not exists period_unlock_company_status_idx on public.period_unlock_requests(company_id,status,requested_at desc);
create index if not exists period_unlock_requested_by_idx on public.period_unlock_requests(requested_by);
create index if not exists period_unlock_decided_by_idx on public.period_unlock_requests(decided_by);
alter table public.period_unlock_requests enable row level security;

create policy "members read accounting corrections" on public.accounting_corrections for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=accounting_corrections.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert accounting corrections" on public.accounting_corrections for insert to authenticated
with check (created_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=accounting_corrections.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create policy "members read period unlock requests" on public.period_unlock_requests for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=period_unlock_requests.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert period unlock requests" on public.period_unlock_requests for insert to authenticated
with check (requested_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=period_unlock_requests.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update period unlock requests" on public.period_unlock_requests for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=period_unlock_requests.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=period_unlock_requests.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

revoke all on public.accounting_corrections,public.period_unlock_requests from anon;
grant select,insert on public.accounting_corrections to authenticated;
grant select,insert,update on public.period_unlock_requests to authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounting_periods','accounting_corrections','period_unlock_requests']
  loop
    execute format('drop trigger if exists controlled_financial_write_guard on public.%I',t);
    execute format('create trigger controlled_financial_write_guard before insert or update or delete on public.%I for each row execute function private.require_controlled_financial_write()',t);
  end loop;
end
$$;

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
  on conflict(company_id,period) do update set status='locked',locked_by=v_uid,locked_at=now();
  return query select ap.period,ap.status,ap.locked_by,ap.locked_at,false from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=p_period;
end;
$$;
revoke all on function public.lock_accounting_period(text,text) from public,anon;
grant execute on function public.lock_accounting_period(text,text) to authenticated;

create or replace function public.request_accounting_period_unlock(p_company_id text,p_period text,p_reason text)
returns table(request_id text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_existing public.period_unlock_requests%rowtype;v_id text;v_reason text:=btrim(coalesce(p_reason,''));
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_PERIOD'; end if;
  if char_length(v_reason)<5 or char_length(v_reason)>500 then raise exception 'UNLOCK_REASON_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if not exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=p_period and ap.status='locked') then raise exception 'PERIOD_NOT_LOCKED'; end if;
  select * into v_existing from public.period_unlock_requests r where r.company_id=p_company_id and r.period=p_period and r.status='pending';
  if found then
    if v_existing.requested_by=v_uid and v_existing.reason=v_reason then return query select v_existing.id,v_existing.status,true;return;end if;
    raise exception 'UNLOCK_ALREADY_PENDING';
  end if;
  v_id='unlock_'||replace(gen_random_uuid()::text,'-','');
  insert into public.period_unlock_requests(id,company_id,period,reason,status,requested_by)
  values(v_id,p_company_id,p_period,v_reason,'pending',v_uid);
  return query select v_id,'pending'::text,false;
end;
$$;
revoke all on function public.request_accounting_period_unlock(text,text,text) from public,anon;
grant execute on function public.request_accounting_period_unlock(text,text,text) to authenticated;

create or replace function public.decide_accounting_period_unlock(p_company_id text,p_request_id text,p_decision text,p_reason text default null)
returns table(request_id text,request_status text,period text,period_status text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_req public.period_unlock_requests%rowtype;v_reason text:=left(btrim(coalesce(p_reason,'')),500);
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_UNLOCK_DECISION'; end if;
  select * into v_req from public.period_unlock_requests r where r.company_id=p_company_id and r.id=p_request_id for update;
  if not found then raise exception 'UNLOCK_REQUEST_NOT_FOUND'; end if;
  if v_req.status<>'pending' then
    if v_req.status=p_decision and v_req.decided_by=v_uid then
      return query select v_req.id,v_req.status,v_req.period,coalesce((select ap.status from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_req.period),'open');return;
    end if;
    raise exception 'UNLOCK_ALREADY_DECIDED';
  end if;
  if v_req.requested_by=v_uid then raise exception 'SEPARATION_OF_DUTIES_FAILED'; end if;
  if p_decision='approved' then
    update public.accounting_periods ap set status='open',locked_by=null,locked_at=null
    where ap.company_id=p_company_id and ap.period=v_req.period and ap.status='locked';
    if not found then raise exception 'PERIOD_NOT_LOCKED'; end if;
  end if;
  update public.period_unlock_requests r set status=p_decision,decided_by=v_uid,decided_at=now(),decision_reason=nullif(v_reason,'')
  where r.company_id=p_company_id and r.id=p_request_id and r.status='pending';
  return query select p_request_id,p_decision,v_req.period,coalesce((select ap.status from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_req.period),'open');
end;
$$;
revoke all on function public.decide_accounting_period_unlock(text,text,text,text) from public,anon;
grant execute on function public.decide_accounting_period_unlock(text,text,text,text) to authenticated;

create or replace function public.import_opening_balance(p_company_id text,p_year text,p_posting_date date,p_lines jsonb)
returns table(entry_id text,journal_number text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_line jsonb;v_debit numeric:=0;v_credit numeric:=0;v_existing public.journal_entries%rowtype;v_seq bigint;v_entry_id text;v_no int:=0;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_year !~ '^(19|20|21)[0-9]{2}$' or p_posting_date<>(p_year||'-01-01')::date then raise exception 'INVALID_OPENING_BALANCE_DATE'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'INVALID_OPENING_BALANCE'; end if;
  select * into v_existing from public.journal_entries j where j.company_id=p_company_id and j.source_type='opening-balance' and j.source_id=p_year limit 1;
  if found then return query select v_existing.id,v_existing.series||v_existing.journal_number,true;return;end if;
  if exists(select 1 from public.journal_entries j where j.company_id=p_company_id and j.posting_date>=((p_year||'-01-01')::date) and j.posting_date<((p_year::int+1)::text||'-01-01')::date) then raise exception 'OPENING_BALANCE_REQUIRES_EMPTY_YEAR'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line->>'account') !~ '^[12][0-9]{3}$' then raise exception 'OPENING_BALANCE_ACCOUNT_NOT_ALLOWED'; end if;
    if (v_line->>'account') in ('1510','2440') then raise exception 'OPENING_BALANCE_SUBLEDGER_REQUIRED'; end if;
    if coalesce((v_line->>'debitOre')::bigint,0)<0 or coalesce((v_line->>'creditOre')::bigint,0)<0 then raise exception 'INVALID_OPENING_BALANCE'; end if;
    if (coalesce((v_line->>'debitOre')::bigint,0)=0 and coalesce((v_line->>'creditOre')::bigint,0)=0)
       or (coalesce((v_line->>'debitOre')::bigint,0)>0 and coalesce((v_line->>'creditOre')::bigint,0)>0) then raise exception 'INVALID_OPENING_BALANCE'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':IB:'||p_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'IB',p_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_entry_id='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'IB',v_seq::text,p_posting_date,'Ingående balans '||p_year,'opening-balance',p_year,v_uid);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_no:=v_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,v_no,v_line->>'account',left(coalesce(v_line->>'text',''),240),coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
  end loop;
  return query select v_entry_id,'IB'||v_seq,false;
end;
$$;
revoke all on function public.import_opening_balance(text,text,date,jsonb) from public,anon;
grant execute on function public.import_opening_balance(text,text,date,jsonb) to authenticated;

create or replace function public.correct_manual_accounting_entry(
  p_company_id text,p_entry_id text,p_posting_date date,p_reason text,p_replacement_lines jsonb default null
)
returns table(correction_id text,reversal_entry_id text,replacement_entry_id text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_original public.journal_entries%rowtype;v_reason text:=btrim(coalesce(p_reason,''));v_corr text;v_rev text;v_rep text:=null;
  v_year text:=to_char(p_posting_date,'YYYY');v_period text:=to_char(p_posting_date,'YYYY-MM');v_rev_seq bigint;v_rep_seq bigint;v_line record;v_no int:=0;v_json jsonb;v_d numeric:=0;v_c numeric:=0;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if char_length(v_reason)<5 or char_length(v_reason)>500 then raise exception 'CORRECTION_REASON_REQUIRED'; end if;
  select * into v_original from public.journal_entries j where j.company_id=p_company_id and j.id=p_entry_id for update;
  if not found then raise exception 'ENTRY_NOT_FOUND'; end if;
  if v_original.source_type not in ('manual','manual-journal') then raise exception 'SOURCE_CORRECTION_REQUIRED'; end if;
  if exists(select 1 from public.accounting_corrections c where c.company_id=p_company_id and c.original_entry_id=p_entry_id) then raise exception 'ENTRY_ALREADY_CORRECTED'; end if;
  if exists(select 1 from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=p_entry_id and l.account ~ '^(151|244)[0-9]$') then raise exception 'SOURCE_CORRECTION_REQUIRED'; end if;
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  if p_replacement_lines is not null then
    if jsonb_typeof(p_replacement_lines)<>'array' or jsonb_array_length(p_replacement_lines)<2 then raise exception 'INVALID_REPLACEMENT'; end if;
    for v_json in select value from jsonb_array_elements(p_replacement_lines) loop
      if (v_json->>'account') !~ '^[0-9]{4}$' or (v_json->>'account') ~ '^(151|244)[0-9]$' then raise exception 'SOURCE_CORRECTION_REQUIRED'; end if;
      if coalesce((v_json->>'debitOre')::bigint,0)<0 or coalesce((v_json->>'creditOre')::bigint,0)<0 then raise exception 'INVALID_REPLACEMENT'; end if;
      if (coalesce((v_json->>'debitOre')::bigint,0)=0 and coalesce((v_json->>'creditOre')::bigint,0)=0)
         or (coalesce((v_json->>'debitOre')::bigint,0)>0 and coalesce((v_json->>'creditOre')::bigint,0)>0) then raise exception 'INVALID_REPLACEMENT'; end if;
      v_d:=v_d+coalesce((v_json->>'debitOre')::numeric,0);v_c:=v_c+coalesce((v_json->>'creditOre')::numeric,0);
    end loop;
    if v_d<>v_c or v_d<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
  end if;
  v_corr='corr_'||replace(gen_random_uuid()::text,'-','');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':'||v_original.series||':'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,v_original.series,v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_rev_seq;
  v_rev='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_rev,p_company_id,v_original.series,v_rev_seq::text,p_posting_date,left('Motverifikation '||v_original.series||v_original.journal_number||' - '||v_reason,240),'accounting-correction-reversal',v_corr||':reversal',v_uid);
  for v_line in select * from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=p_entry_id order by l.line_number loop
    v_no:=v_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_rev,v_no,v_line.account,left('Rättelse av '||v_original.series||v_original.journal_number||': '||coalesce(v_line.description,v_original.description),240),v_line.credit_ore,v_line.debit_ore);
  end loop;
  if p_replacement_lines is not null then
    insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,v_original.series,v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_rep_seq;
    v_rep='entry_'||replace(gen_random_uuid()::text,'-','');v_no:=0;
    insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
    values(v_rep,p_company_id,v_original.series,v_rep_seq::text,p_posting_date,left('Rättelse '||v_original.series||v_original.journal_number||' - '||v_reason,240),'accounting-correction-replacement',v_corr||':replacement',v_uid);
    for v_json in select value from jsonb_array_elements(p_replacement_lines) loop
      v_no:=v_no+1;
      insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
      values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_rep,v_no,v_json->>'account',left(coalesce(v_json->>'text',''),240),coalesce((v_json->>'debitOre')::bigint,0),coalesce((v_json->>'creditOre')::bigint,0));
    end loop;
  end if;
  insert into public.accounting_corrections(id,company_id,original_entry_id,reversal_entry_id,replacement_entry_id,reason,created_by)
  values(v_corr,p_company_id,p_entry_id,v_rev,v_rep,v_reason,v_uid);
  return query select v_corr,v_rev,v_rep;
end;
$$;
revoke all on function public.correct_manual_accounting_entry(text,text,date,text,jsonb) from public,anon;
grant execute on function public.correct_manual_accounting_entry(text,text,date,text,jsonb) to authenticated;
