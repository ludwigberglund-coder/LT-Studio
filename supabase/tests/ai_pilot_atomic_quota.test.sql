-- Rollback-only pgTAP coverage for the synthetic AI pilot reservation boundary (#774).
-- Run by Supabase clean rebuild. This does not enable or deploy the Edge Function.
begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

select is(
  (select enabled from public.ai_pilot_runtime_settings where singleton),
  false,
  'AI pilot remains disabled after a clean rebuild'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot reserve AI pilot budget'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated browser callers cannot reserve AI pilot budget'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'only the trusted Edge service role keeps reservation access'
);

-- Synthetic identities are isolated to this transaction and never persist.
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
values
  ('00000000-0000-4000-8000-000000007741','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ai-alpha-774@example.invalid',now(),now()),
  ('00000000-0000-4000-8000-000000007742','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ai-beta-774@example.invalid',now(),now()),
  ('00000000-0000-4000-8000-000000007743','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ai-alpha-admin-774@example.invalid',now(),now());

insert into public.app_users(id,auth_user_id,username,display_name)
values
  ('ai-pgtap-user-alpha-774','00000000-0000-4000-8000-000000007741',
   'ai-alpha-774','Synthetic AI Alpha'),
  ('ai-pgtap-user-beta-774','00000000-0000-4000-8000-000000007742',
   'ai-beta-774','Synthetic AI Beta'),
  ('ai-pgtap-user-alpha-admin-774','00000000-0000-4000-8000-000000007743',
   'ai-alpha-admin-774','Synthetic AI Alpha Admin');

insert into auth.sessions(id,user_id,aal,created_at,updated_at)
values
  ('10000000-0000-4000-8000-000000007741','00000000-0000-4000-8000-000000007741',
   'aal2',now(),now()),
  ('10000000-0000-4000-8000-000000007742','00000000-0000-4000-8000-000000007742',
   'aal2',now(),now()),
  ('10000000-0000-4000-8000-000000007743','00000000-0000-4000-8000-000000007743',
   'aal2',now(),now());

insert into public.companies(id,legal_name,org_number,display_name)
values
  ('ai-pgtap-alpha-774','Synthetic AI Alpha AB','000000-7741','Synthetic AI Alpha'),
  ('ai-pgtap-beta-774','Synthetic AI Beta AB','000000-7742','Synthetic AI Beta');

insert into public.company_memberships(company_id,auth_user_id,user_id,role)
values
  ('ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
   'ai-pgtap-user-alpha-774','accountant'),
  ('ai-pgtap-beta-774','00000000-0000-4000-8000-000000007742',
   'ai-pgtap-user-beta-774','accountant'),
  ('ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007743',
   'ai-pgtap-user-alpha-admin-774','admin');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774',
    '00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741',
    'disabled-request-774-0001',
    repeat('a',64)
  )$$,
  'P0001',
  'AI_PILOT_DISABLED',
  'reservation fails closed while the pilot setting is disabled'
);

reset role;
update public.ai_pilot_runtime_settings
set enabled=true,
    daily_global_limit=20,
    daily_company_limit=5,
    daily_user_limit=2,
    ip_window_seconds=600,
    ip_window_limit=10,
    updated_at=now()
where singleton;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

create temporary table first_ai_reservation on commit drop as
select * from public.reserve_ai_pilot_request_server(
  'ai-pgtap-alpha-774',
  '00000000-0000-4000-8000-000000007741',
  '10000000-0000-4000-8000-000000007741',
  'duplicate-request-774-0001',
  repeat('a',64)
);

select is(
  (select "duplicate" from first_ai_reservation),
  false,
  'first valid request creates a reservation'
);

select is(
  (select "duplicate" from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774',
    '00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741',
    'duplicate-request-774-0001',
    repeat('a',64)
  )),
  true,
  'same company, actor and request id is reported as an idempotent duplicate'
);

reset role;
select is(
  (select count(*)::bigint from public.ai_pilot_request_reservations),
  1::bigint,
  'an idempotent duplicate does not consume another quota slot'
);

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-beta-774',
    '00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741',
    'cross-tenant-request-774',
    repeat('b',64)
  )$$,
  'P0001',
  'ACCESS_DENIED',
  'Alpha user cannot reserve against Beta company'
);

