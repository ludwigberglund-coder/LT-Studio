-- Applied to Supabase UAT on 2026-09-25.
-- Hardening after document metadata migration and parity check for negative invoices.
-- Replaces invoice/credit RPC definitions so new document metadata is always complete.

-- The complete function bodies intentionally live here after the metadata migration.
-- This patch preserves negative normal invoices, validates invoice-document fields,
-- validates the 1510 receivable amount and writes title/category metadata.

create or replace function public.finalize_customer_invoice(
  p_company_id text,p_request_id text,p_payload_sha256 text,p_customer_number text,p_invoice_date date,p_posting_date date,p_due_date date,
  p_total_ore bigint,p_vat_ore bigint,p_payment_account text,p_document_json jsonb,p_document_sha256 text,p_pdf_sha256 text,
  p_object_path text,p_file_name text,p_size_bytes bigint,p_journal_lines jsonb
)
returns table(invoice_id text,invoice_number text,journal_number text,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_res public.customer_invoice_number_reservations%rowtype;
  v_customer_id text; v_customer_name text; v_period text; v_year text; v_seq bigint; v_entry_id text; v_invoice_id text;
  v_line jsonb; v_line_no int:=0; v_debit numeric:=0; v_credit numeric:=0; v_receivable numeric:=0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PAYLOAD_HASH'; end if;
  if p_total_ore=0 or abs(p_vat_ore)>abs(p_total_ore) then raise exception 'INVALID_INVOICE_AMOUNT'; end if;
  if p_document_sha256 !~ '^[0-9a-f]{64}$' or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_DOCUMENT_HASH'; end if;
  if p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'INVALID_PDF_SIZE'; end if;
  if jsonb_typeof(p_journal_lines)<>'array' or jsonb_array_length(p_journal_lines)<2 then raise exception 'INVALID_JOURNAL'; end if;
  select * into v_res from public.customer_invoice_number_reservations r
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status in ('reserved','issued') for update;
  if not found then raise exception 'INVOICE_RESERVATION_NOT_FOUND'; end if;
  if v_res.purpose<>'invoice' then raise exception 'INVALID_RESERVATION_PURPOSE'; end if;
  if v_res.payload_sha256<>p_payload_sha256 then raise exception 'INVOICE_IDEMPOTENCY_CONFLICT'; end if;
  if v_res.status='issued' and v_res.issued_invoice_id is not null then
    return query select i.id,i.invoice_number,i.journal_number,'duplicate'::text from public.invoices i
      where i.company_id=p_company_id and i.id=v_res.issued_invoice_id; return;
  end if;
  if (p_document_json->>'documentType') is distinct from 'FAKTURA'
     or (p_document_json->>'invoiceNumber') is distinct from v_res.invoice_number
     or (p_document_json->>'ocr') is distinct from v_res.invoice_number
     or (p_document_json->>'customerNumber') is distinct from p_customer_number
     or (p_document_json->>'invoiceDate')::date is distinct from p_invoice_date
     or (p_document_json->>'postingDate')::date is distinct from p_posting_date
     or (p_document_json->>'dueDate')::date is distinct from p_due_date
     or coalesce((p_document_json->>'totalOre')::bigint,0)<>p_total_ore
     or coalesce((p_document_json->>'vatOre')::bigint,0)<>p_vat_ore then raise exception 'INVOICE_DOCUMENT_MISMATCH'; end if;
  select c.id,c.name into v_customer_id,v_customer_name from public.customers c
    where c.company_id=p_company_id and c.customer_number=p_customer_number and c.archived_at is null;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  v_period:=to_char(p_posting_date,'YYYY-MM'); v_year:=to_char(p_posting_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0); v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
    if (v_line->>'account')='1510' then v_receivable:=v_receivable+coalesce((v_line->>'debitOre')::numeric,0)-coalesce((v_line->>'creditOre')::numeric,0); end if;
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
  if v_receivable<>p_total_ore then raise exception 'INVOICE_RECEIVABLE_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':F:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'F',v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_invoice_id:='invoice_'||replace(gen_random_uuid()::text,'-',''); v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.invoices(id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,total_ore,remaining_ore,vat_ore,status,payment_method,payment_account,invoice_account,journal_number,pdf_sha256)
  values(v_invoice_id,p_company_id,v_customer_id,v_res.invoice_number,v_res.invoice_number,p_invoice_date,p_posting_date,p_due_date,p_total_ore,p_total_ore,p_vat_ore,'Bokförd','Bankgiro',p_payment_account,'1510','F'||v_seq,p_pdf_sha256);
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'F',v_seq::text,p_posting_date,left('Kundfaktura '||v_res.invoice_number||' · '||v_customer_name,240),'customer-invoice',v_invoice_id,v_uid);
  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,v_line_no,v_line->>'account',left(coalesce(v_line->>'text',''),240),coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
  end loop;
  insert into public.customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,object_path,file_name,pdf_sha256,size_bytes)
  values(v_invoice_id,p_company_id,p_document_json,p_document_sha256,p_object_path,p_file_name,p_pdf_sha256,p_size_bytes);
  insert into public.documents(id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by,title,category,note)
  values('doc_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_object_path,p_file_name,'application/pdf',p_size_bytes,p_pdf_sha256,'customer-invoice',v_invoice_id,v_uid,
    'Kundfaktura '||v_res.invoice_number,'customer-invoice','');
  update public.customer_invoice_number_reservations r set issued_invoice_id=v_invoice_id,status='issued',updated_at=now()
    where r.company_id=p_company_id and r.request_id=p_request_id and r.status='reserved';
  if not found then raise exception 'INVOICE_RESERVATION_STATE_ERROR'; end if;
  delete from public.customer_invoice_drafts d where d.company_id=p_company_id and d.user_id=v_uid and d.request_id=p_request_id;
  return query select v_invoice_id,v_res.invoice_number,'F'||v_seq,'issued'::text;
