-- Recovered from live Supabase migration history (20260925055322 optimize_shared_rls_indexes).
-- GitHub is source of truth for rebuilds.

create index if not exists supplier_invoices_supplier_fk_idx on public.supplier_invoices(company_id, supplier_id);
create index if not exists journal_entries_created_by_idx on public.journal_entries(created_by);
create index if not exists documents_uploaded_by_idx on public.documents(uploaded_by);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id);

do $$
declare t text;
begin
  foreach t in array array['customers','invoices','invoice_transactions','suppliers','supplier_invoices','journal_entries','journal_lines','documents'] loop
    execute format('drop policy if exists %I on public.%I', 'members can write company ' || t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant'')))', 'accounting members can insert company ' || t, t, t);
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant''))) with check (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant'')))', 'accounting members can update company ' || t, t, t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant'')))', 'accounting members can delete company ' || t, t, t);
  end loop;
end $$;;
