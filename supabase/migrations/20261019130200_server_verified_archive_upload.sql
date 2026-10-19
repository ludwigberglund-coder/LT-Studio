-- Archive PDF uploads must pass a trusted Edge validator before ANY final
-- original is created. Existing customer-invoice verification flows remain intact.
-- Service-role-only rate counters use an atomic, company-serialized quota.
--
-- Browser users can still upload generated customer invoices into their
-- dedicated staging folders, but NEVER archive arbitrary '/documents/' files.

-- Explicit provenance distinguishes new deeply checked uploads from legacy
-- originals that predate the trusted Edge boundary.
alter table public.documents
  add column if not exists server_verified_at timestamptz;
create unique index if not exists documents_server_verified_sha_idx
  on public.documents(company_id,sha256)
  where server_verified_at is not null;

revoke insert on public.documents from authenticated;
drop policy if exists "members can write company documents" on public.documents;

drop policy if exists "lt archive requires trusted uploader" on storage.objects;
create policy "lt archive requires trusted uploader"
on storage.objects as restrictive for insert to authenticated
with check (
  not (
    bucket_id='lt-documents'
    and (storage.foldername(name))[2]='documents'
  )
);

create table if not exists public.archive_pdf_upload_rate_windows (
  company_id text not null references public.companies(id) on delete cascade,
  actor_key text not null,
  window_kind text not null check(window_kind in ('minute','day')),
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 100),
  primary key(company_id,actor_key,window_kind,window_start)
);
alter table public.archive_pdf_upload_rate_windows enable row level security;
revoke all on public.archive_pdf_upload_rate_windows from public,anon,authenticated;
grant select,insert,update,delete on public.archive_pdf_upload_rate_windows to service_role;

-- A private-ish public RPC is necessary because PostgREST exposes public.
-- Not accessible to authenticated/anon: the Edge server calls it using its
-- server-held service key. No SECURITY DEFINER, no user-controlled SQL.
create or replace function public.reserve_archive_pdf_upload(
  p_company_id text,
  p_actor_id uuid
)
returns boolean language plpgsql security invoker set search_path=''
as $$
declare
  v_minute timestamptz:=date_trunc('minute',now());
  v_day timestamptz:=date_trunc('day',now());
begin
  if p_company_id is null or length(p_company_id)<1
     or p_actor_id is null then
    return false;
  end if;

  -- Atomic across simultaneous submissions from users in the same company.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lt-archive-upload:'||p_company_id,0)
  );

  -- Quota is needed only for the current minute/day. Remove stale counters
  -- under the same company lock so long-lived free-tier databases stay lean.
  delete from public.archive_pdf_upload_rate_windows
  where company_id=p_company_id
    and window_start < now()-interval '2 days';

  if exists(
    select 1 from public.archive_pdf_upload_rate_windows q
    where q.company_id=p_company_id
      and (
        (q.actor_key=p_actor_id::text and q.window_kind='minute'
          and q.window_start=v_minute and q.attempts>=4)
        or
        (q.actor_key=p_actor_id::text and q.window_kind='day'
          and q.window_start=v_day and q.attempts>=40)
        or
        (q.actor_key='*' and q.window_kind='minute'
          and q.window_start=v_minute and q.attempts>=12)
        or
        (q.actor_key='*' and q.window_kind='day'
          and q.window_start=v_day and q.attempts>=100)
      )
  ) then
    return false;
  end if;

  insert into public.archive_pdf_upload_rate_windows (
    company_id,actor_key,window_kind,window_start,attempts
  ) values
    (p_company_id,p_actor_id::text,'minute',v_minute,1),
    (p_company_id,p_actor_id::text,'day',v_day,1),
    (p_company_id,'*','minute',v_minute,1),
    (p_company_id,'*','day',v_day,1)
  on conflict(company_id,actor_key,window_kind,window_start)
  do update set attempts=public.archive_pdf_upload_rate_windows.attempts+1;

  return true;
end;
$$;

revoke all on function public.reserve_archive_pdf_upload(text,uuid)
  from public,anon,authenticated;
grant execute on function public.reserve_archive_pdf_upload(text,uuid)
  to service_role;

create index if not exists archive_pdf_upload_rate_expiry_idx
  on public.archive_pdf_upload_rate_windows(window_start);