end;
$$;
revoke all on function public.finalize_customer_invoice(text,text,text,text,date,date,date,bigint,bigint,text,jsonb,text,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.finalize_customer_invoice(text,text,text,text,date,date,date,bigint,bigint,text,jsonb,text,text,text,text,bigint,jsonb) to authenticated;

-- Recreate credit RPC after document title/category became required.
create or replace function public.finalize_customer_credit(
  p_company_id text,p_request_id text,p_payload_sha256 text,p_original_invoice_id text,p_credit_date date,p_reason text,
  p_credit_amount_ore bigint,p_document_json jsonb,p_document_sha256 text,p_pdf_sha256 text,p_object_path text,p_file_name text,
  p_size_bytes bigint,p_journal_lines jsonb
)
returns table(credit_invoice_id text,credit_invoice_number text,journal_number text,offset_amount_ore bigint,refund_due_ore bigint,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_res public.customer_invoice_number_reservations%rowtype; v_original public.invoices%rowtype;
  v_credited bigint:=0; v_offset bigint; v_refund bigint; v_period text; v_year text; v_seq bigint;
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
    select a.offset_amount_ore,a.refund_due_ore into v_offset,v_refund from public.customer_invoice_credit_adjustments a
      where a.company_id=p_company_id and a.credit_invoice_id=v_res.issued_invoice_id;
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
  select coalesce(sum(a.credit_amount_ore),0) into v_credited from public.customer_invoice_credit_adjustments a
    where a.company_id=p_company_id and a.original_invoice_id=p_original_invoice_id;
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
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'F',v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_credit_id:='invoice_'||replace(gen_random_uuid()::text,'-',''); v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
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
  insert into public.documents(id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by,title,category,note)
    values('doc_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_object_path,p_file_name,'application/pdf',p_size_bytes,p_pdf_sha256,'customer-invoice',v_credit_id,v_uid,
      'Kreditfaktura '||v_res.invoice_number,'customer-invoice','Krediterar faktura '||v_original.invoice_number);
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
