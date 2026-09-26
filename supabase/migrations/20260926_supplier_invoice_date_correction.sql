-- Supplier invoice date correction through the financial batch quality gate.
-- GitHub is source of truth. Apply to Supabase UAT only after this migration is merged.
-- A correction never changes invoice/reskontra state when staged. The old journal is
-- reversed and replaced inside one approved source batch; invoice dates change only
-- atomically during batch approval.

create table if not exists public.supplier_invoice_date_corrections(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  invoice_id text not null,
  request_id text not null,
  batch_id text not null,
  reversal_transaction_id text not null,
  replacement_transaction_id text not null,
  original_entry_id text not null,
  reversal_entry_id text,
  replacement_entry_id text,
  old_invoice_date date not null,
  new_invoice_date date not null,
  old_posting_date date not null,
  old_due_date date not null,
  new_due_date date not null,
  reason text not null check(char_length(reason) between 5 and 500),
  status text not null default 'pending' check(status in ('pending','approved')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  unique(company_id,request_id),
  unique(company_id,id),
  foreign key(company_id,invoice_id) references public.supplier_invoices(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references public.financial_batches(company_id,id) on delete restrict,
  foreign key(company_id,reversal_transaction_id) references public.financial_batch_transactions(company_id,id) on delete restrict,
  foreign key(company_id,replacement_transaction_id) references public.financial_batch_transactions(company_id,id) on delete restrict,
  foreign key(company_id,original_entry_id) references public.journal_entries(company_id,id) on delete restrict,
  foreign key(company_id,reversal_entry_id) references public.journal_entries(company_id,id) on delete restrict,
  foreign key(company_id,replacement_entry_id) references public.journal_entries(company_id,id) on delete restrict
);

-- Compatibility with the earlier UAT table shape that used corrected_by/corrected_at
-- and did not yet have batch transaction identities or a separate approval actor.
-- Keep legacy columns nullable for audit compatibility; new rows use created_by /
-- approved_by and the batch transaction ids.
alter table public.supplier_invoice_date_corrections
  add column if not exists reversal_transaction_id text,
  add column if not exists replacement_transaction_id text,
  add column if not exists old_posting_date date,
  add column if not exists created_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists corrected_by uuid,
  add column if not exists corrected_at timestamptz;

do $compat$
begin
  if exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='supplier_invoice_date_corrections'
      and column_name='corrected_by'
  ) then
    update public.supplier_invoice_date_corrections
    set created_by=coalesce(created_by,corrected_by)
    where created_by is null;

    update public.supplier_invoice_date_corrections
    set approved_by=coalesce(approved_by,corrected_by)
    where status='approved' and approved_by is null;

    alter table public.supplier_invoice_date_corrections
      alter column corrected_by drop not null;
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='supplier_invoice_date_corrections'
      and column_name='corrected_at'
  ) then
    update public.supplier_invoice_date_corrections
    set approved_at=coalesce(approved_at,corrected_at)
    where status='approved' and approved_at is null;
  end if;

  update public.supplier_invoice_date_corrections c
  set old_posting_date=j.posting_date
  from public.journal_entries j
  where c.old_posting_date is null
    and j.company_id=c.company_id
    and j.id=c.original_entry_id;

  if not exists(
    select 1 from public.supplier_invoice_date_corrections where created_by is null
  ) then
    alter table public.supplier_invoice_date_corrections
      alter column created_by set not null;
  end if;

  if not exists(
    select 1 from public.supplier_invoice_date_corrections where old_posting_date is null
  ) then
    alter table public.supplier_invoice_date_corrections
      alter column old_posting_date set not null;
  end if;

  if not exists(
    select 1 from public.supplier_invoice_date_corrections
    where reversal_transaction_id is null or replacement_transaction_id is null
  ) then
    alter table public.supplier_invoice_date_corrections
      alter column reversal_transaction_id set not null,
      alter column replacement_transaction_id set not null;
  end if;

  if not exists(
    select 1 from pg_constraint
    where conrelid='public.supplier_invoice_date_corrections'::regclass
      and conname='supplier_invoice_date_corrections_created_by_fkey'
  ) then
    alter table public.supplier_invoice_date_corrections
      add constraint supplier_invoice_date_corrections_created_by_fkey
      foreign key(created_by) references auth.users(id);
  end if;

  if not exists(
    select 1 from pg_constraint
    where conrelid='public.supplier_invoice_date_corrections'::regclass
      and conname='supplier_invoice_date_corrections_approved_by_fkey'
  ) then
    alter table public.supplier_invoice_date_corrections
      add constraint supplier_invoice_date_corrections_approved_by_fkey
      foreign key(approved_by) references auth.users(id);
  end if;
