-- Move the LT Studio website CMS runtime state from the legacy SQLite API
-- to tenant-scoped Supabase Postgres.
--
-- Direct browser writes are intentionally denied. Authenticated company admins
-- read their tenant rows through RLS and mutate state only through the RPCs
-- below, which enforce AAL2, personal session lifetime, tenant membership,
-- optimistic concurrency, and immutable legal identity fields.

create table if not exists public.website_cms_state(
  company_id text primary key references public.companies(id) on delete cascade,
  draft_site jsonb not null,
  draft_company jsonb not null,
  draft_updated_by uuid,
  draft_updated_at timestamptz not null default now(),
  draft_revision integer not null default 1 check(draft_revision > 0),
  published_site jsonb not null,
  published_company jsonb not null,
  published_version integer not null default 0 check(published_version >= 0),
  published_by uuid,
  published_at timestamptz
);

create table if not exists public.website_cms_revisions(
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  version integer not null check(version > 0),
  site_json jsonb not null,
  company_json jsonb not null,
  published_by uuid not null,
  published_at timestamptz not null default now(),
  unique(company_id,version)
);

create index if not exists website_cms_revisions_company_version_idx
  on public.website_cms_revisions(company_id,version desc);

alter table public.website_cms_state enable row level security;
alter table public.website_cms_revisions enable row level security;

revoke all on table public.website_cms_state from anon,authenticated;
revoke all on table public.website_cms_revisions from anon,authenticated;
grant select on table public.website_cms_state to authenticated;
grant select on table public.website_cms_revisions to authenticated;

drop policy if exists "admins read website cms state" on public.website_cms_state;
create policy "admins read website cms state"
on public.website_cms_state
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships m
    where m.company_id = website_cms_state.company_id
      and m.auth_user_id = (select auth.uid())
      and m.role = 'admin'
  )
);

drop policy if exists "admins read website cms revisions" on public.website_cms_revisions;
create policy "admins read website cms revisions"
on public.website_cms_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships m
    where m.company_id = website_cms_revisions.company_id
      and m.auth_user_id = (select auth.uid())
      and m.role = 'admin'
  )
);

drop policy if exists "UAT requires AAL2" on public.website_cms_state;
create policy "UAT requires AAL2"
on public.website_cms_state
as restrictive
for all
to authenticated
using (
  coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
  and (select lt_security.session_within_personal_limit())
)
with check (
  coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
  and (select lt_security.session_within_personal_limit())
);

drop policy if exists "UAT requires AAL2" on public.website_cms_revisions;
create policy "UAT requires AAL2"
on public.website_cms_revisions
as restrictive
for all
to authenticated
using (
  coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
  and (select lt_security.session_within_personal_limit())
)
with check (
  coalesce((select auth.jwt()->>'aal'),'aal1') = 'aal2'
  and (select lt_security.session_within_personal_limit())
);

