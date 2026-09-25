-- Applied to Supabase UAT on 2026-09-25.
-- Supplier payment lifecycle: prepare -> release -> confirm/post.

create table if not exists public.supplier_payments (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  supplier_invoice_id text not null,
  payment_date date not null,
  amount_ore bigint not null check (amount_ore>0),
  account text not null check (account ~ '^[0-9]{4}$'),
  status text not null check (status in ('prepared','released','paid','cancelled')),
  prepared_by uuid not null references auth.users(id),
  released_by uuid references auth.users(id),
  released_at timestamptz,
  recipient_name text,
  recipient_bankgiro text,
  recipient_plusgiro text,
  confirmation_reference text,
  accounting_entry_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id,supplier_invoice_id) references public.supplier_invoices(company_id,id) on delete restrict,
  unique(company_id,supplier_invoice_id)
);
alter table public.supplier_payments enable row level security;

create index if not exists supplier_payments_company_date_idx on public.supplier_payments(company_id,payment_date,status);
create index if not exists supplier_payments_prepared_by_idx on public.supplier_payments(prepared_by);
create index if not exists supplier_payments_released_by_idx on public.supplier_payments(released_by);

create policy "members can read supplier payments" on public.supplier_payments for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members manage supplier payments" on public.supplier_payments for all to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists (select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create or replace function public.prepare_supplier_payment(p_invoice_id text,p_payment_date date,p_account text default '1930')
returns table(payment_id text,status text,payment_date date,amount_ore bigint)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_company_id text; v_status text; v_amount bigint; v_liability text;
  v_supplier_id text; v_name text; v_bg text; v_pg text; v_existing public.supplier_payments%rowtype; v_payment_id text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_account !~ '^[0-9]{4}$' then raise exception 'INVALID_PAYMENT_ACCOUNT'; end if;
  if p_payment_date is null then raise exception 'INVALID_PAYMENT_DATE'; end if;
  select i.company_id,i.status,i.remaining_ore,i.liability_accounting_entry_id,i.supplier_id
    into v_company_id,v_status,v_amount,v_liability,v_supplier_id
  from public.supplier_invoices i where i.id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not exists (select 1 from public.company_memberships m where m.company_id=v_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_existing from public.supplier_payments p where p.company_id=v_company_id and p.supplier_invoice_id=p_invoice_id;
  if found then
    if v_existing.payment_date=p_payment_date and v_existing.account=p_account and v_existing.amount_ore=v_amount then
      return query select v_existing.id,v_existing.status,v_existing.payment_date,v_existing.amount_ore; return;
    end if;
    raise exception 'PAYMENT_ALREADY_EXISTS';
  end if;
  if v_status<>'approved' then raise exception 'INVOICE_NOT_APPROVED'; end if;
  if v_liability is null then raise exception 'INVOICE_LIABILITY_NOT_POSTED'; end if;
  if v_amount<=0 then raise exception 'INVALID_OPEN_AMOUNT'; end if;
  select s.name,s.bankgiro,s.plusgiro into v_name,v_bg,v_pg from public.suppliers s where s.company_id=v_company_id and s.id=v_supplier_id;
  if not found then raise exception 'SUPPLIER_NOT_FOUND'; end if;
  if coalesce(v_bg,'')='' and coalesce(v_pg,'')='' then raise exception 'SUPPLIER_PAYMENT_DETAILS_MISSING'; end if;
  v_payment_id:='spay_'||replace(gen_random_uuid()::text,'-','');
  insert into public.supplier_payments(id,company_id,supplier_invoice_id,payment_date,amount_ore,account,status,prepared_by,recipient_name,recipient_bankgiro,recipient_plusgiro)
  values(v_payment_id,v_company_id,p_invoice_id,p_payment_date,v_amount,p_account,'prepared',v_uid,v_name,v_bg,v_pg);
  update public.supplier_invoices i set status='payment-prepared',updated_at=now() where i.id=p_invoice_id and i.company_id=v_company_id and i.status='approved';
  if not found then raise exception 'PAYMENT_PREPARE_CONFLICT'; end if;
  return query select v_payment_id,'prepared'::text,p_payment_date,v_amount;
end;
$$;
revoke all on function public.prepare_supplier_payment(text,date,text) from public,anon;
grant execute on function public.prepare_supplier_payment(text,date,text) to authenticated;

create or replace function public.release_supplier_payment(p_payment_id text)
returns table(payment_id text,status text,released_by uuid,released_at timestamptz)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_company_id text; v_status text; v_released_by uuid; v_released_at timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select p.company_id,p.status,p.released_by,p.released_at into v_company_id,v_status,v_released_by,v_released_at from public.supplier_payments p where p.id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public.company_memberships m where m.company_id=v_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if v_status in ('released','paid') then return query select p.id,p.status,p.released_by,p.released_at from public.supplier_payments p where p.id=p_payment_id; return; end if;
  if v_status<>'prepared' then raise exception 'INVALID_PAYMENT_STATUS'; end if;
  update public.supplier_payments p set status='released',released_by=v_uid,released_at=now(),updated_at=now() where p.id=p_payment_id and p.company_id=v_company_id and p.status='prepared';
  if not found then raise exception 'PAYMENT_RELEASE_CONFLICT'; end if;
  return query select p.id,p.status,p.released_by,p.released_at from public.supplier_payments p where p.id=p_payment_id;
end;
$$;
revoke all on function public.release_supplier_payment(text) from public,anon;
grant execute on function public.release_supplier_payment(text) to authenticated;

create or replace function public.confirm_supplier_payment(p_payment_id text,p_confirmation_reference text,p_posting_date date)
returns table(payment_id text,status text,entry_id text,series text,journal_number text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_company_id text; v_status text; v_invoice_id text; v_amount bigint; v_account text;
  v_existing_entry text; v_existing_ref text; v_period text; v_year text; v_series text:='A'; v_seq bigint; v_entry_id text; v_invoice_number text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(p_confirmation_reference,'')))<2 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
  if p_posting_date is null then raise exception 'INVALID_POSTING_DATE'; end if;
  select p.company_id,p.status,p.supplier_invoice_id,p.amount_ore,p.account,p.accounting_entry_id,p.confirmation_reference
    into v_company_id,v_status,v_invoice_id,v_amount,v_account,v_existing_entry,v_existing_ref
  from public.supplier_payments p where p.id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if not exists (select 1 from public.company_memberships m where m.company_id=v_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if v_status='paid' then
    if v_existing_ref is distinct from btrim(p_confirmation_reference) then raise exception 'PAYMENT_CONFIRMATION_CONFLICT'; end if;
    return query select p.id,p.status,j.id,j.series,j.journal_number from public.supplier_payments p join public.journal_entries j on j.id=p.accounting_entry_id and j.company_id=p.company_id where p.id=p_payment_id; return;
  end if;
  if v_status<>'released' then raise exception 'PAYMENT_NOT_RELEASED'; end if;
  select i.supplier_invoice_number into v_invoice_number from public.supplier_invoices i where i.company_id=v_company_id and i.id=v_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  v_period:=to_char(p_posting_date,'YYYY-MM'); v_year:=to_char(p_posting_date,'YYYY');
  if exists (select 1 from public.accounting_periods ap where ap.company_id=v_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id||':'||v_series||':'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(v_company_id,v_series,v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1
  returning last_number into v_seq;
  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,v_company_id,v_series,v_seq::text,p_posting_date,left('Betalning leverantörsfaktura '||v_invoice_number,240),'supplier-payment',p_payment_id,v_uid);
  insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
  values
    ('jline_'||replace(gen_random_uuid()::text,'-',''),v_company_id,v_entry_id,1,'2440','Leverantörsskuld',v_amount,0),
    ('jline_'||replace(gen_random_uuid()::text,'-',''),v_company_id,v_entry_id,2,v_account,'Bankbetalning',0,v_amount);
  update public.supplier_payments p set status='paid',confirmation_reference=btrim(p_confirmation_reference),accounting_entry_id=v_entry_id,paid_at=now(),updated_at=now()
  where p.id=p_payment_id and p.company_id=v_company_id and p.status='released';
  if not found then raise exception 'PAYMENT_CONFIRMATION_CONFLICT'; end if;
  update public.supplier_invoices i set status='paid',remaining_ore=0,updated_at=now()
  where i.id=v_invoice_id and i.company_id=v_company_id and i.status='payment-prepared' and i.remaining_ore=v_amount;
  if not found then raise exception 'INVOICE_PAYMENT_CONFLICT'; end if;
  return query select p_payment_id,'paid'::text,v_entry_id,v_series,v_seq::text;
end;
$$;
revoke all on function public.confirm_supplier_payment(text,text,date) from public,anon;
grant execute on function public.confirm_supplier_payment(text,text,date) to authenticated;
