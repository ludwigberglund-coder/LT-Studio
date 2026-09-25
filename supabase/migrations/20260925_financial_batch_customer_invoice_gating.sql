-- Route source-originated financial events through the financial batch quality gate.
-- Phase 1: shared source-batch infrastructure + customer invoice staging.
-- No source batch affects the general ledger or receivables before batch approval.

alter table public.financial_batches
  add column if not exists kind text not null default 'manual';

alter table public.financial_batch_transactions
  add column if not exists journal_series text not null default 'A',
  add column if not exists activation_type text,
  add column if not exists activation_payload jsonb;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='financial_batches_kind_check' and conrelid='public.financial_batches'::regclass) then
    alter table public.financial_batches
      add constraint financial_batches_kind_check check(kind in ('manual','source'));
  end if;
  if not exists(select 1 from pg_constraint where conname='financial_batch_transactions_series_check' and conrelid='public.financial_batch_transactions'::regclass) then
    alter table public.financial_batch_transactions
      add constraint financial_batch_transactions_series_check check(journal_series ~ '^[A-Z]{1,3}$');
  end if;
end
$$;

create unique index if not exists financial_batch_source_activation_unique
  on public.financial_batch_transactions(company_id,source_type,source_id,activation_type)
  where activation_type is not null and source_id is not null;

-- Source batches are writable only while a trusted source RPC stages them.
drop policy if exists "members insert financial batches" on public.financial_batches;
create policy "members insert financial batches"
on public.financial_batches for insert to authenticated
with check (
  (
    kind='manual'
    and exists(
      select 1 from public.company_memberships m
      where m.company_id=financial_batches.company_id
        and m.auth_user_id=(select auth.uid())
        and m.role in ('admin','accountant')
    )
  )
  or
  (
    kind='source'
    and current_setting('app.system_batch_stage',true)='1'
    and exists(
      select 1 from public.company_memberships m
      where m.company_id=financial_batches.company_id
        and m.auth_user_id=(select auth.uid())
        and m.role in ('admin','accountant')
    )
  )
);

drop policy if exists "members update financial batches" on public.financial_batches;
create policy "members update financial batches"
on public.financial_batches for update to authenticated
using (
  exists(
    select 1 from public.company_memberships m
    where m.company_id=financial_batches.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant','approver')
  )
  and (
    financial_batches.kind='manual'
    or current_setting('app.system_batch_stage',true)='1'
    or current_setting('app.financial_batch_approval',true)='1'
  )
)
with check (
  exists(
    select 1 from public.company_memberships m
    where m.company_id=financial_batches.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant','approver')
  )
  and (
    financial_batches.kind='manual'
    or current_setting('app.system_batch_stage',true)='1'
    or current_setting('app.financial_batch_approval',true)='1'
  )
);

