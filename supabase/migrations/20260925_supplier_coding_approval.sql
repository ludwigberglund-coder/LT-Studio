-- Applied to Supabase UAT on 2026-09-25.
-- Supplier invoice coding and approval safeguards.

alter table public.supplier_invoices
  add column if not exists currency text not null default 'SEK',
  add column if not exists vat_treatment text,
  add column if not exists coding_json jsonb not null default '[]'::jsonb,
  add column if not exists coding_sha256 text,
  add column if not exists registered_by uuid references auth.users(id),
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists liability_accounting_entry_id text,
  add column if not exists liability_posted_at timestamptz;

alter table public.supplier_invoices drop constraint if exists supplier_invoices_currency_check;
alter table public.supplier_invoices add constraint supplier_invoices_currency_check check (currency='SEK');
alter table public.supplier_invoices drop constraint if exists supplier_invoices_coding_sha256_check;
alter table public.supplier_invoices add constraint supplier_invoices_coding_sha256_check
  check (coding_sha256 is null or coding_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists supplier_invoices_registered_by_idx on public.supplier_invoices(registered_by);
create index if not exists supplier_invoices_approved_by_idx on public.supplier_invoices(approved_by);

create or replace function public.save_supplier_invoice_coding(p_invoice_id text, p_lines jsonb)
returns table(invoice_id text, coding_sha256 text, status text, coding_json jsonb)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_company_id text; v_total bigint; v_status text;
  v_line jsonb; v_account text; v_text text; v_vat_code text;
  v_debit numeric; v_credit numeric; v_debit_total numeric := 0; v_credit_total numeric := 0;
  v_normalized jsonb := '[]'::jsonb; v_hash text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select i.company_id,i.total_ore,i.status into v_company_id,v_total,v_status
  from public.supplier_invoices i where i.id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not exists (select 1 from public.company_memberships m where m.company_id=v_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if v_status not in ('registered','coding-review','coded') then raise exception 'CODING_LOCKED'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>1000 then raise exception 'INVALID_CODING'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_account:=btrim(coalesce(v_line->>'account','')); v_text:=left(btrim(coalesce(v_line->>'text','')),240); v_vat_code:=left(btrim(coalesce(v_line->>'vatCode','')),80);
    if v_account !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
    if jsonb_typeof(coalesce(v_line->'debitOre','0'::jsonb))<>'number' or jsonb_typeof(coalesce(v_line->'creditOre','0'::jsonb))<>'number' then raise exception 'INVALID_CODING_AMOUNT'; end if;
    v_debit:=coalesce((v_line->>'debitOre')::numeric,0); v_credit:=coalesce((v_line->>'creditOre')::numeric,0);
    if v_debit<>trunc(v_debit) or v_credit<>trunc(v_credit) or v_debit<0 or v_credit<0 or v_debit>9007199254740991 or v_credit>9007199254740991 or ((v_debit=0 and v_credit=0) or (v_debit>0 and v_credit>0)) then raise exception 'INVALID_CODING_AMOUNT'; end if;
    v_debit_total:=v_debit_total+v_debit; v_credit_total:=v_credit_total+v_credit;
    v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object('account',v_account,'text',v_text,'debitOre',v_debit::bigint,'creditOre',v_credit::bigint,'vatCode',v_vat_code));
  end loop;
  if v_debit_total<>v_credit_total or v_debit_total<>v_total or v_debit_total<=0 then raise exception 'UNBALANCED_CODING'; end if;
  v_hash:=encode(extensions.digest(convert_to(v_normalized::text,'UTF8'),'sha256'),'hex');
  update public.supplier_invoices i set coding_json=v_normalized,coding_sha256=v_hash,status='coded',updated_at=now() where i.id=p_invoice_id and i.company_id=v_company_id;
  return query select i.id,i.coding_sha256,i.status,i.coding_json from public.supplier_invoices i where i.id=p_invoice_id and i.company_id=v_company_id;
end;
$$;
revoke all on function public.save_supplier_invoice_coding(text,jsonb) from public, anon;
grant execute on function public.save_supplier_invoice_coding(text,jsonb) to authenticated;

create or replace function public.approve_supplier_invoice(p_invoice_id text,p_expected_coding_sha256 text,p_expected_document_sha256 text)
returns table(invoice_id text,status text,approved_by uuid,approved_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid:=auth.uid(); v_company_id text; v_status text; v_coding_sha text; v_document_sha text; v_registered_by uuid; v_accounting_members integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select i.company_id,i.status,i.coding_sha256,i.pdf_sha256,i.registered_by into v_company_id,v_status,v_coding_sha,v_document_sha,v_registered_by
  from public.supplier_invoices i where i.id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not exists (select 1 from public.company_memberships m where m.company_id=v_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if v_status<>'coded' then raise exception 'INVALID_INVOICE_STATUS'; end if;
  if p_expected_coding_sha256 !~ '^[0-9a-f]{64}$' or p_expected_document_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'APPROVAL_PRECONDITION_REQUIRED'; end if;
  if v_coding_sha is distinct from p_expected_coding_sha256 then raise exception 'APPROVAL_STALE_CODING'; end if;
  if v_document_sha is distinct from p_expected_document_sha256 then raise exception 'APPROVAL_STALE_DOCUMENT'; end if;
  if not exists (select 1 from public.documents d where d.company_id=v_company_id and d.source_type='supplier-invoice' and d.source_id=p_invoice_id and lower(d.sha256)=lower(v_document_sha) and d.mime_type='application/pdf') then raise exception 'DOCUMENT_REQUIRED_FOR_APPROVAL'; end if;
  select count(*) into v_accounting_members from public.company_memberships m where m.company_id=v_company_id and m.role in ('admin','accountant') and m.auth_user_id is not null;
  if v_registered_by=v_uid and v_accounting_members>1 then raise exception 'SAME_ACTOR_APPROVAL_FORBIDDEN'; end if;
  update public.supplier_invoices i set status='approved',approved_by=v_uid,approved_at=now(),updated_at=now() where i.id=p_invoice_id and i.company_id=v_company_id and i.status='coded';
  if not found then raise exception 'APPROVAL_CONFLICT'; end if;
  return query select i.id,i.status,i.approved_by,i.approved_at from public.supplier_invoices i where i.id=p_invoice_id and i.company_id=v_company_id;
end;
$$;
revoke all on function public.approve_supplier_invoice(text,text,text) from public, anon;
grant execute on function public.approve_supplier_invoice(text,text,text) to authenticated;
