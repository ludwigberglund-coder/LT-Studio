-- Protect finalized customer invoice PDFs from direct browser deletion.
-- Orphan cleanup remains allowed for accounting members, but any Storage object
-- referenced by either the generic document archive or finalized invoice documents
-- is immutable at the browser boundary.

drop policy if exists "lt documents accounting delete orphan only" on storage.objects;

create policy "lt documents accounting delete orphan only"
on storage.objects for delete to authenticated
using (
  bucket_id='lt-documents'
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=(storage.foldername(name))[1]
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
  and not exists (
    select 1 from public.documents d
    where d.company_id=(storage.foldername(name))[1]
      and d.object_path=objects.name
  )
  and not exists (
    select 1 from public.customer_invoice_documents d
    where d.company_id=(storage.foldername(name))[1]
      and d.object_path=objects.name
  )
);
