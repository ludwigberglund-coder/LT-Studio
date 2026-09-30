-- Recovered from live Supabase migration history (20260925083349 immutable_archived_documents).
-- GitHub is source of truth for rebuilds.


drop policy if exists "lt documents accounting delete" on storage.objects;
create policy "lt documents accounting delete orphan only"
on storage.objects for delete to authenticated
using (
  bucket_id='lt-documents'
  and exists(
    select 1 from public.company_memberships m
    where m.company_id=(storage.foldername(objects.name))[1]
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
  and not exists(
    select 1 from public.documents d
    where d.company_id=(storage.foldername(objects.name))[1]
      and d.object_path=objects.name
  )
);
;
