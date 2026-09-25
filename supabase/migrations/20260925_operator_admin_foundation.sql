-- Applied to Supabase UAT on 2026-09-25.
-- LT Studio operator identities and immutable-ish operator audit surface.
-- Browser roles have explicit deny-all RLS policies; privileged access belongs in the operator Edge Function.

create table if not exists public.platform_operators(
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check(char_length(display_name) between 2 and 120),
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_operators enable row level security;

create table if not exists public.operator_audit_events(
  id uuid primary key default gen_random_uuid(),
  operator_auth_user_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 3 and 120),
  company_id text references public.companies(id) on delete set null,
  target_auth_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.operator_audit_events enable row level security;
create index if not exists operator_audit_events_created_idx on public.operator_audit_events(created_at desc);
create index if not exists operator_audit_events_operator_idx on public.operator_audit_events(operator_auth_user_id,created_at desc);
create index if not exists operator_audit_events_company_idx on public.operator_audit_events(company_id,created_at desc);
create index if not exists operator_audit_events_target_user_idx on public.operator_audit_events(target_auth_user_id,created_at desc);

revoke all on public.platform_operators,public.operator_audit_events from anon,authenticated;
grant select,insert,update,delete on public.platform_operators,public.operator_audit_events to service_role;

create policy "no direct authenticated access to platform operators"
on public.platform_operators for all to authenticated
using (false) with check (false);

create policy "no direct authenticated access to operator audit"
on public.operator_audit_events for all to authenticated
using (false) with check (false);
