-- Secure one-time UAT account bootstrap.
-- The table structure is versioned here; actual invite hashes are runtime UAT data and must never be committed.

create table if not exists public.uat_bootstrap_invites(
  id uuid primary key default gen_random_uuid(),
  code_sha256 text not null unique check(code_sha256 ~ '^[0-9a-f]{64}$'),
  label text not null check(char_length(label) between 2 and 120),
  company_id text not null references public.companies(id) on delete cascade,
  membership_role text not null check(membership_role in ('admin','accountant','approver','readonly')),
  grant_operator boolean not null default false,
  max_uses integer not null default 1 check(max_uses between 1 and 5),
  use_count integer not null default 0 check(use_count between 0 and max_uses),
  expires_at timestamptz not null,
  claimed_email text,
  claimed_auth_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.uat_bootstrap_invites enable row level security;

revoke all on public.uat_bootstrap_invites from anon,authenticated;
grant select,update on public.uat_bootstrap_invites to service_role;

drop policy if exists "no browser access to uat bootstrap invites" on public.uat_bootstrap_invites;
create policy "no browser access to uat bootstrap invites"
on public.uat_bootstrap_invites
for all
to anon,authenticated
using(false)
with check(false);

create index if not exists uat_bootstrap_invites_active_idx
on public.uat_bootstrap_invites(expires_at,use_count)
where use_count < max_uses;

create index if not exists uat_bootstrap_invites_company_idx
on public.uat_bootstrap_invites(company_id);

create index if not exists uat_bootstrap_invites_claimed_user_idx
on public.uat_bootstrap_invites(claimed_auth_user_id);
