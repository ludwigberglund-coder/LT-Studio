-- Dedicated activation model for real LT Studio customer companies.
-- Legacy UAT bootstrap remains separate for historic/operator bootstrap use.

create table if not exists public.company_activation_invites(
  id uuid primary key default gen_random_uuid(),
  code_sha256 text not null unique check(code_sha256 ~ '^[0-9a-f]{64}$'),
  company_id text not null references public.companies(id) on delete cascade,
  recipient_email text not null check(char_length(recipient_email) between 3 and 254),
  recipient_display_name text not null check(char_length(recipient_display_name) between 2 and 120),
  membership_role text not null default 'admin'
    check(membership_role in ('admin','accountant','approver','readonly')),
  expires_at timestamptz not null,
  claimed_auth_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_by_operator uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(claimed_at is null or claimed_auth_user_id is not null)
);

alter table public.company_activation_invites enable row level security;

revoke all on public.company_activation_invites from public,anon,authenticated;
grant select,insert,update,delete on public.company_activation_invites to service_role;

drop policy if exists "no browser access to company activation invites"
on public.company_activation_invites;

create policy "no browser access to company activation invites"
on public.company_activation_invites
for all
to anon,authenticated
using(false)
with check(false);

create index if not exists company_activation_invites_company_idx
on public.company_activation_invites(company_id,created_at desc);

create index if not exists company_activation_invites_recipient_idx
on public.company_activation_invites(lower(recipient_email),created_at desc);

create index if not exists company_activation_invites_active_idx
on public.company_activation_invites(expires_at)
where claimed_at is null and revoked_at is null;
