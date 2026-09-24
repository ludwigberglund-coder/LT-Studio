-- Correct the initial Supabase identity model before any application data exists.
-- LT Studio's current immutable IDs use prefixes such as company_<uuid> and user_<uuid>.
-- We preserve those IDs exactly while mapping application users to Supabase Auth UUIDs.

drop policy if exists "members can read their companies" on public.companies;
drop policy if exists "users can read own memberships" on public.company_memberships;

alter table public.company_memberships
  drop constraint company_memberships_company_id_fkey,
  drop constraint company_memberships_user_id_fkey,
  drop constraint company_memberships_pkey;

drop index if exists public.idx_company_memberships_user;

alter table public.companies
  alter column id drop default,
  alter column id type text using id::text;

alter table public.company_memberships
  alter column company_id type text using company_id::text,
  rename column user_id to auth_user_id;

create table if not exists public.app_users (
  id text primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  disabled boolean not null default false,
  session_duration_minutes integer default 480
    check (session_duration_minutes is null or session_duration_minutes in (120,240,360,480)),
  created_at timestamptz not null default now(),
  unique (id, auth_user_id)
);

alter table public.company_memberships
  add column user_id text;

alter table public.company_memberships
  alter column user_id set not null;

alter table public.company_memberships
  add constraint company_memberships_pkey primary key (company_id, user_id),
  add constraint company_memberships_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete cascade,
  add constraint company_memberships_user_identity_fkey
    foreign key (user_id, auth_user_id)
    references public.app_users(id, auth_user_id) on delete cascade,
  add constraint company_memberships_company_auth_user_key
    unique (company_id, auth_user_id);

create index if not exists idx_company_memberships_user
  on public.company_memberships(user_id, company_id);

create index if not exists idx_company_memberships_auth_user
  on public.company_memberships(auth_user_id, company_id);

alter table public.app_users enable row level security;
alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;

revoke all on table public.app_users from anon;
revoke all on table public.app_users from authenticated;
grant select on table public.app_users to authenticated;

create policy "users can read own app profile"
on public.app_users
for select
to authenticated
using (
  (select auth.uid()) is not null
  and auth_user_id = (select auth.uid())
);

create policy "users can read own memberships"
on public.company_memberships
for select
to authenticated
using (
  (select auth.uid()) is not null
  and auth_user_id = (select auth.uid())
);

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
      and m.auth_user_id = (select auth.uid())
  )
);
