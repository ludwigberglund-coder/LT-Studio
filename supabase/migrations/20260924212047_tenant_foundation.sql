-- Applied to Supabase project LT-Studio as migration 20260924212047.
-- First shared multi-tenant foundation. Only synthetic data is allowed during migration.

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  legal_name text not null,
  org_number text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','accountant','approver','readonly')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists idx_company_memberships_user
  on public.company_memberships(user_id, company_id);

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;

revoke all on table public.companies from anon;
revoke all on table public.company_memberships from anon;
revoke all on table public.companies from authenticated;
revoke all on table public.company_memberships from authenticated;

grant select on table public.companies to authenticated;
grant select on table public.company_memberships to authenticated;

create policy "members can read their companies"
on public.companies
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.company_memberships m
    where m.company_id = companies.id
      and m.user_id = (select auth.uid())
  )
);

create policy "users can read own memberships"
on public.company_memberships
for select
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);
