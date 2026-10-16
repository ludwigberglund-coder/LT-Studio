-- Synthetic, rollback-only tests against the actual rebuilt Supabase schema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000008231','00000000-0000-0000-0000-000000000000','authenticated','authenticated','invoice-823@example.invalid',now(),now());
insert into public.app_users(id,auth_user_id,username,display_name) values
 ('test-823-user','00000000-0000-4000-8000-000000008231','test-823-user','Synthetic user');
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000008232','00000000-0000-4000-8000-000000008231','aal2',now(),now());
insert into public.companies(id,legal_name,org_number,display_name) values
 ('test-823-a','Synthetic A','000000-8231','Synthetic A'),
 ('test-823-b','Synthetic B','000000-8232','Synthetic B');
insert into public.company_memberships(company_id,auth_user_id,user_id,role) values
 ('test-823-a','00000000-0000-4000-8000-000000008231','test-823-user','accountant');
insert into public.suppliers(id,company_id,supplier_number,name) values
 ('test-823-s1','test-823-a','L1','Synthetic supplier 1'),
 ('test-823-s2','test-823-a','L2','Synthetic supplier 2'),
 ('test-823-s3','test-823-b','L1','Synthetic supplier 3');

create function pg_temp.invoice_fixture(p_id text,p_company text,p_supplier text,p_ref text,p_hash text)
returns void language sql security invoker set search_path='' as $$
 insert into public.supplier_invoices(id,company_id,supplier_id,supplier_invoice_number,
 invoice_date,due_date,posting_date,total_ore,vat_ore,remaining_ore,status,pdf_sha256)
 values(p_id,p_company,p_supplier,p_ref,'2026-10-01','2026-10-31','2026-10-01',12500,2500,12500,'registered',p_hash);
$$;
select lives_ok($$select pg_temp.invoice_fixture('test-823-i1','test-823-a','test-823-s1',' INV 1001 ',repeat('a',64))$$,'first original invoice is accepted');
select lives_ok($$select pg_temp.invoice_fixture('test-823-i2','test-823-a','test-823-s2',' INV 1001 ',repeat('b',64))$$,'same reference from different supplier is accepted');
select throws_ok($$select pg_temp.invoice_fixture('test-823-i3','test-823-a','test-823-s1','inv1001',repeat('c',64))$$,'23505',null,'same supplier normalized reference is blocked with a different PDF');
select throws_ok($$select pg_temp.invoice_fixture('test-823-i4','test-823-a','test-823-s2','ANOTHER',repeat('A',64))$$,'23505',null,'same original hash cannot bypass detection with a different reference or supplier');
select lives_ok($$select pg_temp.invoice_fixture('test-823-i5','test-823-b','test-823-s3','inv1001',repeat('a',64))$$,'duplicate checks are scoped to company, not global');
select is((select supplier_invoice_number from public.supplier_invoices where id='test-823-i1'),' INV 1001 ','original reference is never rewritten');
select throws_ok($$select pg_temp.invoice_fixture('test-823-i6','test-823-a','test-823-s1','   ',null)$$,'23514',null,'empty normalized reference is blocked');
select throws_ok($$select pg_temp.invoice_fixture('test-823-i7','test-823-a','test-823-s3','NEW',null)$$,'23503',null,'supplier from another company cannot be linked');
select throws_ok($$select pg_temp.invoice_fixture('test-823-i8','test-823-a','test-823-s1','ＩＮＶ１００１',null)$$,'23505',null,'NFKC reference variant cannot create a second invoice');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000008231',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000008231","aal":"aal2","session_id":"00000000-0000-4000-8000-000000008232"}',true);
select is((select count(*)::bigint from public.supplier_invoices where company_id='test-823-b'),0::bigint,'RLS still hides the other company');
select throws_ok($$select pg_temp.invoice_fixture('test-823-i9','test-823-b','test-823-s3','OTHER',null)$$,'42501',null,'authenticated user cannot insert into other company');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000008231","aal":"aal1","session_id":"00000000-0000-4000-8000-000000008232"}',true);
select is((select count(*)::bigint from public.supplier_invoices where company_id='test-823-a'),0::bigint,'MFA requirement remains enforced');
reset role;
select * from finish();
rollback;
