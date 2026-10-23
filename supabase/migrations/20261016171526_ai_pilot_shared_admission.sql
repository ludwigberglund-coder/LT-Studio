-- #826 / #774. Filename generated with Supabase CLI 2.118.0 in run 38938243650.
-- Conservative shared admission: no client IP header is trusted or persisted.
-- This migration DOES NOT enable inference. The existing enabled=false remains.
begin;
create table public.ai_pilot_admission_state (
 singleton boolean primary key default true check (singleton),
 recent_admissions timestamptz[] not null default '{}'::timestamptz[],
 check (cardinality(recent_admissions) <= 60)
);
insert into public.ai_pilot_admission_state(singleton) values(true);
alter table public.ai_pilot_admission_state enable row level security;
revoke all on public.ai_pilot_admission_state from public,anon,authenticated;
grant select,update on public.ai_pilot_admission_state to service_role;
grant select on public.ai_pilot_runtime_settings to service_role;

create function public.admit_ai_pilot_request_server()
returns text language plpgsql security invoker set search_path='' as $$
declare
 v_recent timestamptz[];
 v_now timestamptz;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then
  raise exception 'ACCESS_DENIED';
 end if;
 if not exists(select 1 from public.ai_pilot_runtime_settings s where s.singleton and s.enabled) then
  return 'disabled';
 end if;
 -- Row locking makes the rolling-window bound durable across workers/restarts.
 select s.recent_admissions into v_recent from public.ai_pilot_admission_state s
 where s.singleton for update;
 if not found then return 'disabled'; end if;
 v_now:=clock_timestamp();
 select coalesce(array_agg(t), '{}'::timestamptz[]) into v_recent
 from unnest(v_recent) t where t > v_now-interval '60 seconds';
 if cardinality(v_recent)>=60 then return 'rate-limited'; end if;
 update public.ai_pilot_admission_state set recent_admissions=array_append(v_recent,v_now)
 where singleton;
 return 'allowed';
end;
$$;
revoke all on function public.admit_ai_pilot_request_server() from public,anon,authenticated;
grant execute on function public.admit_ai_pilot_request_server() to service_role;
comment on table public.ai_pilot_admission_state is
 'Synthetic AI HTTP admission only: all callers share at most 60 admissions in a rolling 60-second window. No IP or user data. Availability is deliberately conservative. Not a claim of trusted proxy-IP verification.';
comment on column public.ai_pilot_request_reservations.client_ip_hash is
 'Legacy quota bucket field. The synthetic HTTP gateway uses 64 zeros as a reserved ALL-CLIENTS bucket, NOT a client-IP hash. Its existing 2/600-second window applies to all callers together, in addition to per-user/company/global daily caps.';
commit;
