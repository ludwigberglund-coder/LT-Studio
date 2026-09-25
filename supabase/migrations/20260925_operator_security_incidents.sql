-- Applied to Supabase UAT on 2026-09-25.
-- Operator-only incident workflow. Browser roles are explicitly denied.

create table if not exists public.operator_security_incidents(
  audit_event_id bigint primary key references public.audit_events(id) on delete cascade,
  status text not null default 'new' check(status in ('new','reviewed','investigating','resolved')),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.operator_security_incidents enable row level security;
create index if not exists operator_security_incidents_updated_by_idx
  on public.operator_security_incidents(updated_by,updated_at desc);

revoke all on public.operator_security_incidents from anon,authenticated;
grant select,insert,update,delete on public.operator_security_incidents to service_role;

create policy "no direct authenticated access to operator security incidents"
on public.operator_security_incidents for all to authenticated
using(false) with check(false);
