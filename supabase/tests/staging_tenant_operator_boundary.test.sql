-- Rollback-only, synthetic pgTAP coverage for the current Supabase security boundary.
-- Run by the GitHub Supabase clean rebuild; not a substitute for hosted Auth/MFA UAT.
begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select is(
  (select count(*)::bigint from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'operator_create_company_onboarding',
      'operator_change_company_membership',
      'operator_reissue_company_activation',
      'claim_company_activation_invite',
      'operator_capture_user_sessions',
      'operator_count_remaining_previous_sessions'
    )),
  6::bigint,
  'the six reviewed operator/onboarding functions exist after a full rebuild'
);

select is(
  (select count(*)::bigint from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'operator_create_company_onboarding',
      'operator_change_company_membership',
      'operator_reissue_company_activation',
      'claim_company_activation_invite',
      'operator_capture_user_sessions',
      'operator_count_remaining_previous_sessions'
    ) and has_function_privilege('anon',p.oid,'EXECUTE')),
  0::bigint,
  'anonymous callers cannot execute operator/onboarding functions'
);

select is(
  (select count(*)::bigint from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'operator_create_company_onboarding',
      'operator_change_company_membership',
      'operator_reissue_company_activation',
      'claim_company_activation_invite',
      'operator_capture_user_sessions',
      'operator_count_remaining_previous_sessions'
    ) and has_function_privilege('authenticated',p.oid,'EXECUTE')),
  0::bigint,
  'authenticated browser callers cannot execute operator/onboarding functions'
);

select is(
  (select count(*)::bigint from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'operator_create_company_onboarding',
      'operator_change_company_membership',
      'operator_reissue_company_activation',
      'claim_company_activation_invite',
      'operator_capture_user_sessions',
      'operator_count_remaining_previous_sessions'
    ) and has_function_privilege('service_role',p.oid,'EXECUTE')),
  6::bigint,
  'trusted server keeps access to all six operator/onboarding functions'
);

select is(
  (select count(*)::bigint from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and (has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
  0::bigint,
  'no public SECURITY DEFINER function is directly exposed to browser roles'
);

select ok(
  exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname='company_activation_invites' and c.relrowsecurity)
  and exists(select 1 from pg_policies p
             where p.schemaname='public' and p.tablename='company_activation_invites'
               and p.policyname='no browser access to company activation invites'
               and p.qual='false' and p.with_check='false'),
  'activation invites retain their deny-browser RLS policy'
);

select ok(
  not has_table_privilege('anon','public.company_activation_invites','SELECT')
  and not has_table_privilege('authenticated','public.company_activation_invites','SELECT'),
  'neither anonymous nor authenticated roles can read activation invites directly'
);

select ok(
  not has_table_privilege('anon','public.platform_operators','SELECT')
  and not has_table_privilege('authenticated','public.platform_operators','SELECT'),
  'operator identity table is not directly readable from the browser'
);

-- Synthetic identities and records never persist: the entire pgTAP file rolls back.
-- Fake JWTs are only used inside this isolated clean-rebuild transaction.
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000003641','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pgtap-scope-a-364@example.invalid',now(),now()),
 ('00000000-0000-4000-8000-000000003642','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pgtap-scope-b-364@example.invalid',now(),now());

insert into public.app_users(id,auth_user_id,username,display_name)
values
 ('pgtap-scope-user-a-364','00000000-0000-4000-8000-000000003641','pgtap-scope-a-364','Synthetic Scope A'),
 ('pgtap-scope-user-b-364','00000000-0000-4000-8000-000000003642','pgtap-scope-b-364','Synthetic Scope B');

insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000003651','00000000-0000-4000-8000-000000003641','aal2',now(),now()),
 ('00000000-0000-4000-8000-000000003652','00000000-0000-4000-8000-000000003642','aal2',now(),now());

insert into public.companies(id,legal_name,org_number,display_name)
values
 ('pgtap-scope-alpha-364','Synthetic Scope Alpha AB','000000-3641','Synthetic Scope Alpha'),
 ('pgtap-scope-beta-364','Synthetic Scope Beta AB','000000-3642','Synthetic Scope Beta');

insert into public.company_memberships(company_id,auth_user_id,user_id,role)
values
 ('pgtap-scope-alpha-364','00000000-0000-4000-8000-000000003641','pgtap-scope-user-a-364','accountant'),
 ('pgtap-scope-beta-364','00000000-0000-4000-8000-000000003642','pgtap-scope-user-b-364','accountant');

insert into public.customers(id,company_id,customer_number,name)
values
 ('pgtap-scope-customer-a-364','pgtap-scope-alpha-364','T364-A','Synthetic Customer A'),
 ('pgtap-scope-customer-b-364','pgtap-scope-beta-364','T364-B','Synthetic Customer B');

insert into public.invoices(
 id,company_id,customer_id,invoice_number,invoice_date,posting_date,due_date,
 total_ore,remaining_ore,vat_ore,status,invoice_account)
values
 ('pgtap-scope-invoice-a-364','pgtap-scope-alpha-364','pgtap-scope-customer-a-364',
  'T364-A-001','2026-10-01','2026-10-01','2026-10-31',10000,10000,0,'Obetald','1510'),
 ('pgtap-scope-invoice-b-364','pgtap-scope-beta-364','pgtap-scope-customer-b-364',
  'T364-B-001','2026-10-01','2026-10-01','2026-10-31',10000,10000,0,'Obetald','1510');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003641',true);
select set_config('request.jwt.claims',
 '{"sub":"00000000-0000-4000-8000-000000003641","aal":"aal2","session_id":"00000000-0000-4000-8000-000000003651"}',true);

select is((select count(*)::bigint from public.customers),1::bigint,
 'synthetic user Alpha can read exactly their own customer');
select is((select count(*)::bigint from public.customers where company_id='pgtap-scope-beta-364'),0::bigint,
 'synthetic user Alpha cannot read Beta customers');
select is((select count(*)::bigint from public.invoices),1::bigint,
 'synthetic user Alpha can read exactly their own invoice');
select is((select count(*)::bigint from public.invoices where company_id='pgtap-scope-beta-364'),0::bigint,
 'synthetic user Alpha cannot read Beta invoices');
select is((select count(*)::bigint from public.company_memberships),1::bigint,
 'synthetic user Alpha only sees their own company membership');

select set_config('request.jwt.claims',
 '{"sub":"00000000-0000-4000-8000-000000003641","aal":"aal1","session_id":"00000000-0000-4000-8000-000000003651"}',true);
select is((select count(*)::bigint from public.customers),0::bigint,
 'synthetic user Alpha without AAL2 cannot read customers');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003642',true);
select set_config('request.jwt.claims',
 '{"sub":"00000000-0000-4000-8000-000000003642","aal":"aal2","session_id":"00000000-0000-4000-8000-000000003652"}',true);

select is((select count(*)::bigint from public.customers),1::bigint,
 'synthetic user Beta can read exactly their own customer');
select is((select count(*)::bigint from public.customers where company_id='pgtap-scope-alpha-364'),0::bigint,
 'synthetic user Beta cannot read Alpha customers');
select is((select count(*)::bigint from public.invoices),1::bigint,
 'synthetic user Beta can read exactly their own invoice');
select is((select count(*)::bigint from public.invoices where company_id='pgtap-scope-alpha-364'),0::bigint,
 'synthetic user Beta cannot read Alpha invoices');
select is((select count(*)::bigint from public.company_memberships),1::bigint,
 'synthetic user Beta only sees their own company membership');

reset role;
select * from finish();
rollback;
