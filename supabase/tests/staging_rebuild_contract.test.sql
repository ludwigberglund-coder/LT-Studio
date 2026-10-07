begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  0::bigint,
  'all public application tables have RLS enabled after clean rebuild'
);

select is(
  (
    select count(*)::bigint
    from storage.buckets
    where id = 'lt-documents'
      and public = false
      and file_size_limit = 10485760
      and allowed_mime_types = array['application/pdf']::text[]
  ),
  1::bigint,
  'lt-documents is private, PDF-only and limited to 10 MiB'
);

select is(
  (
    select count(*)::bigint
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
  ),
  46::bigint,
  'shared Realtime publication contains the expected 46 public tables'
);

select is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'platform_operators',
        'operator_audit_events',
        'operator_security_incidents',
        'uat_bootstrap_invites'
      )
      and grantee in ('anon','authenticated')
  ),
  0::bigint,
  'operator and bootstrap control tables expose no direct browser table grants'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'stage_manual_customer_payment_server'
  ),
  'server-only manual customer payment bridge exists'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'stage_manual_customer_payment_server'
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  'manual customer payment server bridge is not executable by browser roles'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'stage_manual_customer_payment_server'
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'manual customer payment server bridge remains executable by service_role'
);

select * from finish();
rollback;
