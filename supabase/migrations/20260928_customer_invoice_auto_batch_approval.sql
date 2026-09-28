-- Automatically approve customer invoice and customer credit source batches.
-- Safety model:
--  * the source document and journal lines are validated first;
--  * a balanced source batch is created before ledger/receivables activation;
--  * batch approval and financial activation happen in the same database transaction;
--  * any failure rolls back the whole operation, so no half-posted invoice can remain.

create or replace function public.auto_approve_customer_invoice_batch()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_batch public.financial_batches%rowtype;
  v_tx public.financial_batch_transactions%rowtype;
  v_year text;
  v_seq bigint;
  v_entry_id text;
  v_line record;
  v_debit bigint:=0;
  v_credit bigint:=0;
  v_receivable bigint:=0;
begin
  if new.status<>'Väntar på bunt' or new.batch_number is null then
    return new;
  end if;
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=new.company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.financial_batch_approval','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  perform set_config('app.audit_event_write','1',true);

  select b.* into v_batch
  from public.financial_batches b
  where b.company_id=new.company_id
    and lpad(b.batch_number::text,5,'0')=new.batch_number
    and b.kind='source'
  for update;
  if not found then raise exception 'CUSTOMER_INVOICE_BATCH_NOT_FOUND'; end if;
  if v_batch.status<>'ready'
     or v_batch.control_state<>'balanced'
     or v_batch.transaction_count<>1
     or v_batch.total_debit_ore<>v_batch.total_credit_ore
     or v_batch.total_debit_ore<=0 then
    raise exception 'CUSTOMER_INVOICE_BATCH_NOT_READY';
  end if;

  select t.* into v_tx
  from public.financial_batch_transactions t
  where t.company_id=new.company_id
    and t.batch_id=v_batch.id
    and t.source_type='customer-invoice'
    and t.source_id=new.id
    and t.activation_type='customer-invoice'
    and t.journal_series='F'
  for update;
  if not found then raise exception 'CUSTOMER_INVOICE_BATCH_INTEGRITY_ERROR'; end if;

  for v_line in
    select * from public.financial_batch_lines l
    where l.company_id=new.company_id and l.transaction_id=v_tx.id
    order by l.line_number
  loop
    if v_line.account !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    if v_line.debit_ore<0 or v_line.credit_ore<0 then raise exception 'NEGATIVE_BOOKING_AMOUNT'; end if;
    if not ((v_line.debit_ore>0 and v_line.credit_ore=0) or (v_line.credit_ore>0 and v_line.debit_ore=0)) then
      raise exception 'INVALID_BOOKING_LINE';
    end if;
    v_debit:=v_debit+v_line.debit_ore;
    v_credit:=v_credit+v_line.credit_ore;
    if v_line.account='1510' then
      v_receivable:=v_receivable+v_line.debit_ore-v_line.credit_ore;
    end if;
  end loop;

  if v_debit<>v_credit or v_debit<=0 then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_debit<>v_batch.total_debit_ore then raise exception 'BATCH_TOTAL_MISMATCH'; end if;
  if v_receivable<>new.total_ore then raise exception 'INVOICE_RECEIVABLE_MISMATCH'; end if;
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=new.company_id
      and ap.period=to_char(v_tx.posting_date,'YYYY-MM')
      and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;
  if exists(
    select 1 from public.journal_entries j
    where j.company_id=new.company_id and j.source_type='customer-invoice' and j.source_id=new.id
  ) then raise exception 'CUSTOMER_INVOICE_ALREADY_POSTED'; end if;

  v_year:=to_char(v_tx.posting_date,'YYYY');
  perform pg_advisory_xact_lock(hashtextextended(new.company_id||':F:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(new.company_id,'F',v_year,1)
  on conflict(company_id,series,fiscal_year)
  do update set last_number=public.accounting_sequences.last_number+1
  returning last_number into v_seq;

  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(
    id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by
  ) values(
    v_entry_id,new.company_id,'F',v_seq::text,v_tx.posting_date,v_tx.description,
    'customer-invoice',new.id,v_uid
  );

  insert into public.journal_lines(
    id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore
  )
  select
    'jline_'||replace(gen_random_uuid()::text,'-',''),
    l.company_id,v_entry_id,l.line_number,l.account,l.description,l.debit_ore,l.credit_ore
  from public.financial_batch_lines l
  where l.company_id=new.company_id and l.transaction_id=v_tx.id
  order by l.line_number;

  update public.invoices i
  set remaining_ore=i.total_ore,
      status='Bokförd',
      journal_number='F'||v_seq,
      updated_at=now()
  where i.company_id=new.company_id
    and i.id=new.id
    and i.status='Väntar på bunt'
    and i.remaining_ore=0
    and i.journal_number is null;
  if not found then raise exception 'CUSTOMER_INVOICE_BATCH_ACTIVATION_CONFLICT'; end if;

  update public.financial_batches b
  set status='approved',approved_by=v_uid,approved_at=now(),updated_by=v_uid,updated_at=now()
  where b.company_id=new.company_id and b.id=v_batch.id and b.status='ready';
  if not found then raise exception 'CUSTOMER_INVOICE_BATCH_APPROVAL_CONFLICT'; end if;

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    new.company_id,v_batch.id,v_uid,'BATCH_AUTO_APPROVED',
    jsonb_build_object(
      'sourceType','customer-invoice',
      'sourceId',new.id,
      'journalNumber','F'||v_seq,
      'reason','create-and-post-customer-invoice'
    )
  );

  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    new.company_id,v_uid,'FINANCIAL_BATCH_AUTO_APPROVED','financial_batch',v_batch.id,
    jsonb_build_object(
      'batchNumber',v_batch.batch_number,
      'sourceType','customer-invoice',
      'sourceId',new.id,
      'journalNumber','F'||v_seq
    )
  );

  return new;
