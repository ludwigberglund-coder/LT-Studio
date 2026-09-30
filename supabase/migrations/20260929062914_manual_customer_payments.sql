-- Manual customer payments staged through the existing financial batch approval flow.
-- GitHub source of truth: 2026-09-29.

create table if not exists public.customer_manual_payments (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  invoice_id text not null,
  customer_id text not null,
  amount_ore bigint not null check (amount_ore > 0),
  payment_date date not null,
  bank_account text not null check (bank_account ~ '^19[0-9]{2}$'),
  reference text,
  comment text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  batch_id text not null,
  accounting_entry_id text,
  invoice_transaction_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  unique(company_id,request_id),
  unique(company_id,batch_id),
  foreign key(company_id,invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references public.financial_batches(company_id,id) on delete restrict,
  foreign key(company_id,accounting_entry_id) references public.journal_entries(company_id,id) on delete restrict,
  foreign key(invoice_transaction_id) references public.invoice_transactions(id) on delete restrict
);

create index if not exists customer_manual_payments_invoice_idx
  on public.customer_manual_payments(company_id,invoice_id,created_at desc);
create index if not exists customer_manual_payments_status_idx
  on public.customer_manual_payments(company_id,status,created_at desc);

alter table public.customer_manual_payments enable row level security;

drop policy if exists customer_manual_payments_company_read on public.customer_manual_payments;
create policy customer_manual_payments_company_read
on public.customer_manual_payments
for select
to authenticated
using (
  exists(
    select 1
    from public.company_memberships m
    where m.company_id=customer_manual_payments.company_id
      and m.auth_user_id=auth.uid()
  )
);

revoke all on table public.customer_manual_payments from public,anon;
revoke insert,update,delete on table public.customer_manual_payments from authenticated;
grant select on table public.customer_manual_payments to authenticated;

create or replace function public.stage_manual_customer_payment(
  p_company_id text,
  p_request_id text,
  p_invoice_id text,
  p_payment_date date,
  p_amount_ore bigint,
  p_bank_account text,
  p_reference text default null,
  p_comment text default null
)
returns table(payment_id text,batch_id text,batch_number integer,status text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_invoice public.invoices%rowtype;
  v_customer public.customers%rowtype;
  v_existing public.customer_manual_payments%rowtype;
  v_existing_batch public.financial_batches%rowtype;
  v_pending bigint:=0;
  v_available bigint:=0;
  v_payment_id text;
  v_batch_id text;
  v_batch_no integer;
  v_tx_id text;
  v_reference text:=nullif(btrim(coalesce(p_reference,'')),'');
  v_comment text:=nullif(btrim(coalesce(p_comment,'')),'');
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.audit_event_write','1',true);

  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  if coalesce(p_request_id,'') !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_payment_date is null then raise exception 'INVALID_PAYMENT_DATE'; end if;
  if p_amount_ore is null or p_amount_ore<=0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
  if coalesce(p_bank_account,'') !~ '^19[0-9]{2}$' then raise exception 'INVALID_BANK_ACCOUNT'; end if;
  if char_length(coalesce(v_reference,''))>160 then raise exception 'PAYMENT_REFERENCE_TOO_LONG'; end if;
  if char_length(coalesce(v_comment,''))>1000 then raise exception 'PAYMENT_COMMENT_TOO_LONG'; end if;

  select * into v_existing
  from public.customer_manual_payments p
  where p.company_id=p_company_id and p.request_id=p_request_id;
  if found then
    if v_existing.invoice_id is distinct from p_invoice_id
       or v_existing.payment_date is distinct from p_payment_date
       or v_existing.amount_ore is distinct from p_amount_ore
       or v_existing.bank_account is distinct from p_bank_account
       or v_existing.reference is distinct from v_reference
       or v_existing.comment is distinct from v_comment then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_existing_batch
    from public.financial_batches b
    where b.company_id=p_company_id and b.id=v_existing.batch_id;
    return query select v_existing.id,v_existing.batch_id,v_existing_batch.batch_number,v_existing.status;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':manual-payment:'||p_invoice_id,0));

  select * into v_invoice
  from public.invoices i
  where i.company_id=p_company_id and i.id=p_invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.total_ore<=0 then raise exception 'PAYMENT_REQUIRES_DEBIT_INVOICE'; end if;
  if v_invoice.journal_number is null or v_invoice.status='Väntar på bunt' then raise exception 'INVOICE_NOT_POSTED'; end if;
  if v_invoice.remaining_ore<=0 then raise exception 'INVOICE_ALREADY_SETTLED'; end if;
  if coalesce(v_invoice.invoice_account,'') !~ '^[0-9]{4}$' then raise exception 'INVALID_RECEIVABLE_ACCOUNT'; end if;
  if p_bank_account=v_invoice.invoice_account then raise exception 'BANK_ACCOUNT_EQUALS_RECEIVABLE_ACCOUNT'; end if;

  select * into v_customer
  from public.customers c
  where c.company_id=p_company_id and c.id=v_invoice.customer_id;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  select coalesce(sum(p.amount_ore),0) into v_pending
  from public.customer_manual_payments p
  where p.company_id=p_company_id
    and p.invoice_id=p_invoice_id
    and p.status='pending';

  v_available:=v_invoice.remaining_ore-v_pending;
  if v_available<=0 then raise exception 'PAYMENT_ALREADY_PENDING'; end if;
  if p_amount_ore>v_available then
    raise exception 'PAYMENT_EXCEEDS_AVAILABLE_BALANCE:%',v_available;
  end if;

  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id
      and ap.period=to_char(p_payment_date,'YYYY-MM')
      and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':financial-batches',0));
  select coalesce(max(b.batch_number),9999)+1 into v_batch_no
  from public.financial_batches b
  where b.company_id=p_company_id;
  if v_batch_no>99999 then raise exception 'BATCH_NUMBER_EXHAUSTED'; end if;

  v_payment_id:='cmp_'||replace(gen_random_uuid()::text,'-','');
  v_batch_id:='batch_'||replace(gen_random_uuid()::text,'-','');
  v_tx_id:='btx_'||replace(gen_random_uuid()::text,'-','');

  insert into public.financial_batches(
    id,company_id,batch_number,title,status,kind,external_total_ore,transaction_count,
    total_debit_ore,total_credit_ore,control_state,created_by,updated_by,ready_by,ready_at
  ) values(
    v_batch_id,p_company_id,v_batch_no,
    left('Manuell kundinbetalning · '||v_invoice.invoice_number,160),
    'ready','manual',p_amount_ore,1,p_amount_ore,p_amount_ore,'balanced',
    v_uid,v_uid,v_uid,now()
  );

  insert into public.financial_batch_transactions(
    id,company_id,batch_id,transaction_number,sequence_number,posting_date,description,
    source_type,source_id,reference,external_amount_ore,journal_series
  ) values(
    v_tx_id,p_company_id,v_batch_id,lpad(v_batch_no::text,5,'0')||'-001',1,p_payment_date,
    left('Manuell kundinbetalning faktura '||v_invoice.invoice_number||' · '||v_customer.name,240),
    'customer-manual-payment',v_payment_id,v_reference,p_amount_ore,'A'
  );

  insert into public.financial_batch_lines(
    id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore
  ) values
  (
    'bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx_id,1,p_bank_account,
    left('Inbetalning '||v_invoice.invoice_number,240),p_amount_ore,0
  ),
  (
    'bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx_id,2,v_invoice.invoice_account,
    left('Kundfordran '||v_invoice.invoice_number,240),0,p_amount_ore
  );

  insert into public.customer_manual_payments(
    id,company_id,request_id,invoice_id,customer_id,amount_ore,payment_date,bank_account,
    reference,comment,status,batch_id,created_by
  ) values(
    v_payment_id,p_company_id,p_request_id,v_invoice.id,v_invoice.customer_id,p_amount_ore,
    p_payment_date,p_bank_account,v_reference,v_comment,'pending',v_batch_id,v_uid
  );

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,v_batch_id,v_uid,'MANUAL_CUSTOMER_PAYMENT_STAGED',
    jsonb_build_object(
      'paymentId',v_payment_id,'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,
      'customerId',v_invoice.customer_id,'customerNumber',v_customer.customer_number,
      'amountOre',p_amount_ore,'paymentDate',p_payment_date,'bankAccount',p_bank_account
    )
  );

  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    p_company_id,v_uid,'CUSTOMER_MANUAL_PAYMENT_STAGED','customer-manual-payment',v_payment_id,
    jsonb_build_object(
      'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,
      'customerId',v_customer.id,'customerNumber',v_customer.customer_number,'customerName',v_customer.name,
      'amountOre',p_amount_ore,'paymentDate',p_payment_date,'bankAccount',p_bank_account,
      'reference',v_reference,'comment',v_comment,'batchId',v_batch_id,'batchNumber',v_batch_no
    )
  );

  return query select v_payment_id,v_batch_id,v_batch_no,'pending'::text;
