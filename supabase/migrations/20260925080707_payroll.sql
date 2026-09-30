-- Applied to Supabase UAT on 2026-09-25.
-- Aggregated payroll journals only: no individual employee data.

create table if not exists public.payroll_runs(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  period text not null check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pay_date date not null,
  source_name text not null check(char_length(source_name) between 1 and 120),
  gross_salary_ore bigint not null check(gross_salary_ore>=0),
  withheld_tax_ore bigint not null check(withheld_tax_ore>=0),
  employer_contributions_ore bigint not null check(employer_contributions_ore>=0),
  net_pay_ore bigint not null check(net_pay_ore>=0),
  vacation_liability_change_ore bigint not null default 0,
  lines_json jsonb not null,
  journal_sha256 text not null check(journal_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('validated','posted','rejected')),
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  posted_by uuid references auth.users(id),
  posted_at timestamptz,
  accounting_entry_id text,
  unique(company_id,period,source_name,journal_sha256),
  unique(company_id,id),
  foreign key(company_id,accounting_entry_id) references public.journal_entries(company_id,id) on delete restrict
);
alter table public.payroll_runs enable row level security;
create index if not exists payroll_runs_company_period_idx on public.payroll_runs(company_id,period,status,imported_at desc);
create index if not exists payroll_runs_imported_by_idx on public.payroll_runs(imported_by);
create index if not exists payroll_runs_posted_by_idx on public.payroll_runs(posted_by);
create index if not exists payroll_runs_accounting_entry_idx on public.payroll_runs(company_id,accounting_entry_id);

