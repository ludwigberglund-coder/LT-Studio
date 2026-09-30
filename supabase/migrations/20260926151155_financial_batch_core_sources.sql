-- Route additional core accounting sources through financial batches.
-- Supplier liability, supplier payment, payroll and opening balance stay outside
-- the general ledger/reskontra until a ready source batch is approved.

alter table public.supplier_invoices
  add column if not exists liability_batch_id text;

alter table public.supplier_payments
  add column if not exists accounting_batch_id text,
  add column if not exists pending_confirmation_reference text,
  add column if not exists pending_posting_date date;

alter table public.payroll_runs
  add column if not exists accounting_batch_id text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='supplier_invoices_liability_batch_fkey' and conrelid='public.supplier_invoices'::regclass) then
    alter table public.supplier_invoices
      add constraint supplier_invoices_liability_batch_fkey
      foreign key(company_id,liability_batch_id)
      references public.financial_batches(company_id,id)
      on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='supplier_payments_accounting_batch_fkey' and conrelid='public.supplier_payments'::regclass) then
    alter table public.supplier_payments
      add constraint supplier_payments_accounting_batch_fkey
      foreign key(company_id,accounting_batch_id)
      references public.financial_batches(company_id,id)
      on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='payroll_runs_accounting_batch_fkey' and conrelid='public.payroll_runs'::regclass) then
    alter table public.payroll_runs
      add constraint payroll_runs_accounting_batch_fkey
      foreign key(company_id,accounting_batch_id)
      references public.financial_batches(company_id,id)
      on delete restrict;
  end if;
end
$$;

create index if not exists supplier_invoices_liability_batch_idx
  on public.supplier_invoices(company_id,liability_batch_id)
  where liability_batch_id is not null;

create index if not exists supplier_payments_accounting_batch_idx
  on public.supplier_payments(company_id,accounting_batch_id)
  where accounting_batch_id is not null;

create index if not exists payroll_runs_accounting_batch_idx
  on public.payroll_runs(company_id,accounting_batch_id)
  where accounting_batch_id is not null;

create or replace function public.stage_source_financial_batch(
  p_company_id text,
  p_title text,
  p_journal_series text,
  p_posting_date date,
  p_description text,
  p_source_type text,
  p_source_id text,
  p_lines jsonb,
  p_activation_type text,
  p_activation_payload jsonb
)
returns table(batch_id text,batch_number integer)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_batch_id text;
  v_batch_no integer;
  v_tx_id text;
  v_line jsonb;
  v_line_no integer:=0;
  v_debit bigint:=0;
  v_credit bigint:=0;
