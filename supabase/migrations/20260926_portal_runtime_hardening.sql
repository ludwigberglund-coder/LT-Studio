-- Supabase portal hardening for company settings and accounting unlock requests.
-- Browser clients only receive the operations used by the UAT portal.

revoke all on table public.company_invoice_settings from authenticated;
grant select, insert, update on table public.company_invoice_settings to authenticated;

drop policy if exists "admins delete invoice settings" on public.company_invoice_settings;
drop policy if exists "admins can manage invoice settings" on public.company_invoice_settings;

create policy "admins insert invoice settings"
on public.company_invoice_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_memberships m
    where m.company_id = company_invoice_settings.company_id
      and m.auth_user_id = (select auth.uid())
      and m.role = 'admin'
  )
);

create policy "admins update invoice settings"
on public.company_invoice_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.company_memberships m
    where m.company_id = company_invoice_settings.company_id
      and m.auth_user_id = (select auth.uid())
      and m.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.company_memberships m
    where m.company_id = company_invoice_settings.company_id
      and m.auth_user_id = (select auth.uid())
      and m.role = 'admin'
  )
);

revoke all on table public.period_unlock_requests from authenticated;
grant select, insert, update on table public.period_unlock_requests to authenticated;
