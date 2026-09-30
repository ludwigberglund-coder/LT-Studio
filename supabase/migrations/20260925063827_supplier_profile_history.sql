-- Applied to Supabase UAT on 2026-09-25.
alter table public.suppliers add column if not exists default_cost_account text
  check (default_cost_account is null or default_cost_account ~ '^[0-9]{4}$');

create table if not exists public.supplier_change_events (
  id bigint generated always as identity primary key,
  company_id text not null references public.companies(id) on delete cascade,
  supplier_id text not null,
  change_type text not null check (change_type in ('profile','payment-details')),
  changed_by uuid not null references auth.users(id),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  changed_at timestamptz not null default now(),
  foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete cascade
);
alter table public.supplier_change_events enable row level security;
create index if not exists supplier_change_events_supplier_idx on public.supplier_change_events(company_id, supplier_id, changed_at desc);
create index if not exists supplier_change_events_changed_by_idx on public.supplier_change_events(changed_by);
create policy "members can read supplier history" on public.supplier_change_events for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id=supplier_change_events.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members can insert supplier history" on public.supplier_change_events for insert to authenticated
with check (changed_by=(select auth.uid()) and exists (select 1 from public.company_memberships m where m.company_id=supplier_change_events.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
revoke update, delete on public.supplier_change_events from anon, authenticated;