end
$compat$;

create unique index if not exists supplier_invoice_date_correction_one_pending
  on public.supplier_invoice_date_corrections(company_id,invoice_id)
  where status='pending';

create index if not exists supplier_invoice_date_corrections_invoice_recent
  on public.supplier_invoice_date_corrections(company_id,invoice_id,created_at desc);

alter table public.supplier_invoice_date_corrections enable row level security;

-- Remove policies from the earlier direct-correction implementation so there is
-- only one write path: staging + approved financial batch.
drop policy if exists "controlled supplier date corrections" on public.supplier_invoice_date_corrections;
drop policy if exists "members read supplier date corrections" on public.supplier_invoice_date_corrections;

drop policy if exists "members read supplier invoice date corrections" on public.supplier_invoice_date_corrections;
create policy "members read supplier invoice date corrections"
on public.supplier_invoice_date_corrections for select to authenticated
using (
  exists(
    select 1 from public.company_memberships m
    where m.company_id=supplier_invoice_date_corrections.company_id
      and m.auth_user_id=(select auth.uid())
  )
);

drop policy if exists "controlled insert supplier invoice date corrections" on public.supplier_invoice_date_corrections;
create policy "controlled insert supplier invoice date corrections"
on public.supplier_invoice_date_corrections for insert to authenticated
with check (
  current_setting('app.system_batch_stage',true)='1'
  and created_by=(select auth.uid())
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=supplier_invoice_date_corrections.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

drop policy if exists "controlled update supplier invoice date corrections" on public.supplier_invoice_date_corrections;
create policy "controlled update supplier invoice date corrections"
on public.supplier_invoice_date_corrections for update to authenticated
using (
  current_setting('app.financial_batch_approval',true)='1'
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=supplier_invoice_date_corrections.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant','approver')
  )
)
with check (
  current_setting('app.financial_batch_approval',true)='1'
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=supplier_invoice_date_corrections.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant','approver')
  )
);

drop policy if exists "UAT requires AAL2" on public.supplier_invoice_date_corrections;
create policy "UAT requires AAL2"
on public.supplier_invoice_date_corrections
as restrictive for all to authenticated
using (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
)
with check (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
);

revoke all on public.supplier_invoice_date_corrections from anon;
revoke all on public.supplier_invoice_date_corrections from authenticated;
grant select,insert,update on public.supplier_invoice_date_corrections to authenticated;