create or replace function lt_security.ensure_website_cms_state(p_company_id text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company public.companies%rowtype;
  v_settings public.company_invoice_settings%rowtype;
  v_site jsonb;
  v_company_json jsonb;
begin
  select * into v_company
  from public.companies
  where id = p_company_id;
  if not found then
    return;
  end if;

  select * into v_settings
  from public.company_invoice_settings
  where company_id = p_company_id;

  v_site = jsonb_build_object(
    'meta',jsonb_build_object(
      'title',v_company.display_name||' | Webbplats',
      'description','Information, erbjudanden och kontakt för '||v_company.display_name||'.',
      'language','sv'
    ),
    'navigation',jsonb_build_array(
      jsonb_build_object('label','Hem','href','#hem'),
      jsonb_build_object('label','Erbjudande','href','#erbjudande'),
      jsonb_build_object('label','Om oss','href','#om'),
      jsonb_build_object('label','Kontakt','href','#kontakt')
    ),
    'hero',jsonb_build_object(
      'eyebrow','Välkommen till '||v_company.display_name,
      'title','Enklare information för kunder och företag.',
      'body','Här hittar du aktuell information om '||v_company.display_name||'.',
      'primaryCta',jsonb_build_object('label','Kontakta oss','href','#kontakt'),
      'secondaryCta',jsonb_build_object('label','Läs mer','href','#om')
    ),
    'highlights',jsonb_build_array(
      jsonb_build_object('value','Aktuellt','label','information och erbjudanden'),
      jsonb_build_object('value','Kontakt','label','nå oss enkelt'),
      jsonb_build_object('value','Företag','label','anpassat efter verksamheten')
    ),
    'services',jsonb_build_object(
      'eyebrow','Vårt erbjudande',
      'title','Produkter och tjänster',
      'body','Anpassa innehållet efter verksamhetens faktiska erbjudande.',
      'items',jsonb_build_array(
        jsonb_build_object('id','products','symbol','01','title','Produkter och tjänster','description','Beskriv företagets viktigaste produkter eller tjänster här.'),
        jsonb_build_object('id','business','symbol','02','title','För företag','description','Beskriv erbjudanden eller lösningar för företagskunder här.'),
        jsonb_build_object('id','service','symbol','03','title','Service','description','Beskriv den service och hjälp som kunder kan få.')
      )
    ),
    'story',jsonb_build_object(
      'eyebrow','Om oss',
      'title','Om '||v_company.display_name,
      'body','Beskriv verksamheten, inriktningen och det som är viktigt för kunderna.',
      'points',jsonb_build_array(
        'Tydlig information för kunder',
        'Aktuella kontaktuppgifter och öppettider',
        'Innehåll som kan uppdateras utan kodändringar'
      )
    ),
    'contact',jsonb_build_object(
      'eyebrow','Kontakt',
      'title','Välkommen att höra av dig',
      'body','Kontakta '||v_company.display_name||' för aktuell information och frågor.',
      'openingHours',jsonb_build_array(
        jsonb_build_object('days','Öppettider','hours','Lägg in aktuella öppettider')
      )
    ),
    'footer',jsonb_build_object(
      'tagline',v_company.display_name||'.',
      'adminLabel','Öppna webbplatsadministration'
    )
  );

  v_company_json = jsonb_build_object(
    'legalName',v_company.legal_name,
    'displayName',v_company.display_name,
    'orgNumber',v_company.org_number,
    'vatNumber',coalesce(v_settings.vat_number,''),
    'registeredOffice','',
    'address',jsonb_build_object(
      'street',coalesce(nullif(v_settings.address,''),'Ej angiven'),
      'postalCode','000 00',
      'city','Ej angiven',
      'full',coalesce(nullif(v_settings.address,''),'Adress ej angiven')
    ),
    'contact',jsonb_build_object(
      'phone',coalesce(nullif(v_settings.phone,''),'Ej angivet'),
      'phoneHref','+46000000000',
      'email',coalesce(nullif(v_settings.email,''),'info@example.invalid')
    ),
    'website',coalesce(v_settings.website,''),
    'invoice',jsonb_build_object(
      'bankgiro',coalesce(v_settings.bankgiro,''),
      'taxStatus',coalesce(v_settings.tax_status,'')
    ),
    'business',jsonb_build_object('description','','currency','SEK'),
    'links',jsonb_build_object('maps','#kontakt')
  );

  insert into public.website_cms_state(
    company_id,draft_site,draft_company,draft_updated_at,
    published_site,published_company,published_version
  )
  values(p_company_id,v_site,v_company_json,now(),v_site,v_company_json,0)
  on conflict(company_id) do nothing;
end;
$$;

revoke all on function lt_security.ensure_website_cms_state(text)
from public,anon,authenticated;

create or replace function lt_security.bootstrap_website_cms_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform lt_security.ensure_website_cms_state(new.id);
  return new;
end;
$$;

revoke all on function lt_security.bootstrap_website_cms_state()
from public,anon,authenticated;

drop trigger if exists companies_bootstrap_website_cms on public.companies;
create trigger companies_bootstrap_website_cms
after insert on public.companies
for each row execute function lt_security.bootstrap_website_cms_state();

select lt_security.ensure_website_cms_state(id)
from public.companies;

create or replace function public.save_website_cms_draft(
  p_company_id text,
  p_expected_revision integer,
  p_site jsonb,
  p_company jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_legal_name text;
  v_org_number text;
  v_vat_number text;
  v_registered_office text;
  v_business jsonb;
  v_locked_company jsonb;
  v_count integer;
begin
  if v_uid is null
     or coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2'
     or not lt_security.session_within_personal_limit()
  then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.auth_user_id = v_uid
      and m.role = 'admin'
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  perform lt_security.ensure_website_cms_state(p_company_id);

  if jsonb_typeof(p_site) <> 'object'
     or jsonb_typeof(p_company) <> 'object'
     or nullif(btrim(p_site#>>'{meta,title}'),'') is null
     or nullif(btrim(p_site#>>'{meta,description}'),'') is null
     or nullif(btrim(p_site#>>'{hero,title}'),'') is null
     or nullif(btrim(p_site#>>'{hero,body}'),'') is null
     or jsonb_typeof(p_site#>'{services,items}') <> 'array'
     or nullif(btrim(p_company->>'displayName'),'') is null
     or nullif(btrim(p_company#>>'{contact,email}'),'') is null
  then
    raise exception 'INVALID_WEBSITE_CONTENT';
  end if;

  select
    c.legal_name,
    c.org_number,
    coalesce(nullif(s.vat_number,''),st.published_company->>'vatNumber',''),
    coalesce(st.published_company->>'registeredOffice',''),
    coalesce(st.published_company->'business','{}'::jsonb)
  into
    v_legal_name,
    v_org_number,
    v_vat_number,
    v_registered_office,
    v_business
  from public.companies c
  join public.website_cms_state st on st.company_id = c.id
  left join public.company_invoice_settings s on s.company_id = c.id
  where c.id = p_company_id;

  v_locked_company = p_company || jsonb_build_object(
    'legalName',v_legal_name,
    'orgNumber',v_org_number,
    'vatNumber',v_vat_number,
    'registeredOffice',v_registered_office,
    'business',v_business
  );

  update public.website_cms_state
  set draft_site = p_site,
      draft_company = v_locked_company,
      draft_updated_by = v_uid,
      draft_updated_at = now(),
      draft_revision = draft_revision + 1
  where company_id = p_company_id
    and draft_revision = p_expected_revision;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'CMS_REVISION_CONFLICT';
  end if;

  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.publish_website_cms(
  p_company_id text,
  p_expected_revision integer,
  p_expected_published_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_state public.website_cms_state%rowtype;
  v_version integer;
begin
  if v_uid is null
     or coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2'
     or not lt_security.session_within_personal_limit()
  then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.auth_user_id = v_uid
      and m.role = 'admin'
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into v_state
  from public.website_cms_state
  where company_id = p_company_id
  for update;

  if not found then
    raise exception 'CMS_STATE_NOT_FOUND';
  end if;
  if v_state.draft_revision <> p_expected_revision then
    raise exception 'CMS_REVISION_CONFLICT';
  end if;
  if v_state.published_version <> p_expected_published_version then
    raise exception 'CMS_PUBLICATION_CONFLICT';
  end if;

  v_version = v_state.published_version + 1;

  insert into public.website_cms_revisions(
    company_id,version,site_json,company_json,published_by,published_at
  )
  values(
    p_company_id,v_version,v_state.draft_site,v_state.draft_company,v_uid,now()
  );

  update public.website_cms_state
  set published_site = v_state.draft_site,
      published_company = v_state.draft_company,
      published_version = v_version,
      published_by = v_uid,
      published_at = now()
  where company_id = p_company_id;

  return jsonb_build_object('ok',true,'version',v_version);
end;
$$;

create or replace function public.restore_website_cms_revision(
  p_company_id text,
  p_version integer,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.website_cms_revisions%rowtype;
  v_count integer;
begin
  if v_uid is null
     or coalesce((select auth.jwt()->>'aal'),'aal1') <> 'aal2'
     or not lt_security.session_within_personal_limit()
  then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists(
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.auth_user_id = v_uid
      and m.role = 'admin'
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into v_revision
  from public.website_cms_revisions
  where company_id = p_company_id
    and version = p_version;

  if not found then
    raise exception 'WEBSITE_REVISION_NOT_FOUND';
  end if;

  update public.website_cms_state
  set draft_site = v_revision.site_json,
      draft_company = v_revision.company_json,
      draft_updated_by = v_uid,
      draft_updated_at = now(),
      draft_revision = draft_revision + 1
  where company_id = p_company_id
    and draft_revision = p_expected_revision;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'CMS_REVISION_CONFLICT';
  end if;

  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.save_website_cms_draft(text,integer,jsonb,jsonb)
from public,anon,authenticated;
revoke all on function public.publish_website_cms(text,integer,integer)
from public,anon,authenticated;
revoke all on function public.restore_website_cms_revision(text,integer,integer)
from public,anon,authenticated;

grant execute on function public.save_website_cms_draft(text,integer,jsonb,jsonb)
to authenticated;
grant execute on function public.publish_website_cms(text,integer,integer)
to authenticated;
grant execute on function public.restore_website_cms_revision(text,integer,integer)
to authenticated;