begin
  if current_setting('app.system_batch_stage',true)<>'1' then raise exception 'SYSTEM_BATCH_STAGE_REQUIRED'; end if;
  perform set_config('app.financial_batch_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;
  if p_journal_series !~ '^[A-Z]{1,3}$' then raise exception 'INVALID_JOURNAL_SERIES'; end if;
  if p_activation_type not in (
    'customer-invoice',
    'supplier-invoice-liability',
    'supplier-payment',
    'payroll-run',
    'opening-balance'
  ) then raise exception 'UNSUPPORTED_SOURCE_BATCH_ACTIVATION'; end if;
  if (
    (p_activation_type='customer-invoice' and (p_source_type<>'customer-invoice' or p_journal_series<>'F'))
    or (p_activation_type='supplier-invoice-liability' and (p_source_type<>'supplier-invoice' or p_journal_series<>'A'))
    or (p_activation_type='supplier-payment' and (p_source_type<>'supplier-payment' or p_journal_series<>'A'))
    or (p_activation_type='payroll-run' and (p_source_type<>'payroll-run' or p_journal_series<>'L'))
    or (p_activation_type='opening-balance' and (p_source_type<>'opening-balance' or p_journal_series<>'IB'))
  ) then raise exception 'SOURCE_BATCH_SERIES_MISMATCH'; end if;
  if coalesce(btrim(p_source_type),'')='' or coalesce(btrim(p_source_id),'')='' then raise exception 'SOURCE_REFERENCE_REQUIRED'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'INVALID_SOURCE_BATCH_LINES'; end if;
  if exists(
    select 1 from public.financial_batch_transactions t
    where t.company_id=p_company_id and t.source_type=p_source_type and t.source_id=p_source_id and t.activation_type=p_activation_type
  ) then raise exception 'SOURCE_BATCH_ALREADY_EXISTS'; end if;
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id and ap.period=to_char(p_posting_date,'YYYY-MM') and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    if coalesce((v_line->>'debitOre')::bigint,0)<0 or coalesce((v_line->>'creditOre')::bigint,0)<0 then raise exception 'NEGATIVE_BOOKING_AMOUNT'; end if;
    if not (
      (coalesce((v_line->>'debitOre')::bigint,0)>0 and coalesce((v_line->>'creditOre')::bigint,0)=0)
      or
      (coalesce((v_line->>'creditOre')::bigint,0)>0 and coalesce((v_line->>'debitOre')::bigint,0)=0)
    ) then raise exception 'INVALID_BOOKING_LINE'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::bigint,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::bigint,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'BATCH_NOT_BALANCED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':financial-batches',0));
  select coalesce(max(b.batch_number),9999)+1 into v_batch_no
  from public.financial_batches b
  where b.company_id=p_company_id;
  if v_batch_no>99999 then raise exception 'BATCH_NUMBER_EXHAUSTED'; end if;

  v_batch_id='batch_'||replace(gen_random_uuid()::text,'-','');
  v_tx_id='btx_'||replace(gen_random_uuid()::text,'-','');

  insert into public.financial_batches(
    id,company_id,batch_number,title,status,kind,external_total_ore,transaction_count,total_debit_ore,total_credit_ore,
    control_state,created_by,updated_by,ready_by,ready_at
  ) values(
    v_batch_id,p_company_id,v_batch_no,left(coalesce(nullif(btrim(p_title),''),'Systembunt'),160),'ready','source',
    v_debit,1,v_debit,v_credit,'balanced',v_uid,v_uid,v_uid,now()
  );

  insert into public.financial_batch_transactions(
    id,company_id,batch_id,transaction_number,sequence_number,posting_date,description,source_type,source_id,
    external_amount_ore,journal_series,activation_type,activation_payload
  ) values(
    v_tx_id,p_company_id,v_batch_id,lpad(v_batch_no::text,5,'0')||'-001',1,p_posting_date,left(p_description,240),
    p_source_type,p_source_id,v_debit,p_journal_series,p_activation_type,coalesce(p_activation_payload,'{}'::jsonb)
  );

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_no:=v_line_no+1;
    insert into public.financial_batch_lines(
      id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore
    ) values(
      'bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx_id,v_line_no,v_line->>'account',
      left(coalesce(v_line->>'text',v_line->>'description',''),240),
      coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0)
    );
  end loop;

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,v_batch_id,v_uid,'SOURCE_BATCH_STAGED',
    jsonb_build_object('sourceType',p_source_type,'sourceId',p_source_id,'activationType',p_activation_type,'journalSeries',p_journal_series)
  );

  return query select v_batch_id,v_batch_no;
end;
$$;

revoke all on function public.stage_source_financial_batch(text,text,text,date,text,text,text,jsonb,text,jsonb) from public,anon;
grant execute on function public.stage_source_financial_batch(text,text,text,date,text,text,text,jsonb,text,jsonb) to authenticated;

create or replace function public.approve_financial_batch(p_company_id text,p_batch_id text)
returns table(batch_id text,batch_number integer,status text,posted_entries integer)
language plpgsql security invoker set search_path=''
as $$
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
$$;

revoke all on function public.approve_financial_batch(text,text) from public,anon;
grant execute on function public.approve_financial_batch(text,text) to authenticated;