reset role;
update public.company_memberships
set role='readonly'
where company_id='ai-pgtap-alpha-774'
  and auth_user_id='00000000-0000-4000-8000-000000007743';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774',
    '00000000-0000-4000-8000-000000007743',
    '10000000-0000-4000-8000-000000007743',
    'readonly-request-774-0001',
    repeat('c',64)
  )$$,
  'P0001',
  'ACCESS_DENIED',
  'readonly membership cannot reserve AI pilot budget'
);

reset role;
update public.company_memberships
set role='admin'
where company_id='ai-pgtap-alpha-774'
  and auth_user_id='00000000-0000-4000-8000-000000007743';
update auth.sessions
set not_after=now()-interval '1 minute'
where id='10000000-0000-4000-8000-000000007743';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774',
    '00000000-0000-4000-8000-000000007743',
    '10000000-0000-4000-8000-000000007743',
    'expired-session-request-774',
    repeat('c',64)
  )$$,
  'P0001',
  'ACCESS_DENIED',
  'expired personal session cannot reserve AI pilot budget'
);

-- Per-user ceiling: two distinct requests pass, the third is rejected.
reset role;
truncate public.ai_pilot_request_reservations;
update auth.sessions
set not_after=null
where id='10000000-0000-4000-8000-000000007743';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741','user-limit-request-774-01',repeat('d',64)
  )$$,
  'first request stays within the per-user quota'
);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741','user-limit-request-774-02',repeat('e',64)
  )$$,
  'second request stays within the per-user quota'
);
select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741','user-limit-request-774-03',repeat('f',64)
  )$$,
  'P0001',
  'AI_USER_QUOTA_EXCEEDED',
  'third request is rejected by the per-user quota'
);

-- Per-company ceiling across two privileged members of the same synthetic company.
reset role;
truncate public.ai_pilot_request_reservations;
update public.ai_pilot_runtime_settings
set daily_global_limit=20,daily_company_limit=2,daily_user_limit=2
where singleton;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741','company-limit-request-774-01',repeat('1',64)
  )$$,
  'first Alpha member consumes one company slot'
);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007743',
    '10000000-0000-4000-8000-000000007743','company-limit-request-774-02',repeat('2',64)
  )$$,
  'second Alpha member consumes the second company slot'
);
select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007743',
    '10000000-0000-4000-8000-000000007743','company-limit-request-774-03',repeat('3',64)
  )$$,
  'P0001',
  'AI_COMPANY_QUOTA_EXCEEDED',
  'another Alpha request is rejected by the company quota'
);

-- Global ceiling counts reservations from both synthetic companies.
reset role;
truncate public.ai_pilot_request_reservations;
update public.ai_pilot_runtime_settings
set daily_global_limit=2,daily_company_limit=2,daily_user_limit=2
where singleton;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741','global-limit-request-774-01',repeat('4',64)
  )$$,
  'Alpha request consumes the first global slot'
);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-beta-774','00000000-0000-4000-8000-000000007742',
    '10000000-0000-4000-8000-000000007742','global-limit-request-774-02',repeat('5',64)
  )$$,
  'Beta request consumes the second global slot'
);
select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-beta-774','00000000-0000-4000-8000-000000007742',
    '10000000-0000-4000-8000-000000007742','global-limit-request-774-03',repeat('6',64)
  )$$,
  'P0001',
  'AI_GLOBAL_QUOTA_EXCEEDED',
  'combined Alpha and Beta use cannot exceed the global quota'
);

-- A shared hashed source is limited across companies without storing a raw IP.
reset role;
truncate public.ai_pilot_request_reservations;
update public.ai_pilot_runtime_settings
set daily_global_limit=20,daily_company_limit=5,daily_user_limit=5,
    ip_window_seconds=600,ip_window_limit=1
where singleton;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select lives_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-alpha-774','00000000-0000-4000-8000-000000007741',
    '10000000-0000-4000-8000-000000007741','ip-limit-request-774-0001',repeat('7',64)
  )$$,
  'first hashed-IP request is accepted'
);
select throws_ok(
  $$select * from public.reserve_ai_pilot_request_server(
    'ai-pgtap-beta-774','00000000-0000-4000-8000-000000007742',
    '10000000-0000-4000-8000-000000007742','ip-limit-request-774-0002',repeat('7',64)
  )$$,
  'P0001',
  'AI_IP_QUOTA_EXCEEDED',
  'same hashed source is limited across synthetic companies'
);

reset role;
select * from finish();
rollback;
