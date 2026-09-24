-- Synthetic-only tenant isolation verification for Supabase/Postgres.
-- The entire test is rolled back. Do not replace these values with real customer data.

begin;

insert into auth.users(id,aud,role,email,created_at,updated_at)
values
('11111111-1111-4111-8111-111111111111','authenticated','authenticated','uat-alpha@example.invalid',now(),now());

insert into public.app_users(id,auth_user_id,username,display_name)
values
('user_11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','uat-alpha','UAT Alpha');

insert into public.companies(id,legal_name,org_number,display_name)
values
('company_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic Alpha AB','000000-0000','Synthetic Alpha'),
('company_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Synthetic Beta AB','000000-0018','Synthetic Beta');

insert into public.company_memberships(company_id,user_id,auth_user_id,role)
values
('company_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','user_11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','admin');

insert into public.customers(id,company_id,customer_number,name)
values
('customer_alpha','company_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','K-001','Alpha Kund'),
('customer_beta','company_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','K-001','Beta Kund');

insert into public.invoices(
  id,company_id,customer_id,invoice_number,invoice_date,posting_date,due_date,
  total_ore,remaining_ore,vat_ore,status
) values
('invoice_alpha','company_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','customer_alpha','100001','2026-09-24','2026-09-24','2026-10-24',125000,125000,25000,'Bokförd'),
('invoice_beta','company_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','customer_beta','100001','2026-09-24','2026-09-24','2026-10-24',250000,250000,50000,'Bokförd');

do $$
begin
  begin
    insert into public.invoices(
      id,company_id,customer_id,invoice_number,invoice_date,posting_date,due_date,
      total_ore,remaining_ore,vat_ore,status
    ) values
    ('invoice_cross','company_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','customer_beta','999999','2026-09-24','2026-09-24','2026-10-24',100,100,20,'Bokförd');
    raise exception 'TENANT_RELATION_TEST_FAILED';
  exception
    when foreign_key_violation then null;
  end;
end $$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

do $$
declare c_count integer; i_count integer;
begin
  if auth.uid() <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'AUTH_UID_TEST_FAILED';
  end if;
  select count(*) into c_count from public.customers;
  select count(*) into i_count from public.invoices;
  if c_count <> 1 or i_count <> 1 then
    raise exception 'RLS_MEMBER_TEST_FAILED customers=% invoices=%', c_count, i_count;
  end if;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare c_count integer; i_count integer;
begin
  select count(*) into c_count from public.customers;
  select count(*) into i_count from public.invoices;
  if c_count <> 0 or i_count <> 0 then
    raise exception 'RLS_OUTSIDER_TEST_FAILED customers=% invoices=%', c_count, i_count;
  end if;
end $$;

reset role;
rollback;
