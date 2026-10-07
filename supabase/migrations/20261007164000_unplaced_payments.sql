-- Oplacerade betalningar: controlled manual resolution of unmatched bank events.
create table if not exists public.unplaced_payment_resolutions(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  bank_payment_id text not null,
  resolution_type text not null check (resolution_type in ('other-income','outgoing')),
  counter_account text not null check (counter_account ~ '^[0-9]{4}$'),
  description text not null,
  accounting_entry_id text not null,
  request_id text not null,
  resolved_by uuid not null references auth.users(id),
  resolved_at timestamptz not null default now(),
  unique(company_id,bank_payment_id),
  unique(company_id,request_id),
  foreign key(company_id,bank_payment_id) references public.bank_payments(company_id,id) on delete restrict,
  foreign key(company_id,accounting_entry_id) references public.journal_entries(company_id,id) on delete restrict
);
alter table public.unplaced_payment_resolutions enable row level security;
create policy "members read unplaced payment resolutions" on public.unplaced_payment_resolutions for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=unplaced_payment_resolutions.company_id and m.auth_user_id=(select auth.uid())));
revoke all on public.unplaced_payment_resolutions from public,anon;
revoke insert,update,delete on public.unplaced_payment_resolutions from authenticated;
grant select on public.unplaced_payment_resolutions to authenticated;

create or replace function public.resolve_unplaced_bank_payment(
  p_company_id text,p_bank_payment_id text,p_resolution_type text,p_counter_account text,p_description text,p_request_id text
)
returns table(resolution_id text,journal_number text,duplicate boolean)
language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_bank public.bank_payments%rowtype;v_existing public.unplaced_payment_resolutions%rowtype;
  v_entry public.journal_entries%rowtype;v_entry_id text;v_resolution_id text;v_seq bigint;v_year text;v_description text:=btrim(coalesce(p_description,''));
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_resolution_type not in ('other-income','outgoing') then raise exception 'INVALID_RESOLUTION_TYPE'; end if;
  if coalesce(p_counter_account,'') !~ '^[0-9]{4}$' then raise exception 'INVALID_COUNTER_ACCOUNT'; end if;
  if p_counter_account in ('1510','1930','2440') then raise exception 'SUBLEDGER_ACCOUNT_BLOCKED'; end if;
  if char_length(v_description)<3 or char_length(v_description)>240 then raise exception 'INVALID_DESCRIPTION'; end if;
  if coalesce(p_request_id,'') !~ '^[A-Za-z0-9._:-]{8,180}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  select * into v_existing from public.unplaced_payment_resolutions r where r.company_id=p_company_id and r.request_id=p_request_id;
  if found then
    if v_existing.bank_payment_id<>p_bank_payment_id or v_existing.resolution_type<>p_resolution_type or v_existing.counter_account<>p_counter_account or v_existing.description<>v_description then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into v_entry from public.journal_entries j where j.company_id=p_company_id and j.id=v_existing.accounting_entry_id;
    return query select v_existing.id,v_entry.series||v_entry.journal_number,true;return;
  end if;
  if exists(select 1 from public.unplaced_payment_resolutions r where r.company_id=p_company_id and r.bank_payment_id=p_bank_payment_id) then raise exception 'BANK_PAYMENT_ALREADY_RESOLVED'; end if;
  select * into v_bank from public.bank_payments b where b.company_id=p_company_id and b.id=p_bank_payment_id for update;
  if not found then raise exception 'BANK_PAYMENT_NOT_FOUND'; end if;
  if v_bank.status<>'unmatched' then raise exception 'INVALID_BANK_PAYMENT_STATUS'; end if;
  if v_bank.currency<>'SEK' then raise exception 'UNSUPPORTED_CURRENCY'; end if;
  if exists(select 1 from public.accounting_periods p where p.company_id=p_company_id and p.period=to_char(v_bank.booking_date,'YYYY-MM') and p.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  v_year=extract(year from v_bank.booking_date)::text;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'A',v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_entry_id='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'A',v_seq::text,v_bank.booking_date,v_description,'unplaced-bank-payment',v_bank.id,v_uid);
  if p_resolution_type='outgoing' then
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore) values
      ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,1,p_counter_account,v_description,v_bank.amount_ore,0),
      ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,2,'1930','Utbetalning från bank',0,v_bank.amount_ore);
  else
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore) values
      ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,1,'1930','Bankinbetalning',v_bank.amount_ore,0),
      ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,2,p_counter_account,v_description,0,v_bank.amount_ore);
  end if;
  update public.bank_payments set status='posted',updated_at=now() where company_id=p_company_id and id=v_bank.id and status='unmatched';
  if not found then raise exception 'BANK_PAYMENT_CONFLICT'; end if;
  v_resolution_id='unplaced_'||replace(gen_random_uuid()::text,'-','');
  insert into public.unplaced_payment_resolutions(id,company_id,bank_payment_id,resolution_type,counter_account,description,accounting_entry_id,request_id,resolved_by)
  values(v_resolution_id,p_company_id,v_bank.id,p_resolution_type,p_counter_account,v_description,v_entry_id,p_request_id,v_uid);
  return query select v_resolution_id,'A'||v_seq,false;
end;
$$;
revoke all on function public.resolve_unplaced_bank_payment(text,text,text,text,text,text) from public,anon;
grant execute on function public.resolve_unplaced_bank_payment(text,text,text,text,text,text) to authenticated;
