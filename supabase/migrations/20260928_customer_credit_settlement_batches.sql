-- Manual customer credit settlement through an approval-gated financial batch.
-- The receivables are changed only when the linked batch reaches approved.

create table if not exists public.customer_credit_settlements(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  request_id text not null,
  credit_invoice_id text not null,
  debit_invoice_id text not null,
  amount_ore bigint not null check(amount_ore>0),
  settlement_date date not null,
  batch_id text not null,
  status text not null default 'ready' check(status in ('ready','approved','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  unique(company_id,request_id),
  unique(company_id,batch_id),
  foreign key(company_id,credit_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,debit_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references public.financial_batches(company_id,id) on delete restrict,
  check(credit_invoice_id<>debit_invoice_id)
);

create index if not exists customer_credit_settlements_credit_idx
  on public.customer_credit_settlements(company_id,credit_invoice_id,status);
create index if not exists customer_credit_settlements_debit_idx
  on public.customer_credit_settlements(company_id,debit_invoice_id,status);

alter table public.customer_credit_settlements enable row level security;

drop policy if exists "members read customer credit settlements" on public.customer_credit_settlements;
create policy "members read customer credit settlements"
on public.customer_credit_settlements for select to authenticated
using (
  exists(
    select 1 from public.company_memberships m
    where m.company_id=customer_credit_settlements.company_id
      and m.auth_user_id=(select auth.uid())
  )
);

drop policy if exists "accounting members create customer credit settlements" on public.customer_credit_settlements;
create policy "accounting members create customer credit settlements"
on public.customer_credit_settlements for insert to authenticated
with check (
  created_by=(select auth.uid())
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=customer_credit_settlements.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

revoke all on public.customer_credit_settlements from anon;
grant select,insert on public.customer_credit_settlements to authenticated;

create or replace function public.stage_customer_credit_settlement(
  p_company_id text,
  p_request_id text,
  p_credit_invoice_id text,
  p_debit_invoice_id text,
  p_amount_ore bigint,
  p_settlement_date date
)
returns table(settlement_id text,batch_id text,batch_number integer,status text,amount_ore bigint)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_credit public.invoices%rowtype;
  v_debit public.invoices%rowtype;
  v_existing public.customer_credit_settlements%rowtype;
  v_created record;
  v_settlement_id text;
  v_pending_credit bigint:=0;
  v_pending_debit bigint:=0;
  v_credit_available bigint;
  v_debit_available bigint;
  v_title text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_credit_invoice_id=p_debit_invoice_id then raise exception 'CUSTOMER_SETTLEMENT_SAME_INVOICE'; end if;
  if p_amount_ore is null or p_amount_ore<=0 then raise exception 'INVALID_SETTLEMENT_AMOUNT'; end if;
  if p_settlement_date is null then raise exception 'INVALID_SETTLEMENT_DATE'; end if;

  select * into v_existing
  from public.customer_credit_settlements s
  where s.company_id=p_company_id and s.request_id=p_request_id;
  if found then
    if v_existing.credit_invoice_id<>p_credit_invoice_id
       or v_existing.debit_invoice_id<>p_debit_invoice_id
       or v_existing.amount_ore<>p_amount_ore
       or v_existing.settlement_date<>p_settlement_date then
      raise exception 'CUSTOMER_SETTLEMENT_IDEMPOTENCY_CONFLICT';
    end if;
    return query
    select v_existing.id,b.id,b.batch_number,v_existing.status,v_existing.amount_ore
    from public.financial_batches b
    where b.company_id=p_company_id and b.id=v_existing.batch_id;
    return;
  end if;

  -- Lock in stable order to avoid deadlocks when two users settle invoices concurrently.
  if p_credit_invoice_id<p_debit_invoice_id then
    select * into v_credit from public.invoices i
      where i.company_id=p_company_id and i.id=p_credit_invoice_id for update;
    select * into v_debit from public.invoices i
      where i.company_id=p_company_id and i.id=p_debit_invoice_id for update;
  else
    select * into v_debit from public.invoices i
      where i.company_id=p_company_id and i.id=p_debit_invoice_id for update;
    select * into v_credit from public.invoices i
      where i.company_id=p_company_id and i.id=p_credit_invoice_id for update;
  end if;

  if v_credit.id is null or v_debit.id is null then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_credit.customer_id is distinct from v_debit.customer_id then
    raise exception 'CUSTOMER_SETTLEMENT_DIFFERENT_CUSTOMER';
  end if;
  if v_credit.total_ore>=0 or v_credit.remaining_ore>=0 then
    raise exception 'CUSTOMER_SETTLEMENT_CREDIT_REQUIRED';
  end if;
  if v_debit.total_ore<=0 or v_debit.remaining_ore<=0 then
    raise exception 'CUSTOMER_SETTLEMENT_DEBIT_REQUIRED';
  end if;
  if v_credit.status='Väntar på bunt' or v_debit.status='Väntar på bunt'
     or v_credit.journal_number is null or v_debit.journal_number is null then
    raise exception 'CUSTOMER_SETTLEMENT_POSTED_INVOICES_REQUIRED';
  end if;
  if exists(
    select 1 from public.customer_credit_refunds r
    where r.company_id=p_company_id and r.credit_invoice_id=p_credit_invoice_id
  ) then raise exception 'CUSTOMER_SETTLEMENT_AFTER_REFUND_NOT_ALLOWED'; end if;
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id
      and ap.period=to_char(p_settlement_date,'YYYY-MM')
      and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  select coalesce(sum(s.amount_ore),0) into v_pending_credit
  from public.customer_credit_settlements s
  where s.company_id=p_company_id
    and s.credit_invoice_id=p_credit_invoice_id
    and s.status='ready';

  select coalesce(sum(s.amount_ore),0) into v_pending_debit
  from public.customer_credit_settlements s
  where s.company_id=p_company_id
    and s.debit_invoice_id=p_debit_invoice_id
    and s.status='ready';

  v_credit_available:=abs(v_credit.remaining_ore)-v_pending_credit;
  v_debit_available:=v_debit.remaining_ore-v_pending_debit;
  if v_credit_available<=0 then raise exception 'CUSTOMER_SETTLEMENT_CREDIT_RESERVED'; end if;
  if v_debit_available<=0 then raise exception 'CUSTOMER_SETTLEMENT_DEBIT_RESERVED'; end if;
  if p_amount_ore>least(v_credit_available,v_debit_available) then
    raise exception 'CUSTOMER_SETTLEMENT_AMOUNT_EXCEEDS_AVAILABLE';
  end if;

  v_settlement_id:='settlement_'||replace(gen_random_uuid()::text,'-','');
  v_title:=left(
    'Kvittning kredit '||v_credit.invoice_number||' mot '||v_debit.invoice_number,
    160
  );

  select * into v_created
  from public.create_financial_batch(p_company_id,v_title,p_amount_ore);

  perform public.save_financial_batch(
    p_company_id,
    v_created.batch_id,
    v_title,
    p_amount_ore,
    jsonb_build_array(
      jsonb_build_object(
        'postingDate',p_settlement_date::text,
        'description',v_title,
        'sourceType','customer-credit-settlement',
        'sourceId',v_settlement_id,
        'reference',v_credit.invoice_number||' -> '||v_debit.invoice_number,
        'externalAmountOre',p_amount_ore,
        'lines',jsonb_build_array(
          jsonb_build_object(
            'account','1510',
            'description','Kvitta kreditfaktura '||v_credit.invoice_number,
            'debitOre',p_amount_ore,
            'creditOre',0
          ),
          jsonb_build_object(
            'account','1510',
            'description','Kvitta mot debetfaktura '||v_debit.invoice_number,
            'debitOre',0,
            'creditOre',p_amount_ore
          )
        )
      )
    )
  );

  perform public.mark_financial_batch_ready(p_company_id,v_created.batch_id);

  insert into public.customer_credit_settlements(
    id,company_id,request_id,credit_invoice_id,debit_invoice_id,amount_ore,
    settlement_date,batch_id,status,created_by
  ) values(
    v_settlement_id,p_company_id,p_request_id,p_credit_invoice_id,p_debit_invoice_id,
    p_amount_ore,p_settlement_date,v_created.batch_id,'ready',v_uid
  );

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,v_created.batch_id,v_uid,'CUSTOMER_CREDIT_SETTLEMENT_STAGED',
    jsonb_build_object(
      'settlementId',v_settlement_id,
      'creditInvoiceId',p_credit_invoice_id,
      'debitInvoiceId',p_debit_invoice_id,
      'amountOre',p_amount_ore
    )
  );

  return query
  select v_settlement_id,v_created.batch_id,v_created.batch_number,'ready'::text,p_amount_ore;
end;
$$;

revoke all on function public.stage_customer_credit_settlement(text,text,text,text,bigint,date) from public,anon;
grant execute on function public.stage_customer_credit_settlement(text,text,text,text,bigint,date) to authenticated;

create or replace function public.apply_customer_credit_settlement_batch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_settlement public.customer_credit_settlements%rowtype;
  v_credit public.invoices%rowtype;
  v_debit public.invoices%rowtype;
  v_tx public.financial_batch_transactions%rowtype;
  v_line_count integer;
  v_debit_sum bigint;
  v_credit_sum bigint;
  v_non_1510 integer;
  v_journal_number text;
begin
  if new.status in ('draft','rejected') and old.status='ready' then
    update public.customer_credit_settlements s
    set status='cancelled'
    where s.company_id=new.company_id and s.batch_id=new.id and s.status='ready';
    return new;
  end if;

  if new.status<>'approved' or old.status='approved' then return new; end if;

  select * into v_settlement
  from public.customer_credit_settlements s
  where s.company_id=new.company_id and s.batch_id=new.id
  for update;
  if not found then return new; end if;
  if v_settlement.status='cancelled' then raise exception 'CUSTOMER_SETTLEMENT_CANCELLED'; end if;
  if v_settlement.status<>'ready' then raise exception 'CUSTOMER_SETTLEMENT_INVALID_STATE'; end if;

  if new.approved_by is null or not exists(
    select 1 from public.company_memberships m
    where m.company_id=new.company_id
      and m.auth_user_id=new.approved_by
      and m.role in ('admin','accountant','approver')
  ) then raise exception 'CUSTOMER_SETTLEMENT_APPROVER_INVALID'; end if;

  select * into v_tx
  from public.financial_batch_transactions t
  where t.company_id=new.company_id and t.batch_id=new.id;
  if not found then raise exception 'CUSTOMER_SETTLEMENT_BATCH_TRANSACTION_MISSING'; end if;
  if (
    select count(*) from public.financial_batch_transactions t
    where t.company_id=new.company_id and t.batch_id=new.id
  )<>1 then raise exception 'CUSTOMER_SETTLEMENT_BATCH_INTEGRITY_ERROR'; end if;
  if v_tx.source_type<>'customer-credit-settlement'
     or v_tx.source_id is distinct from v_settlement.id
     or v_tx.posting_date<>v_settlement.settlement_date
     or v_tx.external_amount_ore is distinct from v_settlement.amount_ore then
    raise exception 'CUSTOMER_SETTLEMENT_BATCH_INTEGRITY_ERROR';
  end if;

  select
    count(*),
    coalesce(sum(l.debit_ore),0),
    coalesce(sum(l.credit_ore),0),
    count(*) filter(where l.account<>'1510')
  into v_line_count,v_debit_sum,v_credit_sum,v_non_1510
  from public.financial_batch_lines l
  where l.company_id=new.company_id and l.transaction_id=v_tx.id;

  if v_line_count<>2
     or v_debit_sum<>v_settlement.amount_ore
     or v_credit_sum<>v_settlement.amount_ore
     or v_non_1510<>0 then
    raise exception 'CUSTOMER_SETTLEMENT_BATCH_INTEGRITY_ERROR';
  end if;

  if v_settlement.credit_invoice_id<v_settlement.debit_invoice_id then
    select * into v_credit from public.invoices i
      where i.company_id=new.company_id and i.id=v_settlement.credit_invoice_id for update;
    select * into v_debit from public.invoices i
      where i.company_id=new.company_id and i.id=v_settlement.debit_invoice_id for update;
  else
    select * into v_debit from public.invoices i
      where i.company_id=new.company_id and i.id=v_settlement.debit_invoice_id for update;
    select * into v_credit from public.invoices i
      where i.company_id=new.company_id and i.id=v_settlement.credit_invoice_id for update;
  end if;

  if v_credit.id is null or v_debit.id is null then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_credit.customer_id is distinct from v_debit.customer_id then
    raise exception 'CUSTOMER_SETTLEMENT_DIFFERENT_CUSTOMER';
  end if;
  if v_credit.total_ore>=0 or v_credit.remaining_ore>=0
     or v_debit.total_ore<=0 or v_debit.remaining_ore<=0 then
    raise exception 'CUSTOMER_SETTLEMENT_BALANCE_CHANGED';
  end if;
  if v_settlement.amount_ore>abs(v_credit.remaining_ore)
     or v_settlement.amount_ore>v_debit.remaining_ore then
    raise exception 'CUSTOMER_SETTLEMENT_BALANCE_CHANGED';
  end if;

  select j.series||j.journal_number into v_journal_number
  from public.journal_entries j
  where j.company_id=new.company_id
    and j.source_type='financial-batch'
    and j.source_id=v_tx.id
  order by j.created_at desc
  limit 1;
  if v_journal_number is null then raise exception 'CUSTOMER_SETTLEMENT_JOURNAL_MISSING'; end if;

  update public.invoices i
  set remaining_ore=i.remaining_ore+v_settlement.amount_ore,
      status=case
        when i.remaining_ore+v_settlement.amount_ore=0 then 'Kreditfaktura · kvittad'
        else i.status
      end,
      updated_at=now()
  where i.company_id=new.company_id
    and i.id=v_settlement.credit_invoice_id
    and i.remaining_ore=v_credit.remaining_ore;
  if not found then raise exception 'CUSTOMER_SETTLEMENT_BALANCE_CHANGED'; end if;

  update public.invoices i
  set remaining_ore=i.remaining_ore-v_settlement.amount_ore,
      status=case
        when i.remaining_ore-v_settlement.amount_ore=0 then 'Betald'
        else i.status
      end,
      updated_at=now()
  where i.company_id=new.company_id
    and i.id=v_settlement.debit_invoice_id
    and i.remaining_ore=v_debit.remaining_ore;
  if not found then raise exception 'CUSTOMER_SETTLEMENT_BALANCE_CHANGED'; end if;

  insert into public.invoice_transactions(
    id,company_id,invoice_id,transaction_type,payment_method,payment_date,
    posting_date,journal_number,amount_ore,approved,account,bank_reference
  ) values
    (
      'transaction_'||replace(gen_random_uuid()::text,'-',''),
      new.company_id,v_settlement.credit_invoice_id,'credit-settlement','Kvittning',
      v_settlement.settlement_date,v_settlement.settlement_date,v_journal_number,
      v_settlement.amount_ore,true,'1510','settlement:'||v_settlement.id||':credit'
    ),
    (
      'transaction_'||replace(gen_random_uuid()::text,'-',''),
      new.company_id,v_settlement.debit_invoice_id,'credit-settlement','Kvittning',
      v_settlement.settlement_date,v_settlement.settlement_date,v_journal_number,
      -v_settlement.amount_ore,true,'1510','settlement:'||v_settlement.id||':debit'
    );

  -- If the credit note originally created a refund obligation, reduce only the
  -- still-open refund amount. The original credited and automatic offset amounts remain unchanged.
  update public.customer_invoice_credit_adjustments a
  set refund_due_ore=greatest(0,a.refund_due_ore-v_settlement.amount_ore)
  where a.company_id=new.company_id
    and a.credit_invoice_id=v_settlement.credit_invoice_id
    and a.refund_due_ore>0;

  update public.customer_credit_settlements s
  set status='approved',approved_by=new.approved_by,approved_at=coalesce(new.approved_at,now())
  where s.company_id=new.company_id and s.id=v_settlement.id and s.status='ready';
  if not found then raise exception 'CUSTOMER_SETTLEMENT_INVALID_STATE'; end if;

  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    new.company_id,new.approved_by,'CUSTOMER_CREDIT_SETTLED','customer_credit_settlement',v_settlement.id,
    jsonb_build_object(
      'batchId',new.id,
      'batchNumber',new.batch_number,
      'creditInvoiceId',v_settlement.credit_invoice_id,
      'debitInvoiceId',v_settlement.debit_invoice_id,
      'amountOre',v_settlement.amount_ore,
      'journalNumber',v_journal_number
    )
  );

  return new;
end;
$$;

revoke all on function public.apply_customer_credit_settlement_batch() from public,anon,authenticated;

drop trigger if exists apply_customer_credit_settlement_batch_status on public.financial_batches;
create trigger apply_customer_credit_settlement_batch_status
after update of status on public.financial_batches
for each row
when (old.status is distinct from new.status)
execute function public.apply_customer_credit_settlement_batch();
