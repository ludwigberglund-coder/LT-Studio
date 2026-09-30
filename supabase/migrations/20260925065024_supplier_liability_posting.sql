-- Applied to Supabase UAT on 2026-09-25.
-- Atomic supplier liability posting with period + sequence protection.

create table if not exists public.accounting_periods (
  company_id text not null references public.companies(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null default 'open' check (status in ('open','locked')),
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  primary key(company_id,period)
);
alter table public.accounting_periods enable row level security;

create table if not exists public.accounting_sequences (
  company_id text not null references public.companies(id) on delete cascade,
  series text not null check (series ~ '^[A-Z][A-Z0-9]{0,3}$'),
  fiscal_year text not null check (fiscal_year ~ '^[0-9]{4}$'),
  last_number bigint not null default 0 check (last_number>=0),
  primary key(company_id,series,fiscal_year)
);
alter table public.accounting_sequences enable row level security;

create policy "members can read accounting periods" on public.accounting_periods for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members manage accounting periods" on public.accounting_periods for all to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists (select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create policy "members can read accounting sequences" on public.accounting_sequences for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members manage accounting sequences" on public.accounting_sequences for all to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists (select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create or replace function public.post_supplier_invoice_liability(p_invoice_id text)
returns table(entry_id text,series text,journal_number text,posting_date date,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_company_id text; v_status text; v_posting_date date; v_invoice_number text;
  v_coding jsonb; v_existing_entry text; v_period text; v_year text; v_series text:='A'; v_seq bigint;
  v_entry_id text; v_line jsonb; v_line_no integer:=0; v_debit numeric:=0; v_credit numeric:=0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select i.company_id,i.status,i.posting_date,i.supplier_invoice_number,i.coding_json,i.liability_accounting_entry_id
    into v_company_id,v_status,v_posting_date,v_invoice_number,v_coding,v_existing_entry
  from public.supplier_invoices i where i.id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not exists (select 1 from public.company_memberships m where m.company_id=v_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if v_existing_entry is not null then return query select j.id,j.series,j.journal_number,j.posting_date,'duplicate'::text from public.journal_entries j where j.company_id=v_company_id and j.id=v_existing_entry; return; end if;
  if v_status<>'approved' then raise exception 'INVOICE_NOT_APPROVED'; end if;
  if jsonb_typeof(v_coding)<>'array' or jsonb_array_length(v_coding)<2 then raise exception 'CODING_REQUIRED'; end if;
  for v_line in select value from jsonb_array_elements(v_coding) loop
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_CODING'; end if;
  v_period:=to_char(v_posting_date,'YYYY-MM'); v_year:=to_char(v_posting_date,'YYYY');
  if exists (select 1 from public.accounting_periods p where p.company_id=v_company_id and p.period=v_period and p.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id||':'||v_series||':'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(v_company_id,v_series,v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1
  returning last_number into v_seq;
  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,v_company_id,v_series,v_seq::text,v_posting_date,left('Leverantörsfaktura '||v_invoice_number,240),'supplier-invoice',p_invoice_id,v_uid);
  for v_line in select value from jsonb_array_elements(v_coding) loop
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),v_company_id,v_entry_id,v_line_no,v_line->>'account',left(coalesce(v_line->>'text',''),240),coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
  end loop;
  update public.supplier_invoices i set liability_accounting_entry_id=v_entry_id,liability_posted_at=now(),updated_at=now()
  where i.id=p_invoice_id and i.company_id=v_company_id and i.liability_accounting_entry_id is null;
  if not found then raise exception 'LIABILITY_POST_CONFLICT'; end if;
  return query select v_entry_id,v_series,v_seq::text,v_posting_date,'posted'::text;
end;
$$;
revoke all on function public.post_supplier_invoice_liability(text) from public, anon;
grant execute on function public.post_supplier_invoice_liability(text) to authenticated;
