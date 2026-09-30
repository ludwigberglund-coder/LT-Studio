-- Applied to Supabase UAT on 2026-09-25.
-- Inventory RLS/performance cleanup.

create index if not exists inventory_adjustments_company_item_idx
  on public.inventory_adjustments(company_id,item_id);

drop policy if exists "accounting members manage inventory items" on public.inventory_items;
create policy "accounting members insert inventory items" on public.inventory_items for insert to authenticated
with check (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update inventory items" on public.inventory_items for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members delete inventory items" on public.inventory_items for delete to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
