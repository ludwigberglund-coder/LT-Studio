begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000008241','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supplier-824@example.invalid',now(),now());
insert into public.app_users(id,auth_user_id,username,display_name) values
 ('test-824-user','00000000-0000-4000-8000-000000008241','test-824-user','Synthetic user');
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000008242','00000000-0000-4000-8000-000000008241','aal2',now(),now());
insert into public.companies(id,legal_name,org_number,display_name) values
 ('test-824-a','Synthetic Audit A','000000-8241','Synthetic Audit A'),
 ('test-824-b','Synthetic Audit B','000000-8242','Synthetic Audit B');
insert into public.company_memberships(company_id,auth_user_id,user_id,role) values
 ('test-824-a','00000000-0000-4000-8000-000000008241','test-824-user','accountant');
-- Deliberately fail the audit insert to prove the supplier write is rolled back.
create function pg_temp.fail_audit_fixture() returns trigger language plpgsql as $$
begin
 if new.after_json->>'name'='Reject audit fixture' then raise exception 'SYNTHETIC_AUDIT_FAILURE'; end if;
 return new;
end;$$;
create trigger test_824_audit_failure before insert on public.supplier_change_events
 for each row execute function pg_temp.fail_audit_fixture();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000008241',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000008241","aal":"aal2","session_id":"00000000-0000-4000-8000-000000008242"}',true);
select lives_ok($$insert into public.suppliers(id,company_id,supplier_number,name,org_number,country_code)
 values('test-824-s','test-824-a','L824','Synthetic supplier','000000-0001','SE')$$,'authenticated creation is allowed');
select is((select count(*)::bigint from public.supplier_change_events where supplier_id='test-824-s'),1::bigint,'creation gets an atomic profile event');
select throws_ok($$update public.suppliers set name='Stale edit' where id='test-824-s'$$,'P0001','SUPPLIER_VERSION_CONFLICT','unversioned update is refused');
select lives_ok($$update public.suppliers set name='Updated synthetic supplier',row_version=2,
 last_change_request_id='00000000-0000-4000-8000-000000008243' where id='test-824-s'$$,'exact next revision is accepted');
select is((select count(*)::bigint from public.supplier_change_events where supplier_id='test-824-s'),2::bigint,'profile change gets one event, not two browser writes');
select throws_ok($$update public.suppliers set name='Reject audit fixture',row_version=3,
 last_change_request_id='00000000-0000-4000-8000-000000008244' where id='test-824-s'$$,'P0001','SYNTHETIC_AUDIT_FAILURE','audit failure aborts the whole mutation');
select is((select name from public.suppliers where id='test-824-s'),'Updated synthetic supplier','profile remains unchanged after failed audit');
select lives_ok($$update public.suppliers set bankgiro='123-4567',row_version=3,
 last_change_request_id='00000000-0000-4000-8000-000000008245' where id='test-824-s'$$,'payment-detail change and history commit together');
select is((select count(*)::bigint from public.supplier_change_events where supplier_id='test-824-s' and change_type='payment-details'),1::bigint,'payment change is audited exactly once');
select throws_ok($$insert into public.suppliers(id,company_id,supplier_number,name,org_number,country_code)
 values('test-824-duplicate','test-824-a','L825','Other spelling','0000000001','SE')$$,'P0001','SUPPLIER_IDENTITY_ALREADY_EXISTS','normalized legal identity cannot be duplicated under a new number');
select throws_ok($$insert into public.supplier_change_events(company_id,supplier_id,change_type,changed_by)
 values('test-824-a','test-824-s','profile','00000000-0000-4000-8000-000000008241')$$,'42501',null,'browser cannot fabricate history');
select throws_ok($$delete from public.suppliers where id='test-824-s'$$,'42501',null,'browser cannot delete supplier and cascade away its history');
select throws_ok($$insert into public.suppliers(id,company_id,supplier_number,name)
 values('test-824-cross','test-824-b','X','Wrong tenant')$$,'P0001','ACCESS_DENIED','cross-tenant mutation fails');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000008241","aal":"aal1","session_id":"00000000-0000-4000-8000-000000008242"}',true);
select throws_ok($$insert into public.suppliers(id,company_id,supplier_number,name)
 values('test-824-low','test-824-a','LOW','Low assurance')$$,'P0001','ACCESS_DENIED','insufficient MFA fails');
reset role;
select * from finish();
rollback;
