-- Applied to Supabase UAT on 2026-09-25.
-- Customer invoicing foundation, private invoice archive and atomic invoice issue.

create table if not exists public.company_invoice_settings (
  company_id text primary key references public.companies(id) on delete cascade,
  address text not null default '', vat_number text not null default '', phone text not null default '',
  email text not null default '', website text not null default '', bankgiro text not null default '',
  tax_status text not null default '', updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
alter table public.company_invoice_settings enable row level security;

create table if not exists public.customer_invoice_drafts (
  company_id text not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_json jsonb not null, request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(company_id,user_id)
);
alter table public.customer_invoice_drafts enable row level security;

create table if not exists public.customer_invoice_number_reservations (
  company_id text not null references public.companies(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  purpose text not null check (purpose in ('invoice','credit')),
  invoice_number text not null check (invoice_number ~ '^[0-9]{6}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_invoice_id text, issued_invoice_id text,
  status text not null default 'reserved' check (status in ('reserved','issued','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(company_id,request_id), unique(company_id,invoice_number),
  foreign key(company_id,source_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,issued_invoice_id) references public.invoices(company_id,id) on delete restrict
);
alter table public.customer_invoice_number_reservations enable row level security;

create table if not exists public.customer_invoice_documents (
  invoice_id text primary key, company_id text not null, document_json jsonb not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  object_path text not null, file_name text not null, pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes>0 and size_bytes<=10485760), created_at timestamptz not null default now(),
  foreign key(company_id,invoice_id) references public.invoices(company_id,id) on delete restrict,
  unique(company_id,invoice_id), unique(company_id,object_path)
);
alter table public.customer_invoice_documents enable row level security;

create table if not exists public.customer_invoice_credit_adjustments (
  company_id text not null references public.companies(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  original_invoice_id text not null, credit_invoice_id text not null,
  reason text not null check (char_length(reason) between 5 and 500),
  credit_amount_ore bigint not null check (credit_amount_ore>0), offset_amount_ore bigint not null check (offset_amount_ore>=0),
  refund_due_ore bigint not null check (refund_due_ore>=0), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), primary key(company_id,request_id), unique(company_id,credit_invoice_id),
  foreign key(company_id,original_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,credit_invoice_id) references public.invoices(company_id,id) on delete restrict
);
alter table public.customer_invoice_credit_adjustments enable row level security;

create table if not exists public.customer_credit_refunds (
  company_id text not null references public.companies(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  credit_invoice_id text not null, original_invoice_id text not null, amount_ore bigint not null check (amount_ore>0),
  refund_date date not null, refund_account text not null check (refund_account in ('1920','1930','1940')),
  bank_reference text not null check (char_length(bank_reference) between 4 and 120),
  accounting_entry_id text not null, invoice_transaction_id text not null, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), primary key(company_id,request_id),
  unique(company_id,credit_invoice_id), unique(company_id,bank_reference),
  foreign key(company_id,credit_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,original_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,accounting_entry_id) references public.journal_entries(company_id,id) on delete restrict
);
alter table public.customer_credit_refunds enable row level security;

create index if not exists customer_invoice_reservations_source_idx on public.customer_invoice_number_reservations(company_id,source_invoice_id);
create index if not exists customer_invoice_documents_company_idx on public.customer_invoice_documents(company_id,created_at desc);
create index if not exists customer_credit_adjustments_original_idx on public.customer_invoice_credit_adjustments(company_id,original_invoice_id,created_at);
create index if not exists customer_credit_refunds_original_idx on public.customer_credit_refunds(company_id,original_invoice_id,created_at);

create policy "members can read invoice settings" on public.company_invoice_settings for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid())));
create policy "admins can manage invoice settings" on public.company_invoice_settings for all to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid()) and m.role='admin'))
with check (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid()) and m.role='admin'));
create policy "users own invoice drafts" on public.customer_invoice_drafts for all to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_drafts.company_id and m.auth_user_id=(select auth.uid())))
with check (user_id=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_drafts.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "members read invoice reservations" on public.customer_invoice_number_reservations for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members manage invoice reservations" on public.customer_invoice_number_reservations for all to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "members read customer invoice documents" on public.customer_invoice_documents for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_documents.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert customer invoice documents" on public.customer_invoice_documents for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_documents.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "members read customer credit adjustments" on public.customer_invoice_credit_adjustments for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_credit_adjustments.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert customer credit adjustments" on public.customer_invoice_credit_adjustments for insert to authenticated
with check (created_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_credit_adjustments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "members read customer credit refunds" on public.customer_credit_refunds for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_credit_refunds.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert customer credit refunds" on public.customer_credit_refunds for insert to authenticated
with check (created_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=customer_credit_refunds.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

revoke all on public.company_invoice_settings,public.customer_invoice_drafts,public.customer_invoice_number_reservations,public.customer_invoice_documents,public.customer_invoice_credit_adjustments,public.customer_credit_refunds from anon;
grant select,insert,update,delete on public.company_invoice_settings,public.customer_invoice_drafts,public.customer_invoice_number_reservations to authenticated;
grant select,insert on public.customer_invoice_documents,public.customer_invoice_credit_adjustments,public.customer_credit_refunds to authenticated;

create or replace function public.reserve_customer_invoice_number(p_company_id text,p_request_id text,p_purpose text,p_payload_sha256 text,p_source_invoice_id text default null)
returns table(company_id text,invoice_number text,status text,request_id text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_existing public.customer_invoice_number_reservations%rowtype; v_next bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_purpose not in ('invoice','credit') then raise exception 'INVALID_PURPOSE'; end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PAYLOAD_HASH'; end if;
  if p_source_invoice_id is not null and not exists(select 1 from public.invoices i where i.company_id=p_company_id and i.id=p_source_invoice_id) then raise exception 'SOURCE_INVOICE_NOT_FOUND'; end if;
  select * into v_existing from public.customer_invoice_number_reservations r where r.company_id=p_company_id and r.request_id=p_request_id for update;
  if found then
    if v_existing.purpose<>p_purpose or v_existing.payload_sha256<>p_payload_sha256 or coalesce(v_existing.source_invoice_id,'')<>coalesce(p_source_invoice_id,'') then raise exception 'INVOICE_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.company_id,v_existing.invoice_number,v_existing.status,v_existing.request_id; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':invoice-number',0));
  select greatest(coalesce(max(case when i.invoice_number ~ '^[0-9]{6}$' then i.invoice_number::bigint end),0),
    coalesce((select max(r.invoice_number::bigint) from public.customer_invoice_number_reservations r where r.company_id=p_company_id and r.invoice_number ~ '^[0-9]{6}$'),0),310000)+1
  into v_next from public.invoices i where i.company_id=p_company_id;
  if v_next>999999 then raise exception 'INVOICE_NUMBER_SERIES_FULL'; end if;
  insert into public.customer_invoice_number_reservations(company_id,request_id,purpose,invoice_number,payload_sha256,source_invoice_id,status)
  values(p_company_id,p_request_id,p_purpose,lpad(v_next::text,6,'0'),p_payload_sha256,p_source_invoice_id,'reserved')
  returning public.customer_invoice_number_reservations.company_id,public.customer_invoice_number_reservations.invoice_number,public.customer_invoice_number_reservations.status,public.customer_invoice_number_reservations.request_id
  into company_id,invoice_number,status,request_id;
  return next;
end;
$$;
revoke all on function public.reserve_customer_invoice_number(text,text,text,text,text) from public,anon;
grant execute on function public.reserve_customer_invoice_number(text,text,text,text,text) to authenticated;

create or replace function public.finalize_customer_invoice(
  p_company_id text,p_request_id text,p_payload_sha256 text,p_customer_number text,p_invoice_date date,p_posting_date date,p_due_date date,
  p_total_ore bigint,p_vat_ore bigint,p_payment_account text,p_document_json jsonb,p_document_sha256 text,p_pdf_sha256 text,
  p_object_path text,p_file_name text,p_size_bytes bigint,p_journal_lines jsonb
)
returns table(invoice_id text,invoice_number text,journal_number text,status text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_res public.customer_invoice_number_reservations%rowtype; v_customer_id text; v_customer_name text;
  v_period text; v_year text; v_seq bigint; v_entry_id text; v_invoice_id text; v_line jsonb; v_line_no int:=0; v_debit numeric:=0; v_credit numeric:=0;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_PAYLOAD_HASH'; end if;
  if p_total_ore=0 or p_vat_ore<0 or abs(p_vat_ore)>abs(p_total_ore) then raise exception 'INVALID_INVOICE_AMOUNT'; end if;
  if p_document_sha256 !~ '^[0-9a-f]{64}$' or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_DOCUMENT_HASH'; end if;
  if p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'INVALID_PDF_SIZE'; end if;
  if jsonb_typeof(p_journal_lines)<>'array' or jsonb_array_length(p_journal_lines)<2 then raise exception 'INVALID_JOURNAL'; end if;
  select * into v_res from public.customer_invoice_number_reservations r where r.company_id=p_company_id and r.request_id=p_request_id and r.status in ('reserved','issued') for update;
  if not found then raise exception 'INVOICE_RESERVATION_NOT_FOUND'; end if;
  if v_res.purpose<>'invoice' then raise exception 'INVALID_RESERVATION_PURPOSE'; end if;
  if v_res.payload_sha256<>p_payload_sha256 then raise exception 'INVOICE_IDEMPOTENCY_CONFLICT'; end if;
  if v_res.status='issued' and v_res.issued_invoice_id is not null then return query select i.id,i.invoice_number,i.journal_number,'duplicate'::text from public.invoices i where i.company_id=p_company_id and i.id=v_res.issued_invoice_id; return; end if;
  select c.id,c.name into v_customer_id,v_customer_name from public.customers c where c.company_id=p_company_id and c.customer_number=p_customer_number and c.archived_at is null;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  v_period:=to_char(p_posting_date,'YYYY-MM'); v_year:=to_char(p_posting_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  for v_line in select value from jsonb_array_elements(p_journal_lines) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0); v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_ENTRY'; end if;
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
  insert into public.documents(id,company_id,object_path,file_name,mime_type,size_bytes,sha256,source_type,source_id,uploaded_by)
  values('doc_'||replace(gen_random_uuid()::text,'-',''),p_company_id,p_object_path,p_file_name,'application/pdf',p_size_bytes,p_pdf_sha256,'customer-invoice',v_invoice_id,v_uid);
  update public.customer_invoice_number_reservations r set issued_invoice_id=v_invoice_id,status='issued',updated_at=now()
  where r.company_id=p_company_id and r.request_id=p_request_id and r.status='reserved';
  if not found then raise exception 'INVOICE_RESERVATION_STATE_ERROR'; end if;
  delete from public.customer_invoice_drafts d where d.company_id=p_company_id and d.user_id=v_uid and d.request_id=p_request_id;
  return query select v_invoice_id,v_res.invoice_number,'F'||v_seq,'issued'::text;
end;
$$;
revoke all on function public.finalize_customer_invoice(text,text,text,text,date,date,date,bigint,bigint,text,jsonb,text,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.finalize_customer_invoice(text,text,text,text,date,date,date,bigint,bigint,text,jsonb,text,text,text,text,bigint,jsonb) to authenticated;