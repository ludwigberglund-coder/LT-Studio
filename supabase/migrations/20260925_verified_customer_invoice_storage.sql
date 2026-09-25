-- Verified Storage gate for customer invoices and credit notes.
-- GitHub is source of truth. The Edge Function verifies the actual PDF bytes before
-- creating a short-lived verification ticket. The insert trigger consumes that ticket
-- atomically with invoice finalization.

create table if not exists public.document_upload_verifications(
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  purpose text not null check(purpose in ('invoice','credit')),
  storage_object_id uuid not null,
  object_path text not null,
  file_name text not null,
  document_json jsonb not null,
  document_sha256 text not null check(document_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_sha256 text not null check(pdf_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check(size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '5 minutes'),
  unique(company_id,auth_user_id,request_id,purpose,object_path,pdf_sha256)
);

alter table public.document_upload_verifications enable row level security;

revoke all on public.document_upload_verifications from anon,authenticated;
grant select,delete on public.document_upload_verifications to authenticated;
grant select,insert,delete on public.document_upload_verifications to service_role;

drop policy if exists "users read own document verifications" on public.document_upload_verifications;
create policy "users read own document verifications"
on public.document_upload_verifications for select to authenticated
using (
  auth_user_id=(select auth.uid())
  and expires_at>now()
  and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=document_upload_verifications.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

drop policy if exists "users consume own document verifications" on public.document_upload_verifications;
create policy "users consume own document verifications"
on public.document_upload_verifications for delete to authenticated
using (
  auth_user_id=(select auth.uid())
  and expires_at>now()
  and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=document_upload_verifications.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

create index if not exists document_upload_verifications_expiry_idx
on public.document_upload_verifications(expires_at);
create index if not exists document_upload_verifications_company_user_idx
on public.document_upload_verifications(company_id,auth_user_id,request_id,purpose);

create or replace function private.require_verified_customer_invoice_document()
returns trigger
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_folder text;
  v_request_id text;
  v_purpose text;
  v_storage_object_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  if split_part(new.object_path,'/',1)<>new.company_id
     or split_part(new.object_path,'/',4)<>new.file_name
     or split_part(new.object_path,'/',5)<>'' then
    raise exception 'INVALID_DOCUMENT_STORAGE_PATH';
  end if;

  v_folder:=split_part(new.object_path,'/',2);
  v_request_id:=split_part(new.object_path,'/',3);

  if v_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception 'INVALID_DOCUMENT_STORAGE_PATH';
  end if;

  if (new.document_json->>'documentType')='FAKTURA' and v_folder='customer-invoices' then
    v_purpose:='invoice';
  elsif (new.document_json->>'documentType')='KREDITFAKTURA' and v_folder='customer-credit-notes' then
    v_purpose:='credit';
  else
    raise exception 'INVALID_DOCUMENT_STORAGE_PATH';
  end if;

  delete from public.document_upload_verifications v
  where v.company_id=new.company_id
    and v.auth_user_id=v_uid
    and v.request_id=v_request_id
    and v.purpose=v_purpose
    and v.object_path=new.object_path
    and v.file_name=new.file_name
    and v.document_json=new.document_json
    and v.document_sha256=new.document_sha256
    and v.pdf_sha256=new.pdf_sha256
    and v.size_bytes=new.size_bytes
    and v.expires_at>now()
  returning v.storage_object_id into v_storage_object_id;

  if v_storage_object_id is null then
    raise exception 'DOCUMENT_UPLOAD_NOT_VERIFIED';
  end if;

  if not exists(
    select 1
    from storage.objects o
    where o.id=v_storage_object_id
      and o.bucket_id='lt-documents'
      and o.name=new.object_path
      and o.archived_at is null
      and not o.is_delete_marker
  ) then
    raise exception 'VERIFIED_STORAGE_OBJECT_CHANGED';
  end if;

  return new;
end;
$$;

revoke all on function private.require_verified_customer_invoice_document() from public,anon;

drop trigger if exists verified_customer_invoice_document_guard on public.customer_invoice_documents;
create trigger verified_customer_invoice_document_guard
before insert on public.customer_invoice_documents
for each row execute function private.require_verified_customer_invoice_document();
