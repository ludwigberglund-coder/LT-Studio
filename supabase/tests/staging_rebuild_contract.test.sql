begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

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


select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_unplaced_bank_payment_server'
  ),
  'unplaced payment server bridge exists'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('resolve_unplaced_bank_payment','resolve_unplaced_bank_payment_server')
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ),
  'unplaced payment privileged resolvers are not executable by browser roles'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_unplaced_bank_payment_server'
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  'unplaced payment server bridge remains executable by service_role'
);


select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'accounting members manage accounting periods',
        'accounting members manage accounting sequences',
        'accounting members manage invoice reservations',
        'accounting members manage supplier payments'
      )
  ),
  0::bigint,
  'overlapping FOR ALL accounting policies are removed after clean rebuild'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and not (
        tablename = 'financial_batch_events'
        and policyname = 'members write financial batch events'
      )
      and (
        coalesce(qual, '') like '%current_setting(''app.%'
        or coalesce(with_check, '') like '%current_setting(''app.%'
      )
  ),
  0::bigint,
  'public RLS policies do not evaluate app.* current_setting directly per row'
);

select is(
  (
    select count(*)::bigint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
      )
  ),
  0::bigint,
  'all public foreign keys have a covering index after clean rebuild'
);

select * from finish();
rollback;
