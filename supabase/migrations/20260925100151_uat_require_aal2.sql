-- UAT-wide MFA enforcement.
-- Defense in depth: browser code already requires AAL2, but the database must also
-- reject authenticated AAL1 sessions even when PostgREST is called directly.
-- This policy targets the authenticated role only; existing anon/public policies
-- are unaffected. Server-side secret-key clients bypass RLS as intended.

do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name,c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind='r'
      and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on %I.%I','UAT requires AAL2',r.schema_name,r.table_name);
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using (coalesce((select auth.jwt()->>''aal''),''aal1'')=''aal2'') with check (coalesce((select auth.jwt()->>''aal''),''aal1'')=''aal2'')',
      'UAT requires AAL2',r.schema_name,r.table_name
    );
  end loop;
end
$$;
