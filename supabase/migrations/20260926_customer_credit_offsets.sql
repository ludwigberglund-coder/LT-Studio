-- Source-linked customer credit offsets for Supabase UAT.
-- A credit note has already posted its 1510 effect. Offsetting the remaining
-- credit against another debit invoice therefore changes receivables allocation
-- only; it must not create a second ledger entry.

create table if not exists public.customer_credit_offsets (
  company_id text not null references public.companies(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  credit_invoice_id text not null,
  target_invoice_id text not null,
  amount_ore bigint not null check (amount_ore > 0),
  offset_date date not null,
  credit_remaining_before_ore bigint not null check (credit_remaining_before_ore < 0),
  credit_remaining_after_ore bigint not null check (credit_remaining_after_ore <= 0),
  target_remaining_before_ore bigint not null check (target_remaining_before_ore > 0),
  target_remaining_after_ore bigint not null check (target_remaining_after_ore >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(company_id,request_id),
  check (credit_invoice_id <> target_invoice_id),
  check (credit_remaining_after_ore = credit_remaining_before_ore + amount_ore),
  check (target_remaining_after_ore = target_remaining_before_ore - amount_ore),
  foreign key(company_id,credit_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,target_invoice_id) references public.invoices(company_id,id) on delete restrict
);
alter table public.customer_credit_offsets enable row level security;

create index if not exists customer_credit_offsets_credit_idx
on public.customer_credit_offsets(company_id,credit_invoice_id,created_at);

create index if not exists customer_credit_offsets_target_idx
on public.customer_credit_offsets(company_id,target_invoice_id,offset_date,created_at);

drop policy if exists "members read customer credit offsets" on public.customer_credit_offsets;
create policy "members read customer credit offsets"
on public.customer_credit_offsets for select to authenticated
using (
  (select auth.uid()) is not null
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=customer_credit_offsets.company_id
      and m.auth_user_id=(select auth.uid())
  )
);

drop policy if exists "UAT requires AAL2" on public.customer_credit_offsets;
create policy "UAT requires AAL2"
on public.customer_credit_offsets
as restrictive
for all
to authenticated
using (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
)
with check (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
);

revoke all on table public.customer_credit_offsets from public, anon, authenticated;
grant select on table public.customer_credit_offsets to authenticated;

-- These source tables were intended to be append-only from the browser.
-- Restore the least-privilege grants explicitly.
revoke all on table public.customer_invoice_credit_adjustments from authenticated;
grant select, insert on table public.customer_invoice_credit_adjustments to authenticated;
revoke all on table public.customer_credit_refunds from authenticated;
grant select, insert on table public.customer_credit_refunds to authenticated;

create or replace function lt_security.apply_customer_credit_offset(
  p_company_id text,
  p_request_id text,
  p_credit_invoice_id text,
  p_target_invoice_id text,
  p_offset_date date,
  p_amount_ore bigint
)
returns table(
  credit_invoice_id text,
  target_invoice_id text,
  amount_ore bigint,
  credit_remaining_ore bigint,
  target_remaining_ore bigint,
  status text
)
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_existing public.customer_credit_offsets%rowtype;
  v_credit public.invoices%rowtype;
  v_target public.invoices%rowtype;
  v_adjust public.customer_invoice_credit_adjustments%rowtype;
  v_credit_after bigint;
  v_target_after bigint;
  v_transaction_id text;
  v_period text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((select auth.jwt()->>'aal'),'aal1')<>'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not (select lt_security.session_within_personal_limit()) then raise exception 'SESSION_EXPIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_credit_invoice_id is null or p_target_invoice_id is null or p_credit_invoice_id=p_target_invoice_id then raise exception 'INVALID_OFFSET_TARGET'; end if;
  if p_amount_ore is null or p_amount_ore<=0 then raise exception 'INVALID_OFFSET_AMOUNT'; end if;
  if p_offset_date is null then raise exception 'INVALID_OFFSET_DATE'; end if;

  select * into v_existing
  from public.customer_credit_offsets o
  where o.company_id=p_company_id and o.request_id=p_request_id;
  if found then
    if v_existing.credit_invoice_id<>p_credit_invoice_id
       or v_existing.target_invoice_id<>p_target_invoice_id
       or v_existing.offset_date<>p_offset_date
       or v_existing.amount_ore<>p_amount_ore then
      raise exception 'CREDIT_OFFSET_IDEMPOTENCY_CONFLICT';
    end if;
    return query select
      v_existing.credit_invoice_id,
      v_existing.target_invoice_id,
      v_existing.amount_ore,
      v_existing.credit_remaining_after_ore,
      v_existing.target_remaining_after_ore,
      'duplicate'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_company_id||':customer-credit-offset:'||
      least(p_credit_invoice_id,p_target_invoice_id)||':'||
      greatest(p_credit_invoice_id,p_target_invoice_id),
      0
    )
  );

  select * into v_credit
  from public.invoices i
  where i.company_id=p_company_id and i.id=p_credit_invoice_id
  for update;
  if not found then raise exception 'CREDIT_INVOICE_NOT_FOUND'; end if;

  select * into v_target
  from public.invoices i
  where i.company_id=p_company_id and i.id=p_target_invoice_id
  for update;
  if not found then raise exception 'TARGET_INVOICE_NOT_FOUND'; end if;

  select * into v_adjust
  from public.customer_invoice_credit_adjustments a
  where a.company_id=p_company_id and a.credit_invoice_id=p_credit_invoice_id;
  if not found then raise exception 'CREDIT_ADJUSTMENT_NOT_FOUND'; end if;

  if exists(
    select 1 from public.customer_credit_refunds r
    where r.company_id=p_company_id and r.credit_invoice_id=p_credit_invoice_id
  ) then raise exception 'CUSTOMER_CREDIT_ALREADY_REFUNDED'; end if;

  if v_credit.total_ore>=0 or v_credit.remaining_ore>=0 or v_credit.invoice_account<>'1510' then
    raise exception 'CREDIT_INVOICE_NOT_OPEN';
  end if;
  if v_target.total_ore<=0 or v_target.remaining_ore<=0 or v_target.invoice_account<>'1510' then
    raise exception 'TARGET_INVOICE_NOT_OPEN';
  end if;
  if v_credit.customer_id<>v_target.customer_id then raise exception 'CREDIT_OFFSET_CUSTOMER_MISMATCH'; end if;
  if p_target_invoice_id=v_adjust.original_invoice_id then raise exception 'CREDIT_OFFSET_ORIGINAL_ALREADY_HANDLED'; end if;

  if p_offset_date<greatest(v_credit.posting_date,v_target.posting_date) or p_offset_date>current_date then
    raise exception 'INVALID_OFFSET_DATE';
  end if;
  v_period:=to_char(p_offset_date,'YYYY-MM');
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  if p_amount_ore>least(-v_credit.remaining_ore,v_target.remaining_ore) then
    raise exception 'CREDIT_OFFSET_AMOUNT_EXCEEDS_AVAILABLE';
  end if;

  v_credit_after:=v_credit.remaining_ore+p_amount_ore;
  v_target_after:=v_target.remaining_ore-p_amount_ore;

  insert into public.customer_credit_offsets(
    company_id,request_id,credit_invoice_id,target_invoice_id,amount_ore,offset_date,
    credit_remaining_before_ore,credit_remaining_after_ore,
    target_remaining_before_ore,target_remaining_after_ore,created_by
  ) values(
    p_company_id,p_request_id,p_credit_invoice_id,p_target_invoice_id,p_amount_ore,p_offset_date,
    v_credit.remaining_ore,v_credit_after,v_target.remaining_ore,v_target_after,v_uid
  );

  v_transaction_id:='transaction_'||replace(gen_random_uuid()::text,'-','');
  insert into public.invoice_transactions(
    id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,
    journal_number,amount_ore,approved,account,bank_reference
  ) values(
    v_transaction_id,p_company_id,p_target_invoice_id,'credit-offset','Kreditfaktura',p_offset_date,p_offset_date,
    v_credit.journal_number,-p_amount_ore,true,'1510','credit-offset:'||p_request_id
  );

  update public.invoices i
  set remaining_ore=v_credit_after,
      status=case when v_credit_after=0 then 'Kreditfaktura · kvittad' else i.status end,
      updated_at=now()
  where i.company_id=p_company_id
    and i.id=p_credit_invoice_id
    and i.remaining_ore=v_credit.remaining_ore
    and i.total_ore=v_credit.total_ore;
  if not found then raise exception 'CREDIT_OFFSET_BALANCE_CHANGED'; end if;

  update public.invoices i
  set remaining_ore=v_target_after,
      status=case when v_target_after=0 then 'Kvittad' else i.status end,
      updated_at=now()
  where i.company_id=p_company_id
    and i.id=p_target_invoice_id
    and i.remaining_ore=v_target.remaining_ore
    and i.total_ore=v_target.total_ore;
  if not found then raise exception 'CREDIT_OFFSET_BALANCE_CHANGED'; end if;

  return query select
    p_credit_invoice_id,p_target_invoice_id,p_amount_ore,
    v_credit_after,v_target_after,'offset'::text;
