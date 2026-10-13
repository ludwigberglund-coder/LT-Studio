-- Durable, fail-closed reservation boundary for the synthetic AI pilot (#774).
-- This migration does not deploy or enable the Edge Function. The singleton
-- setting remains disabled until a separate reviewed release changes it.

create table public.ai_pilot_runtime_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  daily_global_limit integer not null default 20 check (daily_global_limit between 1 and 20),
  daily_company_limit integer not null default 5 check (daily_company_limit between 1 and daily_global_limit),
  daily_user_limit integer not null default 2 check (daily_user_limit between 1 and daily_company_limit),
  ip_window_seconds integer not null default 600 check (ip_window_seconds between 60 and 3600),
  ip_window_limit integer not null default 2 check (ip_window_limit between 1 and 10),
  updated_at timestamptz not null default now()
);

insert into public.ai_pilot_runtime_settings(singleton,enabled)
values(true,false)
on conflict(singleton) do nothing;

create table public.ai_pilot_request_reservations (
  id text primary key check (id ~ '^aires_[0-9a-f]{32}$'),
  company_id text not null references public.companies(id) on delete restrict,
  actor_uid uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{16,100}$'),
  client_ip_hash text not null check (client_ip_hash ~ '^[0-9a-f]{64}$'),
  quota_day date not null,
  reserved_at timestamptz not null default now(),
  unique(company_id,actor_uid,request_id)
);

create index ai_pilot_reservations_day_company_idx
  on public.ai_pilot_request_reservations(quota_day,company_id);
create index ai_pilot_reservations_day_actor_idx
  on public.ai_pilot_request_reservations(quota_day,actor_uid);
create index ai_pilot_reservations_ip_time_idx
  on public.ai_pilot_request_reservations(client_ip_hash,reserved_at desc);

alter table public.ai_pilot_runtime_settings enable row level security;
alter table public.ai_pilot_request_reservations enable row level security;
revoke all on public.ai_pilot_runtime_settings from public,anon,authenticated;
revoke all on public.ai_pilot_request_reservations from public,anon,authenticated;

create or replace function public.reserve_ai_pilot_request_server(
  p_company_id text,
  p_actor_uid uuid,
  p_session_id uuid,
  p_request_id text,
  p_client_ip_hash text
)
returns table(
  "reservationId" text,
  "persisted" boolean,
  "companyAllowed" boolean,
  "globalAllowed" boolean,
  "idempotent" boolean,
  "duplicate" boolean
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_settings public.ai_pilot_runtime_settings%rowtype;
  v_existing public.ai_pilot_request_reservations%rowtype;
  v_session_created timestamptz;
  v_session_not_after timestamptz;
  v_session_minutes integer;
  v_now timestamptz := clock_timestamp();
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_id text;
begin
  -- Only the service-role Edge boundary may reserve budget. Browser roles get
  -- neither table access nor RPC execution.
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'ACCESS_DENIED';
  end if;
  if coalesce(p_company_id,'') !~ '^[A-Za-z0-9._:-]{6,100}$'
     or coalesce(p_request_id,'') !~ '^[A-Za-z0-9._:-]{16,100}$'
     or coalesce(p_client_ip_hash,'') !~ '^[0-9a-f]{64}$'
     or p_actor_uid is null or p_session_id is null then
    raise exception 'INVALID_INPUT';
  end if;

  -- Serialize all reservations for the UTC day. This intentionally small pilot
  -- favors an auditable hard ceiling over throughput and closes quota races.
  perform pg_advisory_xact_lock(hashtextextended('ai-pilot:'||v_day::text,0));

  select * into v_settings
  from public.ai_pilot_runtime_settings s
  where s.singleton=true
  for update;
  if not found or v_settings.enabled is not true then
    raise exception 'AI_PILOT_DISABLED';
  end if;

  -- Re-check the live personal session and tenant role inside the same database
  -- transaction that reserves quota. The Edge preflight alone is not sufficient.
  select s.created_at,s.not_after,u.session_duration_minutes
  into v_session_created,v_session_not_after,v_session_minutes
  from auth.sessions s
  join public.app_users u
    on u.auth_user_id=s.user_id and u.disabled=false
  join public.company_memberships m
    on m.auth_user_id=s.user_id
   and m.company_id=p_company_id
   and m.role in ('admin','accountant')
  where s.id=p_session_id and s.user_id=p_actor_uid;
  if not found
     or (v_session_not_after is not null and v_now>=v_session_not_after)
     or (v_session_minutes is not null and
         v_now>=v_session_created+make_interval(mins=>v_session_minutes)) then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into v_existing
  from public.ai_pilot_request_reservations r
  where r.company_id=p_company_id
    and r.actor_uid=p_actor_uid
    and r.request_id=p_request_id;
  if found then
    return query select v_existing.id,true,false,false,true,true;
    return;
  end if;

  if (select count(*) from public.ai_pilot_request_reservations r
      where r.quota_day=v_day) >= v_settings.daily_global_limit then
    raise exception 'AI_GLOBAL_QUOTA_EXCEEDED';
  end if;
  if (select count(*) from public.ai_pilot_request_reservations r
      where r.quota_day=v_day and r.company_id=p_company_id)
      >= v_settings.daily_company_limit then
    raise exception 'AI_COMPANY_QUOTA_EXCEEDED';
  end if;
  if (select count(*) from public.ai_pilot_request_reservations r
      where r.quota_day=v_day and r.actor_uid=p_actor_uid)
      >= v_settings.daily_user_limit then
    raise exception 'AI_USER_QUOTA_EXCEEDED';
  end if;
  if (select count(*) from public.ai_pilot_request_reservations r
      where r.client_ip_hash=p_client_ip_hash
        and r.reserved_at>=v_now-make_interval(secs=>v_settings.ip_window_seconds))
      >= v_settings.ip_window_limit then
    raise exception 'AI_IP_QUOTA_EXCEEDED';
  end if;

  v_id:='aires_'||replace(gen_random_uuid()::text,'-','');
  insert into public.ai_pilot_request_reservations(
    id,company_id,actor_uid,session_id,request_id,client_ip_hash,quota_day,reserved_at
  ) values(
    v_id,p_company_id,p_actor_uid,p_session_id,p_request_id,p_client_ip_hash,v_day,v_now
  );
  return query select v_id,true,true,true,true,false;
end;
$$;

revoke all on function public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)
  to service_role;
