-- Synthetic, rollback-only verification for trusted archive PDF upload gates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.companies(id,legal_name,org_number,display_name) values
 ('test-843-a','Synthetic upload A','000000-8431','Synthetic upload A'),
 ('test-843-b','Synthetic upload B','000000-8432','Synthetic upload B');

select ok(not has_table_privilege('authenticated','public.documents','INSERT'),
  'the browser cannot insert a completed original into documents');
select ok(has_table_privilege('service_role','public.documents','INSERT'),
  'server authority can create validated archive originals');
select ok(not has_table_privilege('authenticated','public.archive_pdf_upload_rate_windows','SELECT'),
  'authenticated users cannot read the private rate window table');
select ok(not has_table_privilege('authenticated','public.archive_pdf_upload_rate_windows','INSERT'),
  'authenticated users cannot tamper with the private quota');
select ok(not has_function_privilege('authenticated','public.reserve_archive_pdf_upload(text,uuid)','EXECUTE'),
  'browser cannot invoke the server-only quota RPC');
select ok(has_function_privilege('service_role','public.reserve_archive_pdf_upload(text,uuid)','EXECUTE'),
  'trusted Edge role can reserve upload slots');
select is(
  (select permissive from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname='lt archive requires trusted uploader'),
  'RESTRICTIVE','direct browser archive Storage upload is subject to a restrictive policy');
select ok(
  (select with_check from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname='lt archive requires trusted uploader') like '%documents%',
  'restrictive Storage policy explicitly excludes documents folder');
select is(
  (select permissive from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname='lt archive blocks client replacement'),
  'RESTRICTIVE','client edits of finished PDF originals are restrictively blocked');
select ok(
  (select qual from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname='lt archive blocks client replacement') like '%documents%'
  and
  (select with_check from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname='lt archive blocks client replacement') like '%documents%',
  'both old and new Storage object paths are guarded against archive replacement');
select is(
  (select rowsecurity from pg_tables
   where schemaname='public' and tablename='archive_pdf_upload_rate_windows'),
  true,'rate counter has RLS enabled');

-- Two validated originals with the same hash cannot slip through via
-- different concurrent request IDs. Legacy rows carry no verification stamp.
select lives_ok($sql$
  insert into public.documents(
    id,company_id,object_path,file_name,mime_type,size_bytes,sha256,
    title,category,server_verified_at
  ) values(
    'test-843-doc1','test-843-a','test-843-a/documents/doc1/original.pdf',
    'original.pdf','application/pdf',100,repeat('a',64),
    'Verified synthetic original','receipt',now()
  )
$sql$,'a verified archive original can be registered');

select throws_ok($sql$
  insert into public.documents(
    id,company_id,object_path,file_name,mime_type,size_bytes,sha256,
    title,category,server_verified_at
  ) values(
    'test-843-doc2','test-843-a','test-843-a/documents/doc2/duplicate.pdf',
    'duplicate.pdf','application/pdf',100,repeat('a',64),
    'Concurrent identical original','receipt',now()
  )
$sql$,'23505',null,'a second verified original with identical company hash is blocked');

select lives_ok($sql$
  insert into public.documents(
    id,company_id,object_path,file_name,mime_type,size_bytes,sha256,
    title,category
  ) values(
    'test-843-doc3','test-843-a','test-843-a/documents/legacy/legacy.pdf',
    'legacy.pdf','application/pdf',100,repeat('a',64),
    'Legacy original not retroactively verified','other'
  )
$sql$,'historical archive rows remain intact without an invented verification stamp');

set local role service_role;
select ok(public.reserve_archive_pdf_upload(
  'test-843-a','00000000-0000-4000-8000-000000008431'::uuid),
  'one archive upload admitted');
select ok(public.reserve_archive_pdf_upload(
  'test-843-a','00000000-0000-4000-8000-000000008431'::uuid),
  'two archive uploads admitted');
select ok(public.reserve_archive_pdf_upload(
  'test-843-a','00000000-0000-4000-8000-000000008431'::uuid),
  'three archive uploads admitted');
select ok(public.reserve_archive_pdf_upload(
  'test-843-a','00000000-0000-4000-8000-000000008431'::uuid),
  'fourth archive upload admitted');
select ok(not public.reserve_archive_pdf_upload(
  'test-843-a','00000000-0000-4000-8000-000000008431'::uuid),
  'fifth upload in one minute is denied');
select ok(public.reserve_archive_pdf_upload(
  'test-843-b','00000000-0000-4000-8000-000000008431'::uuid),
  'another company keeps a separate quota');
reset role;

select * from finish();
rollback;