create policy "members read payroll runs" on public.payroll_runs for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=payroll_runs.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert payroll runs" on public.payroll_runs for insert to authenticated
with check (imported_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=payroll_runs.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update payroll runs" on public.payroll_runs for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=payroll_runs.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=payroll_runs.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

revoke all on public.payroll_runs from anon;
grant select,insert,update on public.payroll_runs to authenticated;

create or replace function private.require_controlled_payroll_write()
returns trigger
language plpgsql security invoker set search_path=''
as $$
begin
  if coalesce(current_setting('app.controlled_payroll_write',true),'')<>'1' then raise exception 'DIRECT_PAYROLL_WRITE_BLOCKED'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists controlled_payroll_write_guard on public.payroll_runs;
create trigger controlled_payroll_write_guard before insert or update or delete on public.payroll_runs
for each row execute function private.require_controlled_payroll_write();

create or replace function public.import_payroll_run(
  p_company_id text,p_period text,p_pay_date date,p_source_name text,p_gross_salary_ore bigint,p_withheld_tax_ore bigint,
  p_employer_contributions_ore bigint,p_net_pay_ore bigint,p_vacation_liability_change_ore bigint,p_lines jsonb
)
returns table(payroll_run_id text,journal_sha256 text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_line jsonb;v_debit numeric:=0;v_credit numeric:=0;v_sha text;v_existing public.payroll_runs%rowtype;v_id text;
begin
  perform set_config('app.controlled_payroll_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or btrim(coalesce(p_source_name,''))='' or char_length(btrim(p_source_name))>120 then raise exception 'INVALID_PAYROLL_RUN'; end if;
  if p_gross_salary_ore<0 or p_withheld_tax_ore<0 or p_employer_contributions_ore<0 or p_net_pay_ore<0 then raise exception 'INVALID_PAYROLL_SUMMARY'; end if;
  if p_withheld_tax_ore>p_gross_salary_ore or p_net_pay_ore>p_gross_salary_ore then raise exception 'INVALID_PAYROLL_SUMMARY'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'INVALID_PAYROLL_LINES'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_PAYROLL_ACCOUNT'; end if;
    if coalesce((v_line->>'debitOre')::bigint,0)<0 or coalesce((v_line->>'creditOre')::bigint,0)<0 then raise exception 'INVALID_PAYROLL_AMOUNT'; end if;
    if (coalesce((v_line->>'debitOre')::bigint,0)=0 and coalesce((v_line->>'creditOre')::bigint,0)=0)
       or (coalesce((v_line->>'debitOre')::bigint,0)>0 and coalesce((v_line->>'creditOre')::bigint,0)>0) then raise exception 'INVALID_PAYROLL_AMOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_PAYROLL_JOURNAL'; end if;
  v_sha:=encode(extensions.digest(convert_to(p_lines::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.payroll_runs r where r.company_id=p_company_id and r.period=p_period and r.source_name=btrim(p_source_name) and r.journal_sha256=v_sha;
  if found then
    if v_existing.pay_date<>p_pay_date or v_existing.gross_salary_ore<>p_gross_salary_ore or v_existing.withheld_tax_ore<>p_withheld_tax_ore
       or v_existing.employer_contributions_ore<>p_employer_contributions_ore or v_existing.net_pay_ore<>p_net_pay_ore
       or v_existing.vacation_liability_change_ore<>p_vacation_liability_change_ore then raise exception 'PAYROLL_IMPORT_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id,v_existing.journal_sha256,v_existing.status,true;return;
  end if;
  v_id:='payroll_'||replace(gen_random_uuid()::text,'-','');
  insert into public.payroll_runs(id,company_id,period,pay_date,source_name,gross_salary_ore,withheld_tax_ore,employer_contributions_ore,net_pay_ore,vacation_liability_change_ore,lines_json,journal_sha256,status,imported_by)
  values(v_id,p_company_id,p_period,p_pay_date,btrim(p_source_name),p_gross_salary_ore,p_withheld_tax_ore,p_employer_contributions_ore,p_net_pay_ore,p_vacation_liability_change_ore,p_lines,v_sha,'validated',v_uid);
  return query select v_id,v_sha,'validated'::text,false;
end;
$$;
revoke all on function public.import_payroll_run(text,text,date,text,bigint,bigint,bigint,bigint,bigint,jsonb) from public,anon;
grant execute on function public.import_payroll_run(text,text,date,text,bigint,bigint,bigint,bigint,bigint,jsonb) to authenticated;

create or replace function public.post_payroll_run(p_company_id text,p_payroll_run_id text)
returns table(payroll_run_id text,journal_number text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_run public.payroll_runs%rowtype;v_period text;v_year text;v_seq bigint;v_entry_id text;v_line jsonb;v_line_no int:=0;v_debit numeric:=0;v_credit numeric:=0;
begin
  perform set_config('app.controlled_payroll_write','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_run from public.payroll_runs r where r.company_id=p_company_id and r.id=p_payroll_run_id for update;
  if not found then raise exception 'PAYROLL_RUN_NOT_FOUND'; end if;
  if v_run.status='posted' then
    if v_run.posted_by=v_uid and v_run.accounting_entry_id is not null
       and exists(select 1 from public.journal_entries j where j.company_id=p_company_id and j.id=v_run.accounting_entry_id and j.source_type='payroll-run' and j.source_id=v_run.id) then
      return query select v_run.id,(select j.series||j.journal_number from public.journal_entries j where j.company_id=p_company_id and j.id=v_run.accounting_entry_id),v_run.status,true;return;
    end if;
    raise exception 'PAYROLL_ALREADY_POSTED';
  end if;
  if v_run.status<>'validated' then raise exception 'INVALID_PAYROLL_STATUS'; end if;
  for v_line in select value from jsonb_array_elements(v_run.lines_json) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_PAYROLL_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_PAYROLL_JOURNAL'; end if;
  if encode(extensions.digest(convert_to(v_run.lines_json::text,'UTF8'),'sha256'),'hex')<>v_run.journal_sha256 then raise exception 'PAYROLL_POSTING_INTEGRITY_ERROR'; end if;
  v_period:=to_char(v_run.pay_date,'YYYY-MM');v_year:=to_char(v_run.pay_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  if exists(select 1 from public.journal_entries j where j.company_id=p_company_id and j.source_type='payroll-run' and j.source_id=v_run.id) then raise exception 'PAYROLL_ALREADY_POSTED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':L:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'L',v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'L',v_seq::text,v_run.pay_date,left('Lönejournal '||v_run.period||' – '||v_run.source_name,240),'payroll-run',v_run.id,v_uid);
  for v_line in select value from jsonb_array_elements(v_run.lines_json) loop
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,v_line_no,v_line->>'account',left(coalesce(v_line->>'text',''),240),
      coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
  end loop;
  update public.payroll_runs as r set status='posted',posted_by=v_uid,posted_at=now(),accounting_entry_id=v_entry_id
  where r.company_id=p_company_id and r.id=v_run.id and r.status='validated';
  if not found then raise exception 'PAYROLL_POSTING_CONFLICT'; end if;
  return query select v_run.id,'L'||v_seq,'posted'::text,false;
end;
$$;
revoke all on function public.post_payroll_run(text,text) from public,anon;
grant execute on function public.post_payroll_run(text,text) to authenticated;