create or replace function public.post_supplier_invoice_liability(p_invoice_id text)
returns table(entry_id text,series text,journal_number text,posting_date date,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_invoice public.supplier_invoices%rowtype;
  v_batch public.financial_batches%rowtype;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_line jsonb;
  v_batch_id text;
  v_batch_number integer;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_invoice
  from public.supplier_invoices i
  where i.id=p_invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=v_invoice.company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  if v_invoice.liability_accounting_entry_id is not null then
    return query
    select j.id,j.series,j.journal_number,j.posting_date,'duplicate'::text
    from public.journal_entries j
    where j.company_id=v_invoice.company_id and j.id=v_invoice.liability_accounting_entry_id;
    return;
  end if;

  if v_invoice.liability_batch_id is not null then
    select * into v_batch
    from public.financial_batches b
    where b.company_id=v_invoice.company_id and b.id=v_invoice.liability_batch_id;
    if not found then raise exception 'SUPPLIER_LIABILITY_BATCH_NOT_FOUND'; end if;
    if v_batch.status='ready' then
      return query select null::text,'A'::text,null::text,v_invoice.posting_date,'pending-batch'::text;
      return;
    end if;
    raise exception 'SUPPLIER_LIABILITY_BATCH_STATE_CONFLICT';
  end if;

  if v_invoice.status<>'approved' then raise exception 'INVOICE_NOT_APPROVED'; end if;
  if jsonb_typeof(v_invoice.coding_json)<>'array' or jsonb_array_length(v_invoice.coding_json)<2 then raise exception 'CODING_REQUIRED'; end if;

  for v_line in select value from jsonb_array_elements(v_invoice.coding_json) loop
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_CODING'; end if;

  if exists(
    select 1 from public.accounting_periods p
    where p.company_id=v_invoice.company_id
      and p.period=to_char(v_invoice.posting_date,'YYYY-MM')
      and p.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  perform set_config('app.system_batch_stage','1',true);
  select s.batch_id,s.batch_number into v_batch_id,v_batch_number
  from public.stage_source_financial_batch(
    v_invoice.company_id,
    'Leverantörsfaktura '||v_invoice.supplier_invoice_number,
    'A',
    v_invoice.posting_date,
    left('Leverantörsfaktura '||v_invoice.supplier_invoice_number,240),
    'supplier-invoice',
    v_invoice.id,
    v_invoice.coding_json,
    'supplier-invoice-liability',
    jsonb_build_object('invoiceId',v_invoice.id,'supplierInvoiceNumber',v_invoice.supplier_invoice_number)
  ) s;

  update public.supplier_invoices i
  set liability_batch_id=v_batch_id,updated_at=now()
  where i.company_id=v_invoice.company_id
    and i.id=v_invoice.id
    and i.liability_accounting_entry_id is null
    and i.liability_batch_id is null;
  if not found then raise exception 'SUPPLIER_LIABILITY_BATCH_STAGE_CONFLICT'; end if;

  return query select null::text,'A'::text,null::text,v_invoice.posting_date,'pending-batch'::text;
end;
$$;

revoke all on function public.post_supplier_invoice_liability(text) from public,anon;
grant execute on function public.post_supplier_invoice_liability(text) to authenticated;

create or replace function public.confirm_supplier_payment(p_payment_id text,p_confirmation_reference text,p_posting_date date)
returns table(payment_id text,status text,entry_id text,series text,journal_number text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_payment public.supplier_payments%rowtype;
  v_invoice public.supplier_invoices%rowtype;
  v_batch public.financial_batches%rowtype;
  v_batch_id text;
  v_batch_number integer;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(btrim(coalesce(p_confirmation_reference,'')))<2 then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
  if p_posting_date is null then raise exception 'INVALID_POSTING_DATE'; end if;

  select * into v_payment
  from public.supplier_payments p
  where p.id=p_payment_id
  for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=v_payment.company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  if v_payment.status='paid' then
    if v_payment.confirmation_reference is distinct from btrim(p_confirmation_reference) then raise exception 'PAYMENT_CONFIRMATION_CONFLICT'; end if;
    return query
    select p.id,p.status,j.id,j.series,j.journal_number
    from public.supplier_payments p
    join public.journal_entries j on j.id=p.accounting_entry_id and j.company_id=p.company_id
    where p.id=p_payment_id;
    return;
  end if;

  if v_payment.accounting_batch_id is not null then
    if v_payment.pending_confirmation_reference is distinct from btrim(p_confirmation_reference)
       or v_payment.pending_posting_date is distinct from p_posting_date then
      raise exception 'PAYMENT_CONFIRMATION_CONFLICT';
    end if;
    select * into v_batch
    from public.financial_batches b
    where b.company_id=v_payment.company_id and b.id=v_payment.accounting_batch_id;
    if not found then raise exception 'SUPPLIER_PAYMENT_BATCH_NOT_FOUND'; end if;
    if v_batch.status='ready' then
      return query select v_payment.id,'batch-pending'::text,null::text,'A'::text,null::text;
      return;
    end if;
    raise exception 'SUPPLIER_PAYMENT_BATCH_STATE_CONFLICT';
  end if;

  if v_payment.status<>'released' then raise exception 'PAYMENT_NOT_RELEASED'; end if;

  select * into v_invoice
  from public.supplier_invoices i
  where i.company_id=v_payment.company_id and i.id=v_payment.supplier_invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'payment-prepared' or v_invoice.remaining_ore<>v_payment.amount_ore then raise exception 'INVOICE_PAYMENT_CONFLICT'; end if;

  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=v_payment.company_id
      and ap.period=to_char(p_posting_date,'YYYY-MM')
      and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  perform set_config('app.system_batch_stage','1',true);
  select s.batch_id,s.batch_number into v_batch_id,v_batch_number
  from public.stage_source_financial_batch(
    v_payment.company_id,
    'Leverantörsbetalning '||v_invoice.supplier_invoice_number,
    'A',
    p_posting_date,
    left('Betalning leverantörsfaktura '||v_invoice.supplier_invoice_number,240),
    'supplier-payment',
    v_payment.id,
    jsonb_build_array(
      jsonb_build_object('account','2440','text','Leverantörsskuld','debitOre',v_payment.amount_ore,'creditOre',0),
      jsonb_build_object('account',v_payment.account,'text','Bankbetalning','debitOre',0,'creditOre',v_payment.amount_ore)
    ),
    'supplier-payment',
    jsonb_build_object(
      'paymentId',v_payment.id,
      'invoiceId',v_payment.supplier_invoice_id,
      'amountOre',v_payment.amount_ore,
      'account',v_payment.account,
      'confirmationReference',btrim(p_confirmation_reference)
    )
  ) s;

  update public.supplier_payments p
  set accounting_batch_id=v_batch_id,
      pending_confirmation_reference=btrim(p_confirmation_reference),
      pending_posting_date=p_posting_date,
      updated_at=now()
  where p.company_id=v_payment.company_id
    and p.id=v_payment.id
    and p.status='released'
    and p.accounting_batch_id is null;
  if not found then raise exception 'SUPPLIER_PAYMENT_BATCH_STAGE_CONFLICT'; end if;

  return query select v_payment.id,'batch-pending'::text,null::text,'A'::text,null::text;
end;
$$;

revoke all on function public.confirm_supplier_payment(text,text,date) from public,anon;
grant execute on function public.confirm_supplier_payment(text,text,date) to authenticated;

create or replace function public.post_payroll_run(p_company_id text,p_payroll_run_id text)
returns table(payroll_run_id text,journal_number text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_run public.payroll_runs%rowtype;
  v_batch public.financial_batches%rowtype;
  v_line jsonb;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_batch_id text;
  v_batch_number integer;
begin
  perform set_config('app.controlled_payroll_write','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  select * into v_run
  from public.payroll_runs r
  where r.company_id=p_company_id and r.id=p_payroll_run_id
  for update;
  if not found then raise exception 'PAYROLL_RUN_NOT_FOUND'; end if;

  if v_run.status='posted' then
    if v_run.accounting_entry_id is not null
       and exists(
         select 1 from public.journal_entries j
         where j.company_id=p_company_id and j.id=v_run.accounting_entry_id
           and j.source_type='payroll-run' and j.source_id=v_run.id
       ) then
      return query
      select v_run.id,
        (select j.series||j.journal_number from public.journal_entries j where j.company_id=p_company_id and j.id=v_run.accounting_entry_id),
        v_run.status,true;
      return;
    end if;
    raise exception 'PAYROLL_ALREADY_POSTED';
  end if;

  if v_run.accounting_batch_id is not null then
    select * into v_batch
    from public.financial_batches b
    where b.company_id=p_company_id and b.id=v_run.accounting_batch_id;
    if not found then raise exception 'PAYROLL_BATCH_NOT_FOUND'; end if;
    if v_batch.status='ready' then
      return query select v_run.id,null::text,'pending-batch'::text,true;
      return;
    end if;
    raise exception 'PAYROLL_BATCH_STATE_CONFLICT';
  end if;

  if v_run.status<>'validated' then raise exception 'INVALID_PAYROLL_STATUS'; end if;

  for v_line in select value from jsonb_array_elements(v_run.lines_json) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_PAYROLL_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_PAYROLL_JOURNAL'; end if;
  if encode(extensions.digest(convert_to(v_run.lines_json::text,'UTF8'),'sha256'),'hex')<>v_run.journal_sha256 then raise exception 'PAYROLL_POSTING_INTEGRITY_ERROR'; end if;
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id and ap.period=to_char(v_run.pay_date,'YYYY-MM') and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;
  if exists(
    select 1 from public.journal_entries j
    where j.company_id=p_company_id and j.source_type='payroll-run' and j.source_id=v_run.id
  ) then raise exception 'PAYROLL_ALREADY_POSTED'; end if;

  perform set_config('app.system_batch_stage','1',true);
  select s.batch_id,s.batch_number into v_batch_id,v_batch_number
  from public.stage_source_financial_batch(
    p_company_id,
    'Lönejournal '||v_run.period||' · '||v_run.source_name,
    'L',
    v_run.pay_date,
    left('Lönejournal '||v_run.period||' – '||v_run.source_name,240),
    'payroll-run',
    v_run.id,
    v_run.lines_json,
    'payroll-run',
    jsonb_build_object('payrollRunId',v_run.id,'journalSha256',v_run.journal_sha256)
  ) s;

  update public.payroll_runs r
  set accounting_batch_id=v_batch_id
  where r.company_id=p_company_id
    and r.id=v_run.id
    and r.status='validated'
    and r.accounting_batch_id is null;
  if not found then raise exception 'PAYROLL_BATCH_STAGE_CONFLICT'; end if;

  return query select v_run.id,null::text,'pending-batch'::text,false;
end;
$$;

revoke all on function public.post_payroll_run(text,text) from public,anon;
grant execute on function public.post_payroll_run(text,text) to authenticated;

create or replace function public.import_opening_balance(p_company_id text,p_year text,p_posting_date date,p_lines jsonb)
returns table(entry_id text,journal_number text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_line jsonb;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_existing public.journal_entries%rowtype;
  v_batch_id text;
  v_batch_number integer;
  v_existing_batch public.financial_batches%rowtype;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_year !~ '^(19|20|21)[0-9]{2}$' or p_posting_date<>(p_year||'-01-01')::date then raise exception 'INVALID_OPENING_BALANCE_DATE'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 then raise exception 'INVALID_OPENING_BALANCE'; end if;

  select * into v_existing
  from public.journal_entries j
  where j.company_id=p_company_id and j.source_type='opening-balance' and j.source_id=p_year
  limit 1;
  if found then
    return query select v_existing.id,v_existing.series||v_existing.journal_number,true;
    return;
  end if;

  select b.* into v_existing_batch
  from public.financial_batch_transactions t
  join public.financial_batches b on b.company_id=t.company_id and b.id=t.batch_id
  where t.company_id=p_company_id
    and t.source_type='opening-balance'
    and t.source_id=p_year
    and t.activation_type='opening-balance'
  order by b.created_at desc
  limit 1;
  if found then
    if v_existing_batch.status='ready' then
      return query select v_existing_batch.id,'BUNT-'||lpad(v_existing_batch.batch_number::text,5,'0'),true;
      return;
    end if;
    raise exception 'OPENING_BALANCE_BATCH_STATE_CONFLICT';
  end if;

  if exists(
    select 1 from public.journal_entries j
    where j.company_id=p_company_id
      and j.posting_date>=(p_year||'-01-01')::date
      and j.posting_date<((p_year::int+1)::text||'-01-01')::date
  ) then raise exception 'OPENING_BALANCE_REQUIRES_EMPTY_YEAR'; end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line->>'account') !~ '^[12][0-9]{3}$' then raise exception 'OPENING_BALANCE_ACCOUNT_NOT_ALLOWED'; end if;
    if (v_line->>'account') in ('1510','2440') then raise exception 'OPENING_BALANCE_SUBLEDGER_REQUIRED'; end if;
    if coalesce((v_line->>'debitOre')::bigint,0)<0 or coalesce((v_line->>'creditOre')::bigint,0)<0 then raise exception 'INVALID_OPENING_BALANCE'; end if;
    if (
      coalesce((v_line->>'debitOre')::bigint,0)=0
      and coalesce((v_line->>'creditOre')::bigint,0)=0
    ) or (
      coalesce((v_line->>'debitOre')::bigint,0)>0
      and coalesce((v_line->>'creditOre')::bigint,0)>0
    ) then raise exception 'INVALID_OPENING_BALANCE'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;

  perform set_config('app.system_batch_stage','1',true);
  select s.batch_id,s.batch_number into v_batch_id,v_batch_number
  from public.stage_source_financial_batch(
    p_company_id,
    'Ingående balans '||p_year,
    'IB',
    p_posting_date,
    'Ingående balans '||p_year,
    'opening-balance',
    p_year,
    p_lines,
    'opening-balance',
    jsonb_build_object('year',p_year)
  ) s;

  return query select v_batch_id,'BUNT-'||lpad(v_batch_number::text,5,'0'),false;
end;
$$;

revoke all on function public.import_opening_balance(text,text,date,jsonb) from public,anon;
grant execute on function public.import_opening_balance(text,text,date,jsonb) to authenticated;
