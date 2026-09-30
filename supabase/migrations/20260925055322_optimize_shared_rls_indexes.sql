-- Applied to Supabase UAT on 2026-09-25.
-- RLS/performance cleanup after the Supabase migration expanded.

create index if not exists accounting_periods_locked_by_idx on public.accounting_periods(locked_by);
create index if not exists company_invoice_settings_updated_by_idx on public.company_invoice_settings(updated_by);
create index if not exists customer_credit_refunds_accounting_entry_idx on public.customer_credit_refunds(company_id,accounting_entry_id);
create index if not exists customer_credit_refunds_created_by_idx on public.customer_credit_refunds(created_by);
create index if not exists customer_credit_adjustments_created_by_idx on public.customer_invoice_credit_adjustments(created_by);
create index if not exists customer_invoice_drafts_user_idx on public.customer_invoice_drafts(user_id);
create index if not exists customer_invoice_reservations_issued_idx on public.customer_invoice_number_reservations(company_id,issued_invoice_id);

drop policy if exists "accounting members manage accounting periods" on public.accounting_periods;
create policy "accounting members insert accounting periods" on public.accounting_periods for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update accounting periods" on public.accounting_periods for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members delete accounting periods" on public.accounting_periods for delete to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=accounting_periods.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

drop policy if exists "accounting members manage accounting sequences" on public.accounting_sequences;
create policy "accounting members insert accounting sequences" on public.accounting_sequences for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update accounting sequences" on public.accounting_sequences for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members delete accounting sequences" on public.accounting_sequences for delete to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=accounting_sequences.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

drop policy if exists "admins can manage invoice settings" on public.company_invoice_settings;
create policy "admins insert invoice settings" on public.company_invoice_settings for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid()) and m.role='admin'));
create policy "admins update invoice settings" on public.company_invoice_settings for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid()) and m.role='admin'))
with check (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid()) and m.role='admin'));
create policy "admins delete invoice settings" on public.company_invoice_settings for delete to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=company_invoice_settings.company_id and m.auth_user_id=(select auth.uid()) and m.role='admin'));

drop policy if exists "accounting members manage invoice reservations" on public.customer_invoice_number_reservations;
create policy "accounting members insert invoice reservations" on public.customer_invoice_number_reservations for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update invoice reservations" on public.customer_invoice_number_reservations for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members delete invoice reservations" on public.customer_invoice_number_reservations for delete to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_invoice_number_reservations.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

drop policy if exists "accounting members manage supplier payments" on public.supplier_payments;
create policy "accounting members insert supplier payments" on public.supplier_payments for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update supplier payments" on public.supplier_payments for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members delete supplier payments" on public.supplier_payments for delete to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=supplier_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
