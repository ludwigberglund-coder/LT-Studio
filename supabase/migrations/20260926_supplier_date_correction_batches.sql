-- Supplier invoice date corrections in Supabase must pass through a review batch.
create table if not exists public.supplier_invoice_date_corrections(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  invoice_id text not null references public.supplier_invoices(id) on delete cascade,
  request_id text not null,
  batch_id text not null references public.financial_batches(id),
  original_entry_id text not null references public.journal_entries(id),
  reversal_entry_id text references public.journal_entries(id),
  replacement_entry_id text references public.journal_entries(id),
  old_invoice_date date not null,
  new_invoice_date date not null,
  old_due_date date not null,
  new_due_date date not null,
  reason text not null check(char_length(btrim(reason)) between 5 and 500),
  status text not null default 'pending' check(status in ('pending','approved')),
  corrected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  corrected_at timestamptz,
  unique(company_id,request_id),
  unique(company_id,id)
);
alter table public.supplier_invoice_date_corrections enable row level security;

drop policy if exists "members read supplier date corrections" on public.supplier_invoice_date_corrections;
create policy "members read supplier date corrections"
on public.supplier_invoice_date_corrections for select to authenticated
using (
  coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
  and exists(select 1 from public.company_memberships m where m.company_id=supplier_invoice_date_corrections.company_id and m.auth_user_id=(select auth.uid()))
);
drop policy if exists "controlled supplier date corrections" on public.supplier_invoice_date_corrections;
create policy "controlled supplier date corrections"
on public.supplier_invoice_date_corrections for all to authenticated
using (
  current_setting('app.supplier_date_correction_write',true)='1'
  and exists(select 1 from public.company_memberships m where m.company_id=supplier_invoice_date_corrections.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
)
with check (
  current_setting('app.supplier_date_correction_write',true)='1'
  and exists(select 1 from public.company_memberships m where m.company_id=supplier_invoice_date_corrections.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);
revoke all on public.supplier_invoice_date_corrections from anon;
grant select,insert,update on public.supplier_invoice_date_corrections to authenticated;

create or replace function public.stage_supplier_invoice_date_correction(
  p_company_id text,p_invoice_id text,p_request_id text,p_invoice_date date,p_due_date date,p_reason text
)
returns table(correction_id text,batch_id text,batch_number integer,status text)
language plpgsql security invoker set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_invoice public.supplier_invoices%rowtype;
  v_original public.journal_entries%rowtype;
  v_existing public.supplier_invoice_date_corrections%rowtype;
  v_batch_id text;v_batch_no integer;v_correction_id text;v_tx1 text;v_tx2 text;v_line record;v_line_no int;v_total bigint:=0;
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.system_batch_stage','1',true);
  perform set_config('app.supplier_date_correction_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if coalesce((select auth.jwt()->>'aal'),'aal1')<>'aal2' or not (select lt_security.session_within_personal_limit()) then raise exception 'SESSION_NOT_ALLOWED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id is null or char_length(btrim(p_request_id))<8 then raise exception 'INVALID_REQUEST_ID'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'CORRECTION_REASON_REQUIRED'; end if;
  if p_due_date<p_invoice_date then raise exception 'INVALID_CORRECTION_DATE'; end if;

  select * into v_existing from public.supplier_invoice_date_corrections c where c.company_id=p_company_id and c.request_id=p_request_id;
  if found then
    if v_existing.invoice_id<>p_invoice_id or v_existing.new_invoice_date<>p_invoice_date or v_existing.new_due_date<>p_due_date or v_existing.reason<>btrim(p_reason) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id,v_existing.batch_id,b.batch_number,v_existing.status from public.financial_batches b where b.company_id=p_company_id and b.id=v_existing.batch_id;
    return;
  end if;

  select * into v_invoice from public.supplier_invoices i where i.company_id=p_company_id and i.id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'approved' or v_invoice.liability_accounting_entry_id is null then raise exception 'DATE_CORRECTION_NOT_ALLOWED'; end if;
  if v_invoice.remaining_ore<>v_invoice.total_ore then raise exception 'OPEN_AMOUNT_MISMATCH'; end if;
  if exists(select 1 from public.supplier_payments p where p.company_id=p_company_id and p.supplier_invoice_id=p_invoice_id) then raise exception 'PAYMENT_EXISTS'; end if;
  if v_invoice.invoice_date=p_invoice_date and v_invoice.due_date=p_due_date then raise exception 'CORRECTION_NOOP'; end if;

  select * into v_original from public.journal_entries j where j.company_id=p_company_id and j.id=v_invoice.liability_accounting_entry_id;
  if not found then raise exception 'ORIGINAL_ENTRY_NOT_FOUND'; end if;
  if v_original.posting_date<>v_invoice.posting_date then raise exception 'ACCOUNTING_INTEGRITY_ERROR'; end if;

  select coalesce(sum(l.debit_ore),0) into v_total from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original.id;
  if v_total<=0 or v_total<>(select coalesce(sum(l.credit_ore),0) from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original.id) then raise exception 'ORIGINAL_ENTRY_UNBALANCED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':financial-batches',0));
  select coalesce(max(b.batch_number),9999)+1 into v_batch_no from public.financial_batches b where b.company_id=p_company_id;
  if v_batch_no>99999 then raise exception 'BATCH_NUMBER_EXHAUSTED'; end if;
  v_batch_id='batch_'||replace(gen_random_uuid()::text,'-','');
  v_correction_id='sidc_'||replace(gen_random_uuid()::text,'-','');
  v_tx1='btx_'||replace(gen_random_uuid()::text,'-','');
  v_tx2='btx_'||replace(gen_random_uuid()::text,'-','');

  insert into public.financial_batches(
    id,company_id,batch_number,title,status,kind,external_total_ore,transaction_count,total_debit_ore,total_credit_ore,
    control_state,created_by,updated_by,ready_by,ready_at
  ) values(
    v_batch_id,p_company_id,v_batch_no,left('Rätta datum · leverantörsfaktura '||v_invoice.supplier_invoice_number,160),'ready','source',
    null,2,v_total*2,v_total*2,'balanced',v_uid,v_uid,v_uid,now()
  );

  insert into public.financial_batch_transactions(
    id,company_id,batch_id,transaction_number,sequence_number,posting_date,description,source_type,source_id,
    external_amount_ore,journal_series,activation_type,activation_payload
  ) values
  (
    v_tx1,p_company_id,v_batch_id,lpad(v_batch_no::text,5,'0')||'-001',1,v_original.posting_date,
    left('Motverifikation '||v_original.series||v_original.journal_number||' · rättat fakturadatum',240),
    'supplier-invoice-date-correction-reversal',v_correction_id,v_total,v_original.series,
    'supplier-invoice-date-correction-reversal',
    jsonb_build_object('correctionId',v_correction_id,'invoiceId',p_invoice_id,'originalEntryId',v_original.id)
  ),
  (
    v_tx2,p_company_id,v_batch_id,lpad(v_batch_no::text,5,'0')||'-002',2,p_invoice_date,
    left('Rättad leverantörsfaktura '||v_invoice.supplier_invoice_number,240),
    'supplier-invoice-date-correction-replacement',v_correction_id,v_total,v_original.series,
    'supplier-invoice-date-correction',
    jsonb_build_object('correctionId',v_correction_id,'invoiceId',p_invoice_id,'originalEntryId',v_original.id,'oldInvoiceDate',v_invoice.invoice_date,'oldDueDate',v_invoice.due_date,'newInvoiceDate',p_invoice_date,'newDueDate',p_due_date,'reason',btrim(p_reason))
  );

  v_line_no=0;
  for v_line in select * from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original.id order by l.line_number loop
    v_line_no=v_line_no+1;
    insert into public.financial_batch_lines(id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore)
    values('bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx1,v_line_no,v_line.account,left('Rättelse: '||coalesce(v_line.description,''),240),v_line.credit_ore,v_line.debit_ore);
  end loop;
  v_line_no=0;
  for v_line in select * from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original.id order by l.line_number loop
    v_line_no=v_line_no+1;
    insert into public.financial_batch_lines(id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore)
    values('bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx2,v_line_no,v_line.account,v_line.description,v_line.debit_ore,v_line.credit_ore);
  end loop;

  insert into public.supplier_invoice_date_corrections(
    id,company_id,invoice_id,request_id,batch_id,original_entry_id,old_invoice_date,new_invoice_date,old_due_date,new_due_date,reason,corrected_by
  ) values(v_correction_id,p_company_id,p_invoice_id,p_request_id,v_batch_id,v_original.id,v_invoice.invoice_date,p_invoice_date,v_invoice.due_date,p_due_date,btrim(p_reason),v_uid);

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(p_company_id,v_batch_id,v_uid,'SUPPLIER_DATE_CORRECTION_STAGED',jsonb_build_object('invoiceId',p_invoice_id,'correctionId',v_correction_id,'oldInvoiceDate',v_invoice.invoice_date,'newInvoiceDate',p_invoice_date,'oldDueDate',v_invoice.due_date,'newDueDate',p_due_date));

  return query select v_correction_id,v_batch_id,v_batch_no,'pending'::text;
end;
$function$;
revoke all on function public.stage_supplier_invoice_date_correction(text,text,text,date,date,text) from public,anon;
grant execute on function public.stage_supplier_invoice_date_correction(text,text,text,date,date,text) to authenticated;

-- Extend batch approval with supplier-invoice date-correction activation.
create or replace function public.approve_financial_batch(p_company_id text,p_batch_id text)
returns table(batch_id text,batch_number integer,status text,posted_entries integer)
language plpgsql set search_path=''
as $function$
declare
  v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;v_tx record;v_line record;v_year text;v_series text;v_seq bigint;v_entry text;v_posted int:=0;v_tx_total bigint;v_self_approval boolean:=false;v_invoice_id text;v_amount bigint;v_reversal_entry text;v_correction public.supplier_invoice_date_corrections%rowtype;
begin
  perform set_config('app.financial_batch_write','1',true);perform set_config('app.financial_batch_approval','1',true);perform set_config('app.controlled_financial_write','1',true);perform set_config('app.controlled_payroll_write','1',true);perform set_config('app.audit_event_write','1',true);perform set_config('app.supplier_date_correction_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant','approver')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_batch from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then return query select v_batch.id,v_batch.batch_number,v_batch.status,0;return;end if;
  if v_batch.status<>'ready' then raise exception 'BATCH_NOT_READY'; end if;
  if v_batch.transaction_count<1 or v_batch.control_state<>'balanced' or v_batch.total_debit_ore<>v_batch.total_credit_ore then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_batch.external_total_ore is not null and v_batch.external_total_ore<>v_batch.total_debit_ore then raise exception 'EXTERNAL_TOTAL_MISMATCH'; end if;
  v_self_approval:=v_batch.created_by=v_uid or v_batch.updated_by=v_uid or v_batch.ready_by=v_uid;

  for v_tx in select * from public.financial_batch_transactions t where t.company_id=p_company_id and t.batch_id=p_batch_id order by t.sequence_number loop
    if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=to_char(v_tx.posting_date,'YYYY-MM') and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
    select coalesce(sum(l.debit_ore),0) into v_tx_total from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id;
    if v_tx_total<>(select coalesce(sum(l.credit_ore),0) from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id) or v_tx_total<=0 then raise exception 'TRANSACTION_NOT_BALANCED'; end if;
    if v_tx.external_amount_ore is not null and abs(v_tx.external_amount_ore)<>v_tx_total then raise exception 'TRANSACTION_EXTERNAL_TOTAL_MISMATCH'; end if;
    v_series=coalesce(nullif(v_tx.journal_series,''),'A');
    if v_batch.kind='manual' and v_series<>'A' then raise exception 'MANUAL_BATCH_SERIES_NOT_ALLOWED'; end if;
    if v_batch.kind='source' and v_tx.activation_type is null then raise exception 'SOURCE_BATCH_ACTIVATION_REQUIRED'; end if;
    if v_batch.kind='source' and (
      (v_tx.activation_type='customer-invoice' and (v_tx.source_type<>'customer-invoice' or v_series<>'F'))
      or (v_tx.activation_type='supplier-invoice-liability' and (v_tx.source_type<>'supplier-invoice' or v_series<>'A'))
      or (v_tx.activation_type='supplier-payment' and (v_tx.source_type<>'supplier-payment' or v_series<>'A'))
      or (v_tx.activation_type='payroll-run' and (v_tx.source_type<>'payroll-run' or v_series<>'L'))
      or (v_tx.activation_type='opening-balance' and (v_tx.source_type<>'opening-balance' or v_series<>'IB'))
      or (v_tx.activation_type='supplier-invoice-date-correction-reversal' and v_tx.source_type<>'supplier-invoice-date-correction-reversal')
      or (v_tx.activation_type='supplier-invoice-date-correction' and v_tx.source_type<>'supplier-invoice-date-correction-replacement')
    ) then raise exception 'SOURCE_BATCH_SERIES_MISMATCH'; end if;

    if v_tx.activation_type='opening-balance' then
      if v_tx.source_id !~ '^(19|20|21)[0-9]{2}$' or v_tx.posting_date<>(v_tx.source_id||'-01-01')::date then raise exception 'INVALID_OPENING_BALANCE_DATE'; end if;
      if exists(select 1 from public.journal_entries j where j.company_id=p_company_id and j.posting_date>=(v_tx.source_id||'-01-01')::date and j.posting_date<((v_tx.source_id::int+1)::text||'-01-01')::date) then raise exception 'OPENING_BALANCE_REQUIRES_EMPTY_YEAR'; end if;
    end if;

    v_year=to_char(v_tx.posting_date,'YYYY');perform pg_advisory_xact_lock(hashtextextended(p_company_id||':'||v_series||':'||v_year,0));
    insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,v_series,v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
    v_entry='entry_'||replace(gen_random_uuid()::text,'-','');
    insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
    values(v_entry,p_company_id,v_series,v_seq::text,v_tx.posting_date,v_tx.description,case when v_batch.kind='source' then v_tx.source_type else 'financial-batch' end,case when v_batch.kind='source' then v_tx.source_id else v_tx.id end,v_uid);
    for v_line in select * from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id order by l.line_number loop
      insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
      values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry,v_line.line_number,v_line.account,v_line.description,v_line.debit_ore,v_line.credit_ore);
    end loop;

    if v_tx.activation_type is not null then
      if v_batch.kind<>'source' then raise exception 'SYSTEM_ACTIVATION_ON_MANUAL_BATCH'; end if;
      if v_tx.activation_type='customer-invoice' then
        v_invoice_id=coalesce(v_tx.activation_payload->>'invoiceId',v_tx.source_id);if v_invoice_id<>v_tx.source_id then raise exception 'CUSTOMER_INVOICE_BATCH_INTEGRITY_ERROR'; end if;
        update public.invoices i set remaining_ore=i.total_ore,status='Bokförd',batch_number=lpad(v_batch.batch_number::text,5,'0'),journal_number=v_series||v_seq,updated_at=now()
        where i.company_id=p_company_id and i.id=v_invoice_id and i.status='Väntar på bunt' and i.remaining_ore=0 and i.journal_number is null;
        if not found then raise exception 'CUSTOMER_INVOICE_BATCH_ACTIVATION_CONFLICT'; end if;
      elsif v_tx.activation_type='supplier-invoice-liability' then
        update public.supplier_invoices i set liability_accounting_entry_id=v_entry,liability_posted_at=now(),updated_at=now()
        where i.company_id=p_company_id and i.id=v_tx.source_id and i.status='approved' and i.liability_accounting_entry_id is null and i.liability_batch_id=p_batch_id;
        if not found then raise exception 'SUPPLIER_LIABILITY_BATCH_ACTIVATION_CONFLICT'; end if;
      elsif v_tx.activation_type='supplier-payment' then
        v_amount=coalesce((v_tx.activation_payload->>'amountOre')::bigint,0);
        update public.supplier_payments p set status='paid',confirmation_reference=p.pending_confirmation_reference,accounting_entry_id=v_entry,paid_at=now(),updated_at=now()
        where p.company_id=p_company_id and p.id=v_tx.source_id and p.status='released' and p.accounting_batch_id=p_batch_id and p.supplier_invoice_id=(v_tx.activation_payload->>'invoiceId') and p.amount_ore=v_amount and p.account=(v_tx.activation_payload->>'account') and p.pending_posting_date=v_tx.posting_date and p.pending_confirmation_reference=(v_tx.activation_payload->>'confirmationReference');
        if not found then raise exception 'SUPPLIER_PAYMENT_BATCH_ACTIVATION_CONFLICT'; end if;
        update public.supplier_invoices i set status='paid',remaining_ore=0,updated_at=now()
        where i.company_id=p_company_id and i.id=(v_tx.activation_payload->>'invoiceId') and i.status='payment-prepared' and i.remaining_ore=v_amount;
        if not found then raise exception 'INVOICE_PAYMENT_CONFLICT'; end if;
      elsif v_tx.activation_type='payroll-run' then
        update public.payroll_runs r set status='posted',posted_by=v_uid,posted_at=now(),accounting_entry_id=v_entry
        where r.company_id=p_company_id and r.id=v_tx.source_id and r.status='validated' and r.accounting_batch_id=p_batch_id and r.journal_sha256=(v_tx.activation_payload->>'journalSha256');
        if not found then raise exception 'PAYROLL_BATCH_ACTIVATION_CONFLICT'; end if;
      elsif v_tx.activation_type='opening-balance' then
        if (v_tx.activation_payload->>'year') is distinct from v_tx.source_id then raise exception 'OPENING_BALANCE_BATCH_INTEGRITY_ERROR'; end if;
      elsif v_tx.activation_type='supplier-invoice-date-correction-reversal' then
        if (v_tx.activation_payload->>'correctionId') is distinct from v_tx.source_id then raise exception 'SUPPLIER_DATE_CORRECTION_INTEGRITY_ERROR'; end if;
      elsif v_tx.activation_type='supplier-invoice-date-correction' then
        select * into v_correction from public.supplier_invoice_date_corrections c where c.company_id=p_company_id and c.id=v_tx.source_id for update;
        if not found or v_correction.batch_id<>p_batch_id or v_correction.status<>'pending' then raise exception 'SUPPLIER_DATE_CORRECTION_STATE_ERROR'; end if;
        select j.id into v_reversal_entry from public.journal_entries j where j.company_id=p_company_id and j.source_type='supplier-invoice-date-correction-reversal' and j.source_id=v_correction.id order by j.created_at desc limit 1;
        if v_reversal_entry is null then raise exception 'SUPPLIER_DATE_CORRECTION_REVERSAL_MISSING'; end if;
        update public.supplier_invoices i set invoice_date=v_correction.new_invoice_date,posting_date=v_correction.new_invoice_date,due_date=v_correction.new_due_date,liability_accounting_entry_id=v_entry,liability_posted_at=now(),updated_at=now()
        where i.company_id=p_company_id and i.id=v_correction.invoice_id and i.status='approved' and i.liability_accounting_entry_id=v_correction.original_entry_id and i.invoice_date=v_correction.old_invoice_date and i.due_date=v_correction.old_due_date and i.remaining_ore=i.total_ore and not exists(select 1 from public.supplier_payments p where p.company_id=i.company_id and p.supplier_invoice_id=i.id);
        if not found then raise exception 'SUPPLIER_DATE_CORRECTION_CONFLICT'; end if;
        update public.supplier_invoice_date_corrections c set reversal_entry_id=v_reversal_entry,replacement_entry_id=v_entry,status='approved',corrected_at=now() where c.company_id=p_company_id and c.id=v_correction.id;
        insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
        values(p_company_id,v_uid,'SUPPLIER_INVOICE_DATES_CORRECTED','supplier-invoice',v_correction.invoice_id,jsonb_build_object('correctionId',v_correction.id,'batchNumber',v_batch.batch_number,'reason',v_correction.reason,'oldInvoiceDate',v_correction.old_invoice_date,'newInvoiceDate',v_correction.new_invoice_date,'oldDueDate',v_correction.old_due_date,'newDueDate',v_correction.new_due_date,'originalEntryId',v_correction.original_entry_id,'reversalEntryId',v_reversal_entry,'replacementEntryId',v_entry));
      else raise exception 'UNSUPPORTED_SOURCE_BATCH_ACTIVATION'; end if;
    end if;
    v_posted:=v_posted+1;
  end loop;

  update public.financial_batches b set status='approved',approved_by=v_uid,approved_at=now(),updated_by=v_uid,updated_at=now() where b.company_id=p_company_id and b.id=p_batch_id;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details) values(p_company_id,p_batch_id,v_uid,'BATCH_APPROVED',jsonb_build_object('postedEntries',v_posted,'selfApproval',v_self_approval,'kind',v_batch.kind));
  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details) values(p_company_id,v_uid,'FINANCIAL_BATCH_APPROVED','financial_batch',p_batch_id,jsonb_build_object('batchNumber',v_batch.batch_number,'postedEntries',v_posted,'selfApproval',v_self_approval,'kind',v_batch.kind));
  return query select b.id,b.batch_number,b.status,v_posted from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id;
end;
$function$;
revoke all on function public.approve_financial_batch(text,text) from public,anon;
grant execute on function public.approve_financial_batch(text,text) to authenticated;

do $block$
begin
  if not exists(select 1 from pg_publication_tables p where p.pubname='supabase_realtime' and p.schemaname='public' and p.tablename='supplier_invoice_date_corrections') then
    alter publication supabase_realtime add table public.supplier_invoice_date_corrections;
  end if;
end;
$block$;