end;
$function$;

revoke all on function lt_security.apply_customer_credit_offset(text,text,text,text,date,bigint) from public, anon;
grant execute on function lt_security.apply_customer_credit_offset(text,text,text,text,date,bigint) to authenticated;

create or replace function public.offset_customer_credit(
  p_company_id text,
  p_request_id text,
  p_credit_invoice_id text,
  p_target_invoice_id text,
  p_offset_date date,
  p_amount_ore bigint
)
returns table(
  credit_invoice_id text,
  target_invoice_id text,
  amount_ore bigint,
  credit_remaining_ore bigint,
  target_remaining_ore bigint,
  status text
)
language sql
security invoker
set search_path=''
as $function$
  select * from lt_security.apply_customer_credit_offset(
    p_company_id,p_request_id,p_credit_invoice_id,p_target_invoice_id,p_offset_date,p_amount_ore
  );
$function$;

revoke all on function public.offset_customer_credit(text,text,text,text,date,bigint) from public, anon;
grant execute on function public.offset_customer_credit(text,text,text,text,date,bigint) to authenticated;

-- Refunds now use the credit invoice's live negative balance. Historical credit
-- adjustment rows remain immutable; offsets are tracked in customer_credit_offsets.
create or replace function public.register_customer_credit_refund(
  p_company_id text,p_request_id text,p_credit_invoice_id text,p_refund_date date,
  p_refund_account text,p_bank_reference text
)
returns table(credit_invoice_id text,journal_number text,status text,amount_ore bigint)
language plpgsql
security invoker
set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_adjust public.customer_invoice_credit_adjustments%rowtype;
  v_credit_invoice public.invoices%rowtype;
  v_original public.invoices%rowtype;
  v_existing public.customer_credit_refunds%rowtype;
  v_period text;
  v_year text;
  v_seq bigint;
  v_entry_id text;
  v_transaction_id text;
  v_refund_amount bigint;
  v_offset_total bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_refund_account not in ('1920','1930','1940') then raise exception 'INVALID_CUSTOMER_REFUND_ACCOUNT'; end if;
  if char_length(btrim(coalesce(p_bank_reference,'')))<4 or char_length(btrim(p_bank_reference))>120 then
    raise exception 'CUSTOMER_REFUND_REFERENCE_REQUIRED';
  end if;

  select * into v_existing
  from public.customer_credit_refunds r
  where r.company_id=p_company_id and r.request_id=p_request_id;
  if found then
    if v_existing.credit_invoice_id<>p_credit_invoice_id
       or v_existing.refund_date<>p_refund_date
       or v_existing.refund_account<>p_refund_account
       or v_existing.bank_reference<>btrim(p_bank_reference) then
      raise exception 'REFUND_IDEMPOTENCY_CONFLICT';
    end if;
    select i.* into v_credit_invoice
    from public.invoices i
    where i.company_id=p_company_id and i.id=p_credit_invoice_id;
    return query select p_credit_invoice_id,v_credit_invoice.journal_number,'duplicate'::text,v_existing.amount_ore;
    return;
  end if;

  select * into v_adjust
  from public.customer_invoice_credit_adjustments a
  where a.company_id=p_company_id and a.credit_invoice_id=p_credit_invoice_id
  for update;
  if not found then raise exception 'CREDIT_ADJUSTMENT_NOT_FOUND'; end if;

  if exists(
    select 1 from public.customer_credit_refunds r
    where r.company_id=p_company_id and r.credit_invoice_id=p_credit_invoice_id
  ) then raise exception 'CUSTOMER_REFUND_ALREADY_REGISTERED'; end if;
  if exists(
    select 1 from public.invoice_transactions t
    where t.company_id=p_company_id and t.bank_reference=btrim(p_bank_reference)
  ) then raise exception 'CUSTOMER_REFUND_REFERENCE_CONFLICT'; end if;

  select * into v_credit_invoice
  from public.invoices i
  where i.company_id=p_company_id and i.id=p_credit_invoice_id
  for update;
  select * into v_original
  from public.invoices i
  where i.company_id=p_company_id and i.id=v_adjust.original_invoice_id;
  if v_credit_invoice.id is null or v_original.id is null then raise exception 'CREDIT_ADJUSTMENT_NOT_FOUND'; end if;

  if v_credit_invoice.total_ore>=0 or v_credit_invoice.remaining_ore>=0 then
    raise exception 'CUSTOMER_REFUND_NOT_REQUIRED';
  end if;
  v_refund_amount:=-v_credit_invoice.remaining_ore;
  select coalesce(sum(o.amount_ore),0) into v_offset_total
  from public.customer_credit_offsets o
  where o.company_id=p_company_id and o.credit_invoice_id=p_credit_invoice_id;
  if v_adjust.refund_due_ore<>v_refund_amount+v_offset_total then
    raise exception 'CREDIT_REFUND_BALANCE_MISMATCH';
  end if;

  if p_refund_date<v_credit_invoice.posting_date or p_refund_date>current_date then
    raise exception 'INVALID_REFUND_DATE';
  end if;
  v_period:=to_char(p_refund_date,'YYYY-MM');
  v_year:=to_char(p_refund_date,'YYYY');
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(p_company_id,'A',v_year,1)
  on conflict(company_id,series,fiscal_year)
  do update set last_number=public.accounting_sequences.last_number+1
  returning last_number into v_seq;

  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  v_transaction_id:='transaction_'||replace(gen_random_uuid()::text,'-','');

  insert into public.journal_entries(
    id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by
  ) values(
    v_entry_id,p_company_id,'A',v_seq::text,p_refund_date,
    left('Återbetalning kreditfaktura '||v_credit_invoice.invoice_number,240),
    'customer-credit-refund',p_credit_invoice_id,v_uid
  );

  insert into public.journal_lines(
    id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore
  ) values
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,1,'1510',
      'Reglera kundkredit '||v_credit_invoice.invoice_number,v_refund_amount,0),
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,2,p_refund_account,
      left('Återbetalning till '||coalesce((
        select c.name from public.customers c
        where c.company_id=p_company_id and c.id=v_original.customer_id
      ),'kund'),240),0,v_refund_amount);

  insert into public.invoice_transactions(
    id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,
    journal_number,amount_ore,approved,account,bank_reference
  ) values(
    v_transaction_id,p_company_id,p_credit_invoice_id,'refund','Bank',p_refund_date,p_refund_date,
    'A'||v_seq,v_refund_amount,true,p_refund_account,btrim(p_bank_reference)
  );

  update public.invoices i
  set remaining_ore=0,status='Kreditfaktura · återbetald',updated_at=now()
  where i.company_id=p_company_id
    and i.id=p_credit_invoice_id
    and i.remaining_ore=-v_refund_amount;
  if not found then raise exception 'CREDIT_REFUND_BALANCE_MISMATCH'; end if;

  insert into public.customer_credit_refunds(
    company_id,request_id,credit_invoice_id,original_invoice_id,amount_ore,refund_date,
    refund_account,bank_reference,accounting_entry_id,invoice_transaction_id,created_by
  ) values(
    p_company_id,p_request_id,p_credit_invoice_id,v_adjust.original_invoice_id,v_refund_amount,p_refund_date,
    p_refund_account,btrim(p_bank_reference),v_entry_id,v_transaction_id,v_uid
  );

  return query select p_credit_invoice_id,'A'||v_seq,'registered'::text,v_refund_amount;
end;
$function$;

revoke all on function public.register_customer_credit_refund(text,text,text,date,text,text) from public, anon;
grant execute on function public.register_customer_credit_refund(text,text,text,date,text,text) to authenticated;
