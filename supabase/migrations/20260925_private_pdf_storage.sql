-- Applied to Supabase UAT on 2026-09-25.
-- Private supplier/customer PDF storage. GitHub is source of truth.

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('lt-documents','lt-documents',false,10485760,array['application/pdf']::text[])
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "lt documents members read" on storage.objects;
create policy "lt documents members read"
on storage.objects for select to authenticated
using (
  bucket_id='lt-documents'
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=(storage.foldername(name))[1]
      and m.auth_user_id=(select auth.uid())
  )
);

drop policy if exists "lt documents accounting upload" on storage.objects;
create policy "lt documents accounting upload"
on storage.objects for insert to authenticated
with check (
  bucket_id='lt-documents'
  and (storage.foldername(name))[1] is not null
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=(storage.foldername(name))[1]
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

drop policy if exists "lt documents accounting delete" on storage.objects;
create policy "lt documents accounting delete"
on storage.objects for delete to authenticated
using (
  bucket_id='lt-documents'
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=(storage.foldername(name))[1]
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);