drop policy if exists "members insert financial batch transactions" on public.financial_batch_transactions;
create policy "members insert financial batch transactions"
on public.financial_batch_transactions for insert to authenticated
with check (
  exists(
    select 1
    from public.financial_batches b
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where b.company_id=financial_batch_transactions.company_id
      and b.id=financial_batch_transactions.batch_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
);

drop policy if exists "members update financial batch transactions" on public.financial_batch_transactions;
create policy "members update financial batch transactions"
on public.financial_batch_transactions for update to authenticated
using (
  exists(
    select 1
    from public.financial_batches b
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where b.company_id=financial_batch_transactions.company_id
      and b.id=financial_batch_transactions.batch_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
)
with check (
  exists(
    select 1
    from public.financial_batches b
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where b.company_id=financial_batch_transactions.company_id
      and b.id=financial_batch_transactions.batch_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
);

drop policy if exists "members delete financial batch transactions" on public.financial_batch_transactions;
create policy "members delete financial batch transactions"
on public.financial_batch_transactions for delete to authenticated
using (
  exists(
    select 1
    from public.financial_batches b
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where b.company_id=financial_batch_transactions.company_id
      and b.id=financial_batch_transactions.batch_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
);

drop policy if exists "members insert financial batch lines" on public.financial_batch_lines;
create policy "members insert financial batch lines"
on public.financial_batch_lines for insert to authenticated
with check (
  exists(
    select 1
    from public.financial_batch_transactions t
    join public.financial_batches b on b.company_id=t.company_id and b.id=t.batch_id
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where t.company_id=financial_batch_lines.company_id
      and t.id=financial_batch_lines.transaction_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
);

drop policy if exists "members update financial batch lines" on public.financial_batch_lines;
create policy "members update financial batch lines"
on public.financial_batch_lines for update to authenticated
using (
  exists(
    select 1
    from public.financial_batch_transactions t
    join public.financial_batches b on b.company_id=t.company_id and b.id=t.batch_id
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where t.company_id=financial_batch_lines.company_id
      and t.id=financial_batch_lines.transaction_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
)
with check (
  exists(
    select 1
    from public.financial_batch_transactions t
    join public.financial_batches b on b.company_id=t.company_id and b.id=t.batch_id
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where t.company_id=financial_batch_lines.company_id
      and t.id=financial_batch_lines.transaction_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
);

drop policy if exists "members delete financial batch lines" on public.financial_batch_lines;
create policy "members delete financial batch lines"
on public.financial_batch_lines for delete to authenticated
using (
  exists(
    select 1
    from public.financial_batch_transactions t
    join public.financial_batches b on b.company_id=t.company_id and b.id=t.batch_id
    join public.company_memberships m
      on m.company_id=b.company_id
     and m.auth_user_id=(select auth.uid())
     and m.role in ('admin','accountant')
    where t.company_id=financial_batch_lines.company_id
      and t.id=financial_batch_lines.transaction_id
      and (b.kind='manual' or current_setting('app.system_batch_stage',true)='1')
  )
);

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
  if p_activation_type not in ('customer-invoice') then raise exception 'UNSUPPORTED_SOURCE_BATCH_ACTIVATION'; end if;
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

-- Approving a batch is the only operation that may move a source event into the ledger/reskontra.
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
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.financial_batch_approval','1',true);
  perform set_config('app.controlled_financial_write','1',true);
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
        if v_tx.source_type<>'customer-invoice' or v_invoice_id<>v_tx.source_id or v_series<>'F' then
          raise exception 'CUSTOMER_INVOICE_BATCH_INTEGRITY_ERROR';
        end if;

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

-- Customer invoice finalization now archives the immutable document and stages a ready F-series batch.
-- The invoice is deliberately excluded from receivables until that batch is approved.
create or replace function public.finalize_customer_invoice(
  p_company_id text,p_request_id text,p_payload_sha256 text,p_customer_number text,p_invoice_date date,p_posting_date date,p_due_date date,
  p_total_ore bigint,p_vat_ore bigint,p_payment_account text,p_document_json jsonb,p_document_sha256 text,p_pdf_sha256 text,
  p_object_path text,p_file_name text,p_size_bytes bigint,p_journal_lines jsonb
)
returns table(invoice_id text,invoice_number text,journal_number text,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_res public.customer_invoice_number_reservations%rowtype;
  v_customer_id text;
  v_customer_name text;
  v_period text;
  v_invoice_id text;
  v_line jsonb;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_receivable numeric:=0;
  v_batch_id text;
  v_batch_number integer;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PAYLOAD_HASH'; end if;
  if p_total_ore=0 or abs(p_vat_ore)>abs(p_total_ore) then raise exception 'INVALID_INVOICE_AMOUNT'; end if;
  if p_document_sha256 !~ '^[0-9a-f]{64}$' or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_DOCUMENT_HASH'; end if;
  if p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'INVALID_PDF_SIZE'; end if;
  if jsonb_typeof(p_journal_lines)<>'array' or jsonb_array_length(p_journal_lines)<2 then raise exception 'INVALID_JOURNAL'; end if;

  select * into v_res
  from public.customer_invoice_number_reservations r
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status in ('reserved','issued')
  for update;
  if not found then raise exception 'INVOICE_RESERVATION_NOT_FOUND'; end if;
  if v_res.purpose<>'invoice' then raise exception 'INVALID_RESERVATION_PURPOSE'; end if;
  if v_res.payload_sha256<>p_payload_sha256 then raise exception 'INVOICE_IDEMPOTENCY_CONFLICT'; end if;

  if v_res.status='issued' and v_res.issued_invoice_id is not null then
    return query
    select i.id,i.invoice_number,i.journal_number,
      case when i.status='Väntar på bunt' then 'pending-batch' else 'duplicate' end
    from public.invoices i
    where i.company_id=p_company_id and i.id=v_res.issued_invoice_id;
    return;
  end if;

  if (p_document_json->>'documentType') is distinct from 'FAKTURA'
     or (p_document_json->>'invoiceNumber') is distinct from v_res.invoice_number
     or (p_document_json->>'ocr') is distinct from v_res.invoice_number
     or (p_document_json->>'customerNumber') is distinct from p_customer_number
     or (p_document_json->>'invoiceDate')::date is distinct from p_invoice_date
     or (p_document_json->>'postingDate')::date is distinct from p_posting_date
     or (p_document_json->>'dueDate')::date is distinct from p_due_date
     or coalesce((p_document_json->>'totalOre')::bigint,0)<>p_total_ore
     or coalesce((p_document_json->>'vatOre')::bigint,0)<>p_vat_ore then
    raise exception 'INVOICE_DOCUMENT_MISMATCH';
  end if;

  select c.id,c.name into v_customer_id,v_customer_name
  from public.customers c
  where c.company_id=p_company_id and c.customer_number=p_customer_number and c.archived_at is null;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  v_period:=to_char(p_posting_date,'YYYY-MM');
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
    if (v_line->>'account')='1510' then
      v_receivable:=v_receivable+coalesce((v_line->>'debitOre')::numeric,0)-coalesce((v_line->>'creditOre')::numeric,0);
    end if;
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
  if v_receivable<>p_total_ore then raise exception 'INVOICE_RECEIVABLE_MISMATCH'; end if;

  v_invoice_id='invoice_'||replace(gen_random_uuid()::text,'-','');

  perform set_config('app.system_batch_stage','1',true);
  select s.batch_id,s.batch_number into v_batch_id,v_batch_number
  from public.stage_source_financial_batch(
    p_company_id,
    'Kundfaktura '||v_res.invoice_number||' · '||v_customer_name,
    'F',
    p_posting_date,
    left('Kundfaktura '||v_res.invoice_number||' · '||v_customer_name,240),
    'customer-invoice',
    v_invoice_id,
    p_journal_lines,
    'customer-invoice',
    jsonb_build_object('invoiceId',v_invoice_id,'invoiceNumber',v_res.invoice_number)
  ) s;

  insert into public.invoices(
    id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,total_ore,remaining_ore,vat_ore,status,
    payment_method,payment_account,invoice_account,batch_number,journal_number,pdf_sha256
  ) values(
    v_invoice_id,p_company_id,v_customer_id,v_res.invoice_number,v_res.invoice_number,p_invoice_date,p_posting_date,p_due_date,
    p_total_ore,0,p_vat_ore,'Väntar på bunt','Bankgiro',p_payment_account,'1510',lpad(v_batch_number::text,5,'0'),null,p_pdf_sha256
  );

  insert into public.customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,object_path,file_name,pdf_sha256,size_bytes)
  values(v_invoice_id,p_company_id,p_document_json,p_document_sha256,p_object_path,p_file_name,p_pdf_sha256,p_size_bytes);

  insert into public.documents(id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by,title,category,note)
  values(
    'doc_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_object_path,p_file_name,'application/pdf',p_size_bytes,p_pdf_sha256,
    'customer-invoice',v_invoice_id,v_uid,'Kundfaktura '||v_res.invoice_number,'customer-invoice',
    'Väntar på godkännande av bunt #'||lpad(v_batch_number::text,5,'0')
  );

  update public.customer_invoice_number_reservations r
  set issued_invoice_id=v_invoice_id,status='issued',updated_at=now()
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status='reserved';
  if not found then raise exception 'INVOICE_RESERVATION_STATE_ERROR'; end if;

  delete from public.customer_invoice_drafts d
  where d.company_id=p_company_id and d.user_id=v_uid and d.request_id=p_request_id;

  return query select v_invoice_id,v_res.invoice_number,null::text,'pending-batch'::text;
end;
$$;

revoke all on function public.finalize_customer_invoice(text,text,text,text,date,date,date,bigint,bigint,text,jsonb,text,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.finalize_customer_invoice(text,text,text,text,date,date,date,bigint,bigint,text,jsonb,text,text,text,text,bigint,jsonb) to authenticated;
