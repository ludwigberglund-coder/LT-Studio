-- Applied to Supabase UAT on 2026-09-25.
-- Customer credit notes and refund registration.

create or replace function public.finalize_customer_credit(
  p_company_id text,p_request_id text,p_payload_sha256 text,p_original_invoice_id text,p_credit_date date,p_reason text,
  p_credit_amount_ore bigint,p_document_json jsonb,p_document_sha256 text,p_pdf_sha256 text,p_object_path text,
  p_file_name text,p_size_bytes bigint,p_journal_lines jsonb
)
returns table(credit_invoice_id text,credit_invoice_number text,journal_number text,offset_amount_ore bigint,refund_due_ore bigint,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_res public.customer_invoice_number_reservations%rowtype; v_original public.invoices%rowtype;
  v_customer_name text; v_credited bigint:=0; v_offset bigint; v_refund bigint; v_period text; v_year text; v_seq bigint;
  v_entry_id text; v_credit_id text; v_line jsonb; v_line_no int:=0; v_debit numeric:=0; v_credit numeric:=0;
  v_receivable_credit numeric:=0; v_original_entry text; v_original_receivable numeric:=0; v_remaining_after bigint; v_credited_after bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_document_sha256 !~ '^[0-9a-f]{64}$' or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_HASH'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<5 or char_length(btrim(coalesce(p_reason,'')))>500 then raise exception 'CREDIT_REASON_REQUIRED'; end if;
  if p_credit_amount_ore<=0 then raise exception 'INVALID_CREDIT_AMOUNT'; end if;
  if p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'INVALID_PDF_SIZE'; end if;
  if jsonb_typeof(p_journal_lines)<>'array' or jsonb_array_length(p_journal_lines)<2 then raise exception 'INVALID_JOURNAL'; end if;

  select * into v_res from public.customer_invoice_number_reservations r
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status in ('reserved','issued') for update;
  if not found then raise exception 'INVOICE_RESERVATION_NOT_FOUND'; end if;
  if v_res.purpose<>'credit' or v_res.source_invoice_id is distinct from p_original_invoice_id then raise exception 'INVALID_RESERVATION_PURPOSE'; end if;
  if v_res.payload_sha256<>p_payload_sha256 then raise exception 'INVOICE_IDEMPOTENCY_CONFLICT'; end if;

  if v_res.status='issued' and v_res.issued_invoice_id is not null then
    select a.offset_amount_ore,a.refund_due_ore into v_offset,v_refund
    from public.customer_invoice_credit_adjustments a where a.company_id=p_company_id and a.credit_invoice_id=v_res.issued_invoice_id;
    return query select i.id,i.invoice_number,i.journal_number,v_offset,v_refund,'duplicate'::text
      from public.invoices i where i.company_id=p_company_id and i.id=v_res.issued_invoice_id; return;
  end if;

  select * into v_original from public.invoices i where i.company_id=p_company_id and i.id=p_original_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_original.total_ore<=0 then raise exception 'CREDIT_SOURCE_INVALID'; end if;
  if v_original.remaining_ore<0 or v_original.remaining_ore>v_original.total_ore then raise exception 'CREDIT_BALANCE_HISTORY_INVALID'; end if;

  if not exists(select 1 from public.customer_invoice_documents d where d.company_id=p_company_id and d.invoice_id=p_original_invoice_id) then raise exception 'INVOICE_DOCUMENT_REQUIRED'; end if;
  select j.id into v_original_entry from public.journal_entries j where j.company_id=p_company_id and j.source_type='customer-invoice' and j.source_id=p_original_invoice_id order by j.created_at limit 1;
  if v_original_entry is null then raise exception 'INVOICE_ACCOUNTING_ENTRY_REQUIRED'; end if;
  select coalesce(sum(l.debit_ore-l.credit_ore),0) into v_original_receivable from public.journal_lines l
  where l.company_id=p_company_id and l.journal_entry_id=v_original_entry and l.account='1510';
  if v_original_receivable<>v_original.total_ore then raise exception 'INVOICE_ACCOUNTING_MISMATCH'; end if;

  select coalesce(sum(a.credit_amount_ore),0) into v_credited from public.customer_invoice_credit_adjustments a where a.company_id=p_company_id and a.original_invoice_id=p_original_invoice_id;
  if p_credit_amount_ore>v_original.total_ore-v_credited then raise exception 'CREDIT_AMOUNT_EXCEEDS_AVAILABLE'; end if;
  v_offset:=least(p_credit_amount_ore,v_original.remaining_ore); v_refund:=p_credit_amount_ore-v_offset;
  v_remaining_after:=v_original.remaining_ore-v_offset; v_credited_after:=v_credited+p_credit_amount_ore;

  if (p_document_json->>'documentType') is distinct from 'KREDITFAKTURA'
     or (p_document_json->>'invoiceNumber') is distinct from v_res.invoice_number
     or (p_document_json->>'creditOfInvoiceNumber') is distinct from v_original.invoice_number
     or coalesce((p_document_json->>'totalOre')::bigint,0)<>-p_credit_amount_ore then raise exception 'CREDIT_DOCUMENT_MISMATCH'; end if;

  v_period:=to_char(p_credit_date,'YYYY-MM'); v_year:=to_char(p_credit_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;

  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0); v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
    if (v_line->>'account')='1510' then v_receivable_credit:=v_receivable_credit+coalesce((v_line->>'creditOre')::numeric,0)-coalesce((v_line->>'debitOre')::numeric,0); end if;
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
  if v_receivable_credit<>p_credit_amount_ore then raise exception 'CREDIT_RECEIVABLE_MISMATCH'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':F:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(p_company_id,'F',v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1
  returning last_number into v_seq;

  v_credit_id:='invoice_'||replace(gen_random_uuid()::text,'-',''); v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  select c.name into v_customer_name from public.customers c where c.company_id=p_company_id and c.id=v_original.customer_id;

  insert into public.invoices(id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,total_ore,remaining_ore,vat_ore,status,payment_method,payment_account,invoice_account,journal_number,pdf_sha256)
  values(v_credit_id,p_company_id,v_original.customer_id,v_res.invoice_number,v_res.invoice_number,p_credit_date,p_credit_date,p_credit_date,
    -p_credit_amount_ore,-v_refund,coalesce((p_document_json->>'vatOre')::bigint,0),
    case when v_refund>0 then 'Kreditfaktura · återbetalning väntar' else 'Kreditfaktura' end,
    v_original.payment_method,v_original.payment_account,'1510','F'||v_seq,p_pdf_sha256);

  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'F',v_seq::text,p_credit_date,left('Kreditfaktura '||v_res.invoice_number||' av '||v_original.invoice_number,240),'customer-credit-note',v_credit_id,v_uid);

  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,v_line_no,v_line->>'account',left(coalesce(v_line->>'text',''),240),
      coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
  end loop;

  if v_offset>0 then
    insert into public.invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,journal_number,amount_ore,approved,account,bank_reference)
    values('transaction_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_original_invoice_id,'credit-offset','Kreditfaktura',p_credit_date,p_credit_date,'F'||v_seq,-v_offset,true,'1510','credit:'||v_credit_id||':offset');
  end if;

  update public.invoices i set remaining_ore=v_remaining_after,status=case when v_credited_after>=v_original.total_ore then 'Krediterad' else 'Delvis krediterad' end,updated_at=now()
  where i.company_id=p_company_id and i.id=p_original_invoice_id and i.remaining_ore=v_original.remaining_ore;
  if not found then raise exception 'CREDIT_SETTLEMENT_CHANGED'; end if;

  insert into public.customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,object_path,file_name,pdf_sha256,size_bytes)
  values(v_credit_id,p_company_id,p_document_json,p_document_sha256,p_object_path,p_file_name,p_pdf_sha256,p_size_bytes);
  insert into public.documents(id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by)
  values('doc_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_object_path,p_file_name,'application/pdf',p_size_bytes,p_pdf_sha256,'customer-invoice',v_credit_id,v_uid);
  insert into public.customer_invoice_credit_adjustments(company_id,request_id,original_invoice_id,credit_invoice_id,reason,credit_amount_ore,offset_amount_ore,refund_due_ore,created_by)
  values(p_company_id,p_request_id,p_original_invoice_id,v_credit_id,btrim(p_reason),p_credit_amount_ore,v_offset,v_refund,v_uid);

  update public.customer_invoice_number_reservations r set issued_invoice_id=v_credit_id,status='issued',updated_at=now()
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status='reserved';
  if not found then raise exception 'INVOICE_RESERVATION_STATE_ERROR'; end if;

  return query select v_credit_id,v_res.invoice_number,'F'||v_seq,v_offset,v_refund,'issued'::text;
end;
$$;
revoke all on function public.finalize_customer_credit(text,text,text,text,date,text,bigint,jsonb,text,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.finalize_customer_credit(text,text,text,text,date,text,bigint,jsonb,text,text,text,text,bigint,jsonb) to authenticated;

create or replace function public.register_customer_credit_refund(p_company_id text,p_request_id text,p_credit_invoice_id text,p_refund_date date,p_refund_account text,p_bank_reference text)
returns table(credit_invoice_id text,journal_number text,status text,amount_ore bigint)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_adjust public.customer_invoice_credit_adjustments%rowtype; v_credit_invoice public.invoices%rowtype;
  v_original public.invoices%rowtype; v_existing public.customer_credit_refunds%rowtype; v_period text; v_year text; v_seq bigint;
  v_entry_id text; v_transaction_id text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_refund_account not in ('1920','1930','1940') then raise exception 'INVALID_CUSTOMER_REFUND_ACCOUNT'; end if;
  if char_length(btrim(coalesce(p_bank_reference,'')))<4 or char_length(btrim(coalesce(p_bank_reference,'')))>120 then raise exception 'CUSTOMER_REFUND_REFERENCE_REQUIRED'; end if;

  select * into v_existing from public.customer_credit_refunds r where r.company_id=p_company_id and r.request_id=p_request_id;
  if found then
    if v_existing.credit_invoice_id<>p_credit_invoice_id or v_existing.refund_date<>p_refund_date or v_existing.refund_account<>p_refund_account or v_existing.bank_reference<>btrim(p_bank_reference) then raise exception 'REFUND_IDEMPOTENCY_CONFLICT'; end if;
    select i.* into v_credit_invoice from public.invoices i where i.company_id=p_company_id and i.id=p_credit_invoice_id;
    return query select p_credit_invoice_id,v_credit_invoice.journal_number,'duplicate'::text,v_existing.amount_ore; return;
  end if;

  select * into v_adjust from public.customer_invoice_credit_adjustments a where a.company_id=p_company_id and a.credit_invoice_id=p_credit_invoice_id for update;
  if not found then raise exception 'CREDIT_ADJUSTMENT_NOT_FOUND'; end if;
  if v_adjust.refund_due_ore<=0 then raise exception 'CUSTOMER_REFUND_NOT_REQUIRED'; end if;
  if exists(select 1 from public.customer_credit_refunds r where r.company_id=p_company_id and r.credit_invoice_id=p_credit_invoice_id) then raise exception 'CUSTOMER_REFUND_ALREADY_REGISTERED'; end if;
  if exists(select 1 from public.invoice_transactions t where t.company_id=p_company_id and t.bank_reference=btrim(p_bank_reference)) then raise exception 'CUSTOMER_REFUND_REFERENCE_CONFLICT'; end if;

  select * into v_credit_invoice from public.invoices i where i.company_id=p_company_id and i.id=p_credit_invoice_id for update;
  select * into v_original from public.invoices i where i.company_id=p_company_id and i.id=v_adjust.original_invoice_id;
  if v_credit_invoice.id is null or v_original.id is null then raise exception 'CREDIT_ADJUSTMENT_NOT_FOUND'; end if;
  if v_credit_invoice.remaining_ore<>-v_adjust.refund_due_ore then raise exception 'CREDIT_REFUND_BALANCE_MISMATCH'; end if;

  v_period:=to_char(p_refund_date,'YYYY-MM'); v_year:=to_char(p_refund_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
  values(p_company_id,'A',v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;

  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-',''); v_transaction_id:='transaction_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'A',v_seq::text,p_refund_date,left('Återbetalning kreditfaktura '||v_credit_invoice.invoice_number,240),'customer-credit-refund',p_credit_invoice_id,v_uid);
  insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
  values
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,1,'1510','Reglera kundkredit '||v_credit_invoice.invoice_number,v_adjust.refund_due_ore,0),
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,2,p_refund_account,left('Återbetalning till '||coalesce((select c.name from public.customers c where c.company_id=p_company_id and c.id=v_original.customer_id),'kund'),240),0,v_adjust.refund_due_ore);
  insert into public.invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,journal_number,amount_ore,approved,account,bank_reference)
  values(v_transaction_id,p_company_id,p_credit_invoice_id,'refund','Bank',p_refund_date,p_refund_date,'A'||v_seq,v_adjust.refund_due_ore,true,p_refund_account,btrim(p_bank_reference));
  update public.invoices i set remaining_ore=0,status='Kreditfaktura · återbetald',updated_at=now()
  where i.company_id=p_company_id and i.id=p_credit_invoice_id and i.remaining_ore=-v_adjust.refund_due_ore;
  if not found then raise exception 'CREDIT_REFUND_BALANCE_MISMATCH'; end if;
  insert into public.customer_credit_refunds(company_id,request_id,credit_invoice_id,original_invoice_id,amount_ore,refund_date,refund_account,bank_reference,accounting_entry_id,invoice_transaction_id,created_by)
  values(p_company_id,p_request_id,p_credit_invoice_id,v_adjust.original_invoice_id,v_adjust.refund_due_ore,p_refund_date,p_refund_account,btrim(p_bank_reference),v_entry_id,v_transaction_id,v_uid);
  return query select p_credit_invoice_id,'A'||v_seq,'registered'::text,v_adjust.refund_due_ore;
end;
$$;
revoke all on function public.register_customer_credit_refund(text,text,text,date,text,text) from public,anon;
grant execute on function public.register_customer_credit_refund(text,text,text,date,text,text) to authenticated;