end;
$$;

revoke all on function public.stage_manual_customer_payment(text,text,text,date,bigint,text,text,text) from public,anon;
grant execute on function public.stage_manual_customer_payment(text,text,text,date,bigint,text,text,text) to authenticated;

create or replace function public.activate_customer_manual_payment_batch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.customer_manual_payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_customer public.customers%rowtype;
  v_tx public.financial_batch_transactions%rowtype;
  v_entry public.journal_entries%rowtype;
  v_invoice_tx_id text;
  v_new_remaining bigint;
  v_actor uuid:=auth.uid();
begin
  if old.status is not distinct from new.status then return new; end if;

  select * into v_payment
  from public.customer_manual_payments p
  where p.company_id=new.company_id and p.batch_id=new.id
  for update;
  if not found then return new; end if;

  perform set_config('app.audit_event_write','1',true);

  if old.status='ready' and new.status='approved' then
    if v_payment.status='approved' then return new; end if;
    if v_payment.status<>'pending' then raise exception 'MANUAL_PAYMENT_STATE_CONFLICT'; end if;

    select * into v_tx
    from public.financial_batch_transactions t
    where t.company_id=new.company_id
      and t.batch_id=new.id
      and t.source_type='customer-manual-payment'
      and t.source_id=v_payment.id
    order by t.sequence_number
    limit 1;
    if not found then raise exception 'MANUAL_PAYMENT_BATCH_TRANSACTION_MISSING'; end if;
    if v_tx.external_amount_ore is distinct from v_payment.amount_ore
       or v_tx.posting_date is distinct from v_payment.payment_date then
      raise exception 'MANUAL_PAYMENT_BATCH_INTEGRITY_ERROR'; end if;

    select * into v_entry
    from public.journal_entries j
    where j.company_id=new.company_id
      and j.source_type='financial-batch'
      and j.source_id=v_tx.id
    order by j.created_at desc
    limit 1;
    if not found then raise exception 'MANUAL_PAYMENT_JOURNAL_MISSING'; end if;

    if not exists(
      select 1 from public.journal_lines l
      where l.company_id=new.company_id and l.journal_entry_id=v_entry.id
        and l.account=v_payment.bank_account and l.debit_ore=v_payment.amount_ore and l.credit_ore=0
    ) or not exists(
      select 1
      from public.journal_lines l
      join public.invoices i on i.company_id=l.company_id and i.id=v_payment.invoice_id
      where l.company_id=new.company_id and l.journal_entry_id=v_entry.id
        and l.account=i.invoice_account and l.credit_ore=v_payment.amount_ore and l.debit_ore=0
    ) then raise exception 'MANUAL_PAYMENT_JOURNAL_INTEGRITY_ERROR'; end if;

    select * into v_invoice
    from public.invoices i
    where i.company_id=new.company_id and i.id=v_payment.invoice_id
    for update;
    if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
    if v_invoice.customer_id<>v_payment.customer_id then raise exception 'MANUAL_PAYMENT_CUSTOMER_MISMATCH'; end if;
    if v_invoice.remaining_ore<v_payment.amount_ore then raise exception 'PAYMENT_EXCEEDS_CURRENT_BALANCE'; end if;

    v_new_remaining:=v_invoice.remaining_ore-v_payment.amount_ore;
    update public.invoices i
    set remaining_ore=v_new_remaining,
        status=case when v_new_remaining=0 then 'Betald' else 'Delbetald' end,
        updated_at=now()
    where i.company_id=new.company_id and i.id=v_payment.invoice_id;

    v_invoice_tx_id:='itx_'||replace(gen_random_uuid()::text,'-','');
    insert into public.invoice_transactions(
      id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,
      batch_number,journal_number,amount_ore,approved,account,bank_reference
    ) values(
      v_invoice_tx_id,new.company_id,v_payment.invoice_id,'payment','Manuell bankinbetalning',
      v_payment.payment_date,v_payment.payment_date,lpad(new.batch_number::text,5,'0'),
      v_entry.series||v_entry.journal_number,-v_payment.amount_ore,true,v_payment.bank_account,v_payment.reference
    );

    update public.customer_manual_payments p
    set status='approved',accounting_entry_id=v_entry.id,invoice_transaction_id=v_invoice_tx_id,
        approved_by=v_actor,approved_at=now()
    where p.company_id=new.company_id and p.id=v_payment.id and p.status='pending';
    if not found then raise exception 'MANUAL_PAYMENT_APPROVAL_CONFLICT'; end if;

    select * into v_customer
    from public.customers c
    where c.company_id=new.company_id and c.id=v_payment.customer_id;

    insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
    values(
      new.company_id,v_actor,'CUSTOMER_MANUAL_PAYMENT_APPROVED','customer-manual-payment',v_payment.id,
      jsonb_build_object(
        'invoiceId',v_payment.invoice_id,'invoiceNumber',v_invoice.invoice_number,
        'customerId',v_payment.customer_id,'customerNumber',v_customer.customer_number,'customerName',v_customer.name,
        'amountOre',v_payment.amount_ore,'paymentDate',v_payment.payment_date,
        'bankAccount',v_payment.bank_account,'reference',v_payment.reference,
        'batchId',new.id,'batchNumber',new.batch_number,'accountingEntryId',v_entry.id,
        'invoiceTransactionId',v_invoice_tx_id,'remainingOre',v_new_remaining
      )
    );
    return new;
  end if;

  if old.status='ready' and new.status='rejected' then
    if v_payment.status<>'pending' then return new; end if;
    update public.customer_manual_payments p
    set status='rejected',rejected_by=v_actor,rejected_at=now(),rejection_reason='Bunten avvisades'
    where p.company_id=new.company_id and p.id=v_payment.id and p.status='pending';

    insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
    values(
      new.company_id,v_actor,'CUSTOMER_MANUAL_PAYMENT_REJECTED','customer-manual-payment',v_payment.id,
      jsonb_build_object(
        'invoiceId',v_payment.invoice_id,'amountOre',v_payment.amount_ore,'paymentDate',v_payment.payment_date,
        'batchId',new.id,'batchNumber',new.batch_number
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.activate_customer_manual_payment_batch() from public,anon,authenticated;

drop trigger if exists customer_manual_payment_batch_activation on public.financial_batches;
create trigger customer_manual_payment_batch_activation
after update of status on public.financial_batches
for each row
execute function public.activate_customer_manual_payment_batch();

create or replace function public.capture_customer_manual_payment_rejection()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.event_type='BATCH_REJECTED' then
    update public.customer_manual_payments p
    set rejection_reason=coalesce(nullif(new.details->>'reason',''),'Bunten avvisades')
    where p.company_id=new.company_id and p.batch_id=new.batch_id and p.status='rejected';
  end if;
  return new;
end;
$$;

revoke all on function public.capture_customer_manual_payment_rejection() from public,anon,authenticated;

drop trigger if exists customer_manual_payment_rejection_reason on public.financial_batch_events;
create trigger customer_manual_payment_rejection_reason
after insert on public.financial_batch_events
for each row
execute function public.capture_customer_manual_payment_rejection();

create or replace function public.protect_customer_manual_payment_batch_content()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_batch_id text;
begin
  v_batch_id:=case when tg_table_name='financial_batch_transactions' then old.batch_id else (
    select t.batch_id
    from public.financial_batch_transactions t
    where t.company_id=old.company_id and t.id=old.transaction_id
  ) end;
  if exists(
    select 1 from public.customer_manual_payments p
    where p.company_id=old.company_id and p.batch_id=v_batch_id and p.status='pending'
  ) then
    raise exception 'MANUAL_PAYMENT_BATCH_LOCKED';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_customer_manual_payment_batch_content() from public,anon,authenticated;

drop trigger if exists protect_customer_manual_payment_batch_transactions on public.financial_batch_transactions;
create trigger protect_customer_manual_payment_batch_transactions
before update or delete on public.financial_batch_transactions
for each row
execute function public.protect_customer_manual_payment_batch_content();

drop trigger if exists protect_customer_manual_payment_batch_lines on public.financial_batch_lines;
create trigger protect_customer_manual_payment_batch_lines
before update or delete on public.financial_batch_lines
for each row
execute function public.protect_customer_manual_payment_batch_content();

create or replace function public.protect_customer_manual_payment_batch_header()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(
    select 1 from public.customer_manual_payments p
    where p.company_id=old.company_id and p.batch_id=old.id and p.status='pending'
  ) then
    if tg_op='DELETE' then raise exception 'MANUAL_PAYMENT_BATCH_LOCKED'; end if;
    if old.status='ready' and new.status in ('approved','rejected') then return new; end if;
    raise exception 'MANUAL_PAYMENT_BATCH_LOCKED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.protect_customer_manual_payment_batch_header() from public,anon,authenticated;

drop trigger if exists protect_customer_manual_payment_batch_header on public.financial_batches;
create trigger protect_customer_manual_payment_batch_header
before update or delete on public.financial_batches
for each row
execute function public.protect_customer_manual_payment_batch_header();

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='customer_manual_payments'
     ) then
    alter publication supabase_realtime add table public.customer_manual_payments;
  end if;
end
$$;