create or replace function public.stage_supplier_invoice_date_correction(
  p_invoice_id text,
  p_request_id text,
  p_invoice_date date,
  p_due_date date,
  p_reason text
)
returns table(batch_id text,batch_number integer,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_invoice public.supplier_invoices%rowtype;
  v_original public.journal_entries%rowtype;
  v_existing public.supplier_invoice_date_corrections%rowtype;
  v_batch_id text;
  v_batch_number integer;
  v_reversal_tx text;
  v_replacement_tx text;
  v_correction_id text;
  v_line record;
  v_debit bigint:=0;
  v_credit bigint:=0;
  v_line_no integer:=0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_invoice_date is null or p_due_date is null or p_due_date<p_invoice_date then raise exception 'INVALID_INVOICE_DATES'; end if;
  if p_invoice_date>current_date then raise exception 'FUTURE_INVOICE_DATE_NOT_ALLOWED'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<5 or char_length(btrim(coalesce(p_reason,'')))>500 then raise exception 'CORRECTION_REASON_REQUIRED'; end if;

  select * into v_invoice
  from public.supplier_invoices i
  where i.id=p_invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=v_invoice.company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  select * into v_existing
  from public.supplier_invoice_date_corrections c
  where c.company_id=v_invoice.company_id and c.request_id=p_request_id
  for update;
  if found then
    if v_existing.invoice_id<>p_invoice_id
       or v_existing.new_invoice_date<>p_invoice_date
       or v_existing.new_due_date<>p_due_date
       or v_existing.reason<>btrim(p_reason)
       or v_existing.created_by<>v_uid then
      raise exception 'SUPPLIER_DATE_CORRECTION_IDEMPOTENCY_CONFLICT';
    end if;
    return query
    select b.id,b.batch_number,b.status,true
    from public.financial_batches b
    where b.company_id=v_existing.company_id and b.id=v_existing.batch_id;
    return;
  end if;

  if exists(
    select 1 from public.supplier_invoice_date_corrections c
    where c.company_id=v_invoice.company_id and c.invoice_id=v_invoice.id and c.status='pending'
  ) then raise exception 'SUPPLIER_DATE_CORRECTION_ALREADY_PENDING'; end if;

  if v_invoice.status<>'approved'
     or v_invoice.liability_accounting_entry_id is null
     or v_invoice.remaining_ore<>v_invoice.total_ore then
    raise exception 'SUPPLIER_INVOICE_DATE_CORRECTION_NOT_ALLOWED';
  end if;
  if p_invoice_date=v_invoice.invoice_date and p_due_date=v_invoice.due_date then
    raise exception 'SUPPLIER_DATE_CORRECTION_NOOP';
  end if;
  if exists(
    select 1 from public.supplier_payments p
    where p.company_id=v_invoice.company_id and p.supplier_invoice_id=v_invoice.id
  ) then raise exception 'SUPPLIER_DATE_CORRECTION_PAYMENT_EXISTS'; end if;

  select * into v_original
  from public.journal_entries j
  where j.company_id=v_invoice.company_id and j.id=v_invoice.liability_accounting_entry_id
  for update;
  if not found
     or v_original.source_type<>'supplier-invoice'
     or v_original.source_id<>v_invoice.id
     or v_original.posting_date<>v_invoice.posting_date then
    raise exception 'SUPPLIER_ACCOUNTING_INTEGRITY_ERROR';
  end if;

  select coalesce(sum(l.debit_ore),0),coalesce(sum(l.credit_ore),0)
  into v_debit,v_credit
  from public.journal_lines l
  where l.company_id=v_invoice.company_id and l.journal_entry_id=v_original.id;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'SUPPLIER_ACCOUNTING_INTEGRITY_ERROR'; end if;
  if (
    select coalesce(sum(l.credit_ore-l.debit_ore),0)
    from public.journal_lines l
    where l.company_id=v_invoice.company_id
      and l.journal_entry_id=v_original.id
      and l.account='2440'
  )<>v_invoice.total_ore then raise exception 'SUPPLIER_ACCOUNTING_INTEGRITY_ERROR'; end if;

  if exists(
    select 1 from public.accounting_periods p
    where p.company_id=v_invoice.company_id
      and p.period in (to_char(v_invoice.posting_date,'YYYY-MM'),to_char(p_invoice_date,'YYYY-MM'))
      and p.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.system_batch_stage','1',true);
  perform pg_advisory_xact_lock(hashtextextended(v_invoice.company_id||':financial-batches',0));

  select coalesce(max(b.batch_number),9999)+1 into v_batch_number
  from public.financial_batches b
  where b.company_id=v_invoice.company_id;
  if v_batch_number>99999 then raise exception 'BATCH_NUMBER_EXHAUSTED'; end if;

  v_batch_id='batch_'||replace(gen_random_uuid()::text,'-','');
  v_correction_id='sidc_'||replace(gen_random_uuid()::text,'-','');
  v_reversal_tx='btx_'||replace(gen_random_uuid()::text,'-','');
  v_replacement_tx='btx_'||replace(gen_random_uuid()::text,'-','');

  insert into public.financial_batches(
    id,company_id,batch_number,title,status,kind,external_total_ore,transaction_count,
    total_debit_ore,total_credit_ore,control_state,created_by,updated_by,ready_by,ready_at
  ) values(
    v_batch_id,v_invoice.company_id,v_batch_number,
    left('Datumrättelse leverantörsfaktura '||v_invoice.supplier_invoice_number,160),
    'ready','source',null,2,v_debit*2,v_credit*2,'balanced',v_uid,v_uid,v_uid,now()
  );

  insert into public.financial_batch_transactions(
    id,company_id,batch_id,transaction_number,sequence_number,posting_date,description,
    source_type,source_id,external_amount_ore,journal_series,activation_type,activation_payload
  ) values
  (
    v_reversal_tx,v_invoice.company_id,v_batch_id,lpad(v_batch_number::text,5,'0')||'-001',1,
    v_invoice.posting_date,left('Motverifikation – rättat datum '||v_invoice.supplier_invoice_number,240),
    'supplier-invoice-date-correction',v_correction_id,v_debit,'A',
    'supplier-invoice-date-correction-reversal',
    jsonb_build_object('correctionId',v_correction_id,'invoiceId',v_invoice.id,'requestId',p_request_id,'phase','reversal')
  ),
  (
    v_replacement_tx,v_invoice.company_id,v_batch_id,lpad(v_batch_number::text,5,'0')||'-002',2,
    p_invoice_date,left('Rättad leverantörsfaktura '||v_invoice.supplier_invoice_number,240),
    'supplier-invoice-date-correction',v_correction_id,v_debit,'A',
    'supplier-invoice-date-correction-replacement',
    jsonb_build_object('correctionId',v_correction_id,'invoiceId',v_invoice.id,'requestId',p_request_id,'phase','replacement')
  );

  for v_line in
    select * from public.journal_lines l
    where l.company_id=v_invoice.company_id and l.journal_entry_id=v_original.id
    order by l.line_number
  loop
    v_line_no:=v_line_no+1;
    insert into public.financial_batch_lines(
      id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore
    ) values(
      'bline_'||replace(gen_random_uuid()::text,'-',''),v_invoice.company_id,v_reversal_tx,v_line_no,
      v_line.account,left('Rättelse av '||v_original.series||v_original.journal_number||': '||coalesce(v_line.description,''),240),
      v_line.credit_ore,v_line.debit_ore
    );
    insert into public.financial_batch_lines(
      id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore
    ) values(
      'bline_'||replace(gen_random_uuid()::text,'-',''),v_invoice.company_id,v_replacement_tx,v_line_no,
      v_line.account,v_line.description,v_line.debit_ore,v_line.credit_ore
    );
  end loop;

  insert into public.supplier_invoice_date_corrections(
    id,company_id,invoice_id,request_id,batch_id,reversal_transaction_id,replacement_transaction_id,
    original_entry_id,old_invoice_date,new_invoice_date,old_posting_date,old_due_date,new_due_date,
    reason,status,created_by
  ) values(
    v_correction_id,v_invoice.company_id,v_invoice.id,p_request_id,v_batch_id,v_reversal_tx,v_replacement_tx,
    v_original.id,v_invoice.invoice_date,p_invoice_date,v_invoice.posting_date,v_invoice.due_date,p_due_date,
    btrim(p_reason),'pending',v_uid
  );

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    v_invoice.company_id,v_batch_id,v_uid,'SUPPLIER_DATE_CORRECTION_STAGED',
    jsonb_build_object(
      'invoiceId',v_invoice.id,'requestId',p_request_id,
      'oldInvoiceDate',v_invoice.invoice_date,'newInvoiceDate',p_invoice_date,
      'oldDueDate',v_invoice.due_date,'newDueDate',p_due_date
    )
  );

  return query select v_batch_id,v_batch_number,'ready'::text,false;
end;
$$;

revoke all on function public.stage_supplier_invoice_date_correction(text,text,date,date,text) from public,anon;
grant execute on function public.stage_supplier_invoice_date_correction(text,text,date,date,text) to authenticated;

CREATE OR REPLACE FUNCTION public.approve_financial_batch(p_company_id text, p_batch_id text)
 RETURNS TABLE(batch_id text, batch_number integer, status text, posted_entries integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_batch public.financial_batches%rowtype;
  v_tx record;
  v_line record;
  v_year text;
  v_series text;
  v_seq bigint;
  v_entry text;
  v_posted int:=0;
  v_tx_total bigint;
  v_self_approval boolean:=false;
  v_invoice_id text;
  v_amount bigint;
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.financial_batch_approval','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  perform set_config('app.controlled_payroll_write','1',true);
  perform set_config('app.audit_event_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant','approver')
  ) then raise exception 'ACCESS_DENIED'; end if;

  select * into v_batch
  from public.financial_batches b
  where b.company_id=p_company_id and b.id=p_batch_id
  for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then
    return query select v_batch.id,v_batch.batch_number,v_batch.status,0;
    return;
  end if;
  if v_batch.status<>'ready' then raise exception 'BATCH_NOT_READY'; end if;
  if v_batch.transaction_count<1 or v_batch.control_state<>'balanced' or v_batch.total_debit_ore<>v_batch.total_credit_ore then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_batch.external_total_ore is not null and v_batch.external_total_ore<>v_batch.total_debit_ore then raise exception 'EXTERNAL_TOTAL_MISMATCH'; end if;

  v_self_approval:=v_batch.created_by=v_uid or v_batch.updated_by=v_uid or v_batch.ready_by=v_uid;

  for v_tx in
    select * from public.financial_batch_transactions t
    where t.company_id=p_company_id and t.batch_id=p_batch_id
    order by t.sequence_number
  loop
    if exists(
      select 1 from public.accounting_periods ap
      where ap.company_id=p_company_id
        and ap.period=to_char(v_tx.posting_date,'YYYY-MM')
        and ap.status='locked'
    ) then raise exception 'PERIOD_LOCKED'; end if;

    select coalesce(sum(l.debit_ore),0) into v_tx_total
    from public.financial_batch_lines l
    where l.company_id=p_company_id and l.transaction_id=v_tx.id;

    if v_tx_total<>(
      select coalesce(sum(l.credit_ore),0)
      from public.financial_batch_lines l
      where l.company_id=p_company_id and l.transaction_id=v_tx.id
    ) or v_tx_total<=0 then raise exception 'TRANSACTION_NOT_BALANCED'; end if;

    if v_tx.external_amount_ore is not null and abs(v_tx.external_amount_ore)<>v_tx_total then
      raise exception 'TRANSACTION_EXTERNAL_TOTAL_MISMATCH';
    end if;

    v_series=coalesce(nullif(v_tx.journal_series,''),'A');
    if v_batch.kind='manual' and v_series<>'A' then raise exception 'MANUAL_BATCH_SERIES_NOT_ALLOWED'; end if;
    if v_batch.kind='source' and v_tx.activation_type is null then raise exception 'SOURCE_BATCH_ACTIVATION_REQUIRED'; end if;
    if v_batch.kind='source' and (
      (v_tx.activation_type='customer-invoice' and (v_tx.source_type<>'customer-invoice' or v_series<>'F'))
      or (v_tx.activation_type='supplier-invoice-liability' and (v_tx.source_type<>'supplier-invoice' or v_series<>'A'))
      or (v_tx.activation_type in ('supplier-invoice-date-correction-reversal','supplier-invoice-date-correction-replacement') and (v_tx.source_type<>'supplier-invoice-date-correction' or v_series<>'A'))
      or (v_tx.activation_type='supplier-payment' and (v_tx.source_type<>'supplier-payment' or v_series<>'A'))
      or (v_tx.activation_type='payroll-run' and (v_tx.source_type<>'payroll-run' or v_series<>'L'))
      or (v_tx.activation_type='opening-balance' and (v_tx.source_type<>'opening-balance' or v_series<>'IB'))
    ) then raise exception 'SOURCE_BATCH_SERIES_MISMATCH'; end if;

    if v_tx.activation_type='opening-balance' then
      if v_tx.source_id !~ '^(19|20|21)[0-9]{2}$'
         or v_tx.posting_date<>(v_tx.source_id||'-01-01')::date then
        raise exception 'INVALID_OPENING_BALANCE_DATE';
      end if;
      if exists(
        select 1 from public.journal_entries j
        where j.company_id=p_company_id
          and j.posting_date>=(v_tx.source_id||'-01-01')::date
          and j.posting_date<((v_tx.source_id::int+1)::text||'-01-01')::date
      ) then raise exception 'OPENING_BALANCE_REQUIRES_EMPTY_YEAR'; end if;
    end if;

    v_year=to_char(v_tx.posting_date,'YYYY');
    perform pg_advisory_xact_lock(hashtextextended(p_company_id||':'||v_series||':'||v_year,0));
    insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
    values(p_company_id,v_series,v_year,1)
    on conflict(company_id,series,fiscal_year)
    do update set last_number=public.accounting_sequences.last_number+1
    returning last_number into v_seq;

    v_entry='entry_'||replace(gen_random_uuid()::text,'-','');
    insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
    values(
      v_entry,p_company_id,v_series,v_seq::text,v_tx.posting_date,v_tx.description,
      case when v_batch.kind='source' then v_tx.source_type else 'financial-batch' end,
      case when v_batch.kind='source' then v_tx.source_id else v_tx.id end,
      v_uid
    );

    for v_line in
      select * from public.financial_batch_lines l
      where l.company_id=p_company_id and l.transaction_id=v_tx.id
      order by l.line_number
    loop
      insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
      values(
        'jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry,v_line.line_number,
        v_line.account,v_line.description,v_line.debit_ore,v_line.credit_ore
      );
    end loop;

    if v_tx.activation_type is not null then
      if v_batch.kind<>'source' then raise exception 'SYSTEM_ACTIVATION_ON_MANUAL_BATCH'; end if;

      if v_tx.activation_type='customer-invoice' then
        v_invoice_id=coalesce(v_tx.activation_payload->>'invoiceId',v_tx.source_id);
        if v_invoice_id<>v_tx.source_id then raise exception 'CUSTOMER_INVOICE_BATCH_INTEGRITY_ERROR'; end if;
        update public.invoices i
        set remaining_ore=i.total_ore,
            status='Bokförd',
            batch_number=lpad(v_batch.batch_number::text,5,'0'),
            journal_number=v_series||v_seq,
            updated_at=now()
        where i.company_id=p_company_id
          and i.id=v_invoice_id
          and i.status='Väntar på bunt'
          and i.remaining_ore=0
          and i.journal_number is null;
        if not found then raise exception 'CUSTOMER_INVOICE_BATCH_ACTIVATION_CONFLICT'; end if;

      elsif v_tx.activation_type='supplier-invoice-liability' then
        update public.supplier_invoices i
        set liability_accounting_entry_id=v_entry,
            liability_posted_at=now(),
            updated_at=now()
        where i.company_id=p_company_id
          and i.id=v_tx.source_id
          and i.status='approved'
          and i.liability_accounting_entry_id is null
          and i.liability_batch_id=p_batch_id;
        if not found then raise exception 'SUPPLIER_LIABILITY_BATCH_ACTIVATION_CONFLICT'; end if;

      elsif v_tx.activation_type='supplier-invoice-date-correction-reversal' then
        update public.supplier_invoice_date_corrections c
        set reversal_entry_id=v_entry
        where c.company_id=p_company_id
          and c.id=v_tx.source_id
          and c.batch_id=p_batch_id
          and c.status='pending'
          and c.reversal_transaction_id=v_tx.id
          and c.reversal_entry_id is null
          and c.replacement_entry_id is null;
        if not found then raise exception 'SUPPLIER_DATE_CORRECTION_REVERSAL_CONFLICT'; end if;

      elsif v_tx.activation_type='supplier-invoice-date-correction-replacement' then
        update public.supplier_invoices i
        set invoice_date=c.new_invoice_date,
            posting_date=c.new_invoice_date,
            due_date=c.new_due_date,
            liability_accounting_entry_id=v_entry,
            liability_posted_at=now(),
            updated_at=now()
        from public.supplier_invoice_date_corrections c
        where c.company_id=p_company_id
          and c.id=v_tx.source_id
          and c.batch_id=p_batch_id
          and c.status='pending'
          and c.replacement_transaction_id=v_tx.id
          and c.reversal_entry_id is not null
          and c.replacement_entry_id is null
          and i.company_id=c.company_id
          and i.id=c.invoice_id
          and i.status='approved'
          and i.remaining_ore=i.total_ore
          and i.invoice_date=c.old_invoice_date
          and i.posting_date=c.old_posting_date
          and i.due_date=c.old_due_date
          and i.liability_accounting_entry_id=c.original_entry_id
          and not exists(
            select 1 from public.supplier_payments p
            where p.company_id=i.company_id and p.supplier_invoice_id=i.id
          );
        if not found then raise exception 'SUPPLIER_DATE_CORRECTION_REPLACEMENT_CONFLICT'; end if;

        update public.supplier_invoice_date_corrections c
        set replacement_entry_id=v_entry,
            status='approved',
            approved_by=v_uid,
            approved_at=now(),
            corrected_by=v_uid,
            corrected_at=now()
        where c.company_id=p_company_id
          and c.id=v_tx.source_id
          and c.batch_id=p_batch_id
          and c.status='pending'
          and c.reversal_entry_id is not null
          and c.replacement_entry_id is null;
        if not found then raise exception 'SUPPLIER_DATE_CORRECTION_HISTORY_CONFLICT'; end if;

        insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
        select
          c.company_id,v_uid,'SUPPLIER_INVOICE_DATES_CORRECTED','supplier-invoice',c.invoice_id,
          jsonb_build_object(
            'requestId',c.request_id,
            'reason',c.reason,
            'oldInvoiceDate',c.old_invoice_date,
            'newInvoiceDate',c.new_invoice_date,
            'oldPostingDate',c.old_posting_date,
            'newPostingDate',c.new_invoice_date,
            'oldDueDate',c.old_due_date,
            'newDueDate',c.new_due_date,
            'originalAccountingEntryId',c.original_entry_id,
            'reversalAccountingEntryId',c.reversal_entry_id,
            'replacementAccountingEntryId',c.replacement_entry_id,
            'batchId',c.batch_id
          )
        from public.supplier_invoice_date_corrections c
        where c.company_id=p_company_id and c.id=v_tx.source_id;

      elsif v_tx.activation_type='supplier-payment' then
        v_amount=coalesce((v_tx.activation_payload->>'amountOre')::bigint,0);
        update public.supplier_payments p
        set status='paid',
            confirmation_reference=p.pending_confirmation_reference,
            accounting_entry_id=v_entry,
            paid_at=now(),
            updated_at=now()
        where p.company_id=p_company_id
          and p.id=v_tx.source_id
          and p.status='released'
          and p.accounting_batch_id=p_batch_id
          and p.supplier_invoice_id=(v_tx.activation_payload->>'invoiceId')
          and p.amount_ore=v_amount
          and p.account=(v_tx.activation_payload->>'account')
          and p.pending_posting_date=v_tx.posting_date
          and p.pending_confirmation_reference=(v_tx.activation_payload->>'confirmationReference');
        if not found then raise exception 'SUPPLIER_PAYMENT_BATCH_ACTIVATION_CONFLICT'; end if;

        update public.supplier_invoices i
        set status='paid',remaining_ore=0,updated_at=now()
        where i.company_id=p_company_id
          and i.id=(v_tx.activation_payload->>'invoiceId')
          and i.status='payment-prepared'
          and i.remaining_ore=v_amount;
        if not found then raise exception 'INVOICE_PAYMENT_CONFLICT'; end if;

      elsif v_tx.activation_type='payroll-run' then
        update public.payroll_runs r
        set status='posted',
            posted_by=v_uid,
            posted_at=now(),
            accounting_entry_id=v_entry
        where r.company_id=p_company_id
          and r.id=v_tx.source_id
          and r.status='validated'
          and r.accounting_batch_id=p_batch_id
          and r.journal_sha256=(v_tx.activation_payload->>'journalSha256');
        if not found then raise exception 'PAYROLL_BATCH_ACTIVATION_CONFLICT'; end if;

      elsif v_tx.activation_type='opening-balance' then
        if (v_tx.activation_payload->>'year') is distinct from v_tx.source_id then
          raise exception 'OPENING_BALANCE_BATCH_INTEGRITY_ERROR';
        end if;

      else
        raise exception 'UNSUPPORTED_SOURCE_BATCH_ACTIVATION';
      end if;
    end if;

    v_posted:=v_posted+1;
  end loop;

  update public.financial_batches b
  set status='approved',approved_by=v_uid,approved_at=now(),updated_by=v_uid,updated_at=now()
  where b.company_id=p_company_id and b.id=p_batch_id;

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,p_batch_id,v_uid,'BATCH_APPROVED',
    jsonb_build_object('postedEntries',v_posted,'selfApproval',v_self_approval,'kind',v_batch.kind)
  );

  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    p_company_id,v_uid,'FINANCIAL_BATCH_APPROVED','financial_batch',p_batch_id,
    jsonb_build_object('batchNumber',v_batch.batch_number,'postedEntries',v_posted,'selfApproval',v_self_approval,'kind',v_batch.kind)
  );

  return query
  select b.id,b.batch_number,b.status,v_posted
  from public.financial_batches b
  where b.company_id=p_company_id and b.id=p_batch_id;
end;
$function$;


revoke all on function public.approve_financial_batch(text,text) from public,anon;
grant execute on function public.approve_financial_batch(text,text) to authenticated;