end;
$$;

drop trigger if exists auto_approve_customer_invoice_batch_after_insert on public.invoices;
create trigger auto_approve_customer_invoice_batch_after_insert
after insert on public.invoices
for each row
when (new.status='Väntar på bunt' and new.batch_number is not null)
execute function public.auto_approve_customer_invoice_batch();

revoke all on function public.auto_approve_customer_invoice_batch() from public,anon;
grant execute on function public.auto_approve_customer_invoice_batch() to authenticated;

create or replace function public.finalize_customer_credit(
  p_company_id text,p_request_id text,p_payload_sha256 text,p_original_invoice_id text,p_credit_date date,p_reason text,
  p_credit_amount_ore bigint,p_document_json jsonb,p_document_sha256 text,p_pdf_sha256 text,p_object_path text,
  p_file_name text,p_size_bytes bigint,p_journal_lines jsonb
)
returns table(credit_invoice_id text,credit_invoice_number text,journal_number text,offset_amount_ore bigint,refund_due_ore bigint,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_res public.customer_invoice_number_reservations%rowtype;
  v_original public.invoices%rowtype;
  v_customer_name text;
  v_credited bigint:=0;
  v_offset bigint;
  v_refund bigint;
  v_period text;
  v_year text;
  v_seq bigint;
  v_entry_id text;
  v_credit_id text;
  v_line jsonb;
  v_line_no int:=0;
  v_debit bigint:=0;
  v_credit bigint:=0;
  v_receivable_credit bigint:=0;
  v_original_entry text;
  v_original_receivable bigint:=0;
  v_remaining_after bigint;
  v_credited_after bigint;
  v_batch_id text;
  v_batch_number integer;
  v_tx_id text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_document_sha256 !~ '^[0-9a-f]{64}$'
     or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_HASH'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<5 or char_length(btrim(coalesce(p_reason,'')))>500 then raise exception 'CREDIT_REASON_REQUIRED'; end if;
  if p_credit_amount_ore<=0 then raise exception 'INVALID_CREDIT_AMOUNT'; end if;
  if p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'INVALID_PDF_SIZE'; end if;
  if jsonb_typeof(p_journal_lines)<>'array' or jsonb_array_length(p_journal_lines)<2 then raise exception 'INVALID_JOURNAL'; end if;

  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.financial_batch_approval','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  perform set_config('app.audit_event_write','1',true);
  perform set_config('app.system_batch_stage','1',true);

  select * into v_res
  from public.customer_invoice_number_reservations r
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status in ('reserved','issued')
  for update;
  if not found then raise exception 'INVOICE_RESERVATION_NOT_FOUND'; end if;
  if v_res.purpose<>'credit' or v_res.source_invoice_id is distinct from p_original_invoice_id then raise exception 'INVALID_RESERVATION_PURPOSE'; end if;
  if v_res.payload_sha256<>p_payload_sha256 then raise exception 'INVOICE_IDEMPOTENCY_CONFLICT'; end if;

  if v_res.status='issued' and v_res.issued_invoice_id is not null then
    select a.offset_amount_ore,a.refund_due_ore into v_offset,v_refund
    from public.customer_invoice_credit_adjustments a
    where a.company_id=p_company_id and a.credit_invoice_id=v_res.issued_invoice_id;
    return query
    select i.id,i.invoice_number,i.journal_number,v_offset,v_refund,'duplicate'::text
    from public.invoices i
    where i.company_id=p_company_id and i.id=v_res.issued_invoice_id;
    return;
  end if;

  select * into v_original
  from public.invoices i
  where i.company_id=p_company_id and i.id=p_original_invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_original.total_ore<=0 then raise exception 'CREDIT_SOURCE_INVALID'; end if;
  if v_original.status='Väntar på bunt' or v_original.journal_number is null then raise exception 'CREDIT_SOURCE_NOT_POSTED'; end if;
  if v_original.remaining_ore<0 or v_original.remaining_ore>v_original.total_ore then raise exception 'CREDIT_BALANCE_HISTORY_INVALID'; end if;

  if not exists(
    select 1 from public.customer_invoice_documents d
    where d.company_id=p_company_id and d.invoice_id=p_original_invoice_id
  ) then raise exception 'INVOICE_DOCUMENT_REQUIRED'; end if;

  select j.id into v_original_entry
  from public.journal_entries j
  where j.company_id=p_company_id
    and j.source_type='customer-invoice'
    and j.source_id=p_original_invoice_id
  order by j.created_at
  limit 1;
  if v_original_entry is null then raise exception 'INVOICE_ACCOUNTING_ENTRY_REQUIRED'; end if;

  select coalesce(sum(l.debit_ore-l.credit_ore),0) into v_original_receivable
  from public.journal_lines l
  where l.company_id=p_company_id and l.journal_entry_id=v_original_entry and l.account='1510';
  if v_original_receivable<>v_original.total_ore then raise exception 'INVOICE_ACCOUNTING_MISMATCH'; end if;

  select coalesce(sum(a.credit_amount_ore),0) into v_credited
  from public.customer_invoice_credit_adjustments a
  where a.company_id=p_company_id and a.original_invoice_id=p_original_invoice_id;
  if p_credit_amount_ore>v_original.total_ore-v_credited then raise exception 'CREDIT_AMOUNT_EXCEEDS_AVAILABLE'; end if;

  v_offset:=least(p_credit_amount_ore,v_original.remaining_ore);
  v_refund:=p_credit_amount_ore-v_offset;
  v_remaining_after:=v_original.remaining_ore-v_offset;
  v_credited_after:=v_credited+p_credit_amount_ore;

  if (p_document_json->>'documentType') is distinct from 'KREDITFAKTURA'
     or (p_document_json->>'invoiceNumber') is distinct from v_res.invoice_number
     or (p_document_json->>'creditOfInvoiceNumber') is distinct from v_original.invoice_number
     or coalesce((p_document_json->>'totalOre')::bigint,0)<>-p_credit_amount_ore then
    raise exception 'CREDIT_DOCUMENT_MISMATCH';
  end if;

  v_period:=to_char(p_credit_date,'YYYY-MM');
  if exists(
    select 1 from public.accounting_periods ap
    where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked'
  ) then raise exception 'PERIOD_LOCKED'; end if;

  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    if coalesce((v_line->>'debitOre')::bigint,0)<0 or coalesce((v_line->>'creditOre')::bigint,0)<0 then
      raise exception 'NEGATIVE_BOOKING_AMOUNT';
    end if;
    if not (
      (coalesce((v_line->>'debitOre')::bigint,0)>0 and coalesce((v_line->>'creditOre')::bigint,0)=0)
      or
      (coalesce((v_line->>'creditOre')::bigint,0)>0 and coalesce((v_line->>'debitOre')::bigint,0)=0)
    ) then raise exception 'INVALID_BOOKING_LINE'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::bigint,0);
    v_credit:=v_credit+coalesce((v_line->>'creditOre')::bigint,0);
    if (v_line->>'account')='1510' then
      v_receivable_credit:=v_receivable_credit
        +coalesce((v_line->>'creditOre')::bigint,0)
        -coalesce((v_line->>'debitOre')::bigint,0);
    end if;
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
  if v_receivable_credit<>p_credit_amount_ore then raise exception 'CREDIT_RECEIVABLE_MISMATCH'; end if;

  v_credit_id:='invoice_'||replace(gen_random_uuid()::text,'-','');
  select c.name into v_customer_name
  from public.customers c
  where c.company_id=p_company_id and c.id=v_original.customer_id;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':financial-batches',0));
  select coalesce(max(b.batch_number),9999)+1 into v_batch_number
  from public.financial_batches b
  where b.company_id=p_company_id;
  if v_batch_number>99999 then raise exception 'BATCH_NUMBER_EXHAUSTED'; end if;

  v_batch_id:='batch_'||replace(gen_random_uuid()::text,'-','');
  v_tx_id:='btx_'||replace(gen_random_uuid()::text,'-','');

  insert into public.financial_batches(
    id,company_id,batch_number,title,status,kind,external_total_ore,transaction_count,total_debit_ore,total_credit_ore,
    control_state,created_by,updated_by,ready_by,ready_at
  ) values(
    v_batch_id,p_company_id,v_batch_number,
    left('Kreditfaktura '||v_res.invoice_number||' · '||coalesce(v_customer_name,''),160),
    'ready','source',v_debit,1,v_debit,v_credit,'balanced',v_uid,v_uid,v_uid,now()
  );

  insert into public.financial_batch_transactions(
    id,company_id,batch_id,transaction_number,sequence_number,posting_date,description,source_type,source_id,
    external_amount_ore,journal_series,activation_type,activation_payload
  ) values(
    v_tx_id,p_company_id,v_batch_id,lpad(v_batch_number::text,5,'0')||'-001',1,p_credit_date,
    left('Kreditfaktura '||v_res.invoice_number||' av '||v_original.invoice_number,240),
    'customer-credit-note',v_credit_id,v_debit,'F','customer-credit-note',
    jsonb_build_object(
      'creditInvoiceId',v_credit_id,
      'originalInvoiceId',p_original_invoice_id,
      'creditAmountOre',p_credit_amount_ore,
      'offsetAmountOre',v_offset,
      'refundDueOre',v_refund
    )
  );

  v_line_no:=0;
  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    v_line_no:=v_line_no+1;
    insert into public.financial_batch_lines(
      id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore
    ) values(
      'bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx_id,v_line_no,v_line->>'account',
      left(coalesce(v_line->>'text',''),240),
      coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0)
    );
  end loop;

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,v_batch_id,v_uid,'SOURCE_BATCH_STAGED',
    jsonb_build_object(
      'sourceType','customer-credit-note',
      'sourceId',v_credit_id,
      'activationType','customer-credit-note',
      'journalSeries','F'
    )
  );

  insert into public.invoices(
    id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,total_ore,remaining_ore,vat_ore,status,
    payment_method,payment_account,invoice_account,batch_number,journal_number,pdf_sha256
  ) values(
    v_credit_id,p_company_id,v_original.customer_id,v_res.invoice_number,v_res.invoice_number,p_credit_date,p_credit_date,p_credit_date,
    -p_credit_amount_ore,0,coalesce((p_document_json->>'vatOre')::bigint,0),'Väntar på bunt',
    v_original.payment_method,v_original.payment_account,'1510',lpad(v_batch_number::text,5,'0'),null,p_pdf_sha256
  );

  insert into public.customer_invoice_documents(
    invoice_id,company_id,document_json,document_sha256,object_path,file_name,pdf_sha256,size_bytes
  ) values(
    v_credit_id,p_company_id,p_document_json,p_document_sha256,p_object_path,p_file_name,p_pdf_sha256,p_size_bytes
  );

  insert into public.documents(
    id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by,title,category,note
  ) values(
    'doc_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_object_path,p_file_name,'application/pdf',
    p_size_bytes,p_pdf_sha256,'customer-invoice',v_credit_id,v_uid,
    'Kreditfaktura '||v_res.invoice_number,'customer-invoice',
    'Automatiskt godkänd via bunt #'||lpad(v_batch_number::text,5,'0')
  );

  insert into public.customer_invoice_credit_adjustments(
    company_id,request_id,original_invoice_id,credit_invoice_id,reason,credit_amount_ore,offset_amount_ore,refund_due_ore,created_by
  ) values(
    p_company_id,p_request_id,p_original_invoice_id,v_credit_id,btrim(p_reason),
    p_credit_amount_ore,v_offset,v_refund,v_uid
  );

  update public.customer_invoice_number_reservations r
  set issued_invoice_id=v_credit_id,status='issued',updated_at=now()
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status='reserved';
  if not found then raise exception 'INVOICE_RESERVATION_STATE_ERROR'; end if;

  -- Auto-approve the staged credit batch in the same transaction.
  v_year:=to_char(p_credit_date,'YYYY');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':F:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(p_company_id,'F',v_year,1)
  on conflict(company_id,series,fiscal_year)
  do update set last_number=public.accounting_sequences.last_number+1
  returning last_number into v_seq;

  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(
    id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by
  ) values(
    v_entry_id,p_company_id,'F',v_seq::text,p_credit_date,
    left('Kreditfaktura '||v_res.invoice_number||' av '||v_original.invoice_number,240),
    'customer-credit-note',v_credit_id,v_uid
  );

  insert into public.journal_lines(
    id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore
  )
  select
    'jline_'||replace(gen_random_uuid()::text,'-',''),
    l.company_id,v_entry_id,l.line_number,l.account,l.description,l.debit_ore,l.credit_ore
  from public.financial_batch_lines l
  where l.company_id=p_company_id and l.transaction_id=v_tx_id
  order by l.line_number;

  if v_offset>0 then
    insert into public.invoice_transactions(
      id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,
      batch_number,journal_number,amount_ore,approved,account,bank_reference
    ) values(
      'transaction_'||replace(gen_random_uuid()::text,'-',''),
      p_company_id,p_original_invoice_id,'credit-offset','Kreditfaktura',p_credit_date,p_credit_date,
      lpad(v_batch_number::text,5,'0'),'F'||v_seq,-v_offset,true,'1510','credit:'||v_credit_id||':offset'
    );
  end if;

  update public.invoices i
  set remaining_ore=v_remaining_after,
      status=case when v_credited_after>=v_original.total_ore then 'Krediterad' else 'Delvis krediterad' end,
      updated_at=now()
  where i.company_id=p_company_id
    and i.id=p_original_invoice_id
    and i.remaining_ore=v_original.remaining_ore;
  if not found then raise exception 'CREDIT_SETTLEMENT_CHANGED'; end if;

  update public.invoices i
  set remaining_ore=-v_refund,
      status=case when v_refund>0 then 'Kreditfaktura · återbetalning väntar' else 'Kreditfaktura' end,
      journal_number='F'||v_seq,
      updated_at=now()
  where i.company_id=p_company_id
    and i.id=v_credit_id
    and i.status='Väntar på bunt'
    and i.journal_number is null;
  if not found then raise exception 'CREDIT_BATCH_ACTIVATION_CONFLICT'; end if;

  update public.financial_batches b
  set status='approved',approved_by=v_uid,approved_at=now(),updated_by=v_uid,updated_at=now()
  where b.company_id=p_company_id and b.id=v_batch_id and b.status='ready';
  if not found then raise exception 'CREDIT_BATCH_APPROVAL_CONFLICT'; end if;

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,v_batch_id,v_uid,'BATCH_AUTO_APPROVED',
    jsonb_build_object(
      'sourceType','customer-credit-note',
      'sourceId',v_credit_id,
      'journalNumber','F'||v_seq,
      'reason','create-customer-credit'
    )
  );

  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    p_company_id,v_uid,'FINANCIAL_BATCH_AUTO_APPROVED','financial_batch',v_batch_id,
    jsonb_build_object(
      'batchNumber',v_batch_number,
      'sourceType','customer-credit-note',
      'sourceId',v_credit_id,
      'originalInvoiceId',p_original_invoice_id,
      'journalNumber','F'||v_seq,
      'creditAmountOre',p_credit_amount_ore,
      'offsetAmountOre',v_offset,
      'refundDueOre',v_refund
    )
  );

  return query
  select v_credit_id,v_res.invoice_number,'F'||v_seq,v_offset,v_refund,'issued'::text;
end;
$$;

revoke all on function public.finalize_customer_credit(text,text,text,text,date,text,bigint,jsonb,text,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.finalize_customer_credit(text,text,text,text,date,text,bigint,jsonb,text,text,text,text,bigint,jsonb) to authenticated;
