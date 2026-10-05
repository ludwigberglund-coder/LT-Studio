-- Supabase Performance Advisor cleanup, phase 1.
-- Applied to live UAT as hosted migration 20261005135109 on 2026-10-05.
-- GitHub is source of truth for the exact live state after the first cleanup phase.

create or replace function lt_security.session_within_personal_limit()
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session_id uuid;
  v_minutes integer;
  v_created_at timestamptz;
begin
  if v_uid is null then
    return false;
  end if;

  begin
    v_session_id := nullif((select auth.jwt()->>'session_id'),'')::uuid;
  exception when others then
    return false;
  end;

  if v_session_id is null then
    return false;
  end if;

  select u.session_duration_minutes, s.created_at
  into v_minutes, v_created_at
  from public.app_users u
  join auth.sessions s
    on s.id = v_session_id
   and s.user_id = v_uid
  where u.auth_user_id = v_uid
    and u.disabled = false;

  if not found or v_created_at is null then
    return false;
  end if;

  if v_minutes is null then
    return true;
  end if;

  return now() < v_created_at + make_interval(mins => v_minutes);
end;
$$;

revoke all on function lt_security.session_within_personal_limit() from public, anon;
grant execute on function lt_security.session_within_personal_limit() to authenticated;

create or replace function lt_security.setting_is_one(p_setting text)
returns boolean
language sql
stable
security invoker
set search_path=''
as $$
  select (select current_setting(p_setting, true)) = '1'
$$;

revoke all on function lt_security.setting_is_one(text) from public, anon;
grant execute on function lt_security.setting_is_one(text) to authenticated;

-- company_revenue_accounts: replace the old FOR ALL write policy with explicit
-- write actions so SELECT has only one permissive policy.
drop policy if exists "accountants write company revenue accounts" on public.company_revenue_accounts;
drop policy if exists "members read company revenue accounts" on public.company_revenue_accounts;

create policy "members read company revenue accounts"
on public.company_revenue_accounts
for select
to authenticated
using (
  (
    coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
    and (select lt_security.session_within_personal_limit())
    and exists (
      select 1 from public.company_memberships m
      where m.company_id=company_revenue_accounts.company_id
        and m.auth_user_id=(select auth.uid())
    )
  )
  or (
    (select lt_security.setting_is_one('app.revenue_account_write'))
    and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
    and (select lt_security.session_within_personal_limit())
    and exists (
      select 1 from public.company_memberships m
      where m.company_id=company_revenue_accounts.company_id
        and m.auth_user_id=(select auth.uid())
        and m.role in ('admin','accountant')
    )
  )
);

create policy "accountants insert company revenue accounts"
on public.company_revenue_accounts
for insert
to authenticated
with check (
  (select lt_security.setting_is_one('app.revenue_account_write'))
  and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=company_revenue_accounts.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

create policy "accountants update company revenue accounts"
on public.company_revenue_accounts
for update
to authenticated
using (
  (select lt_security.setting_is_one('app.revenue_account_write'))
  and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=company_revenue_accounts.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
)
with check (
  (select lt_security.setting_is_one('app.revenue_account_write'))
  and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=company_revenue_accounts.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

create policy "accountants delete company revenue accounts"
on public.company_revenue_accounts
for delete
to authenticated
using (
  (select lt_security.setting_is_one('app.revenue_account_write'))
  and coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
  and (select lt_security.session_within_personal_limit())
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=company_revenue_accounts.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

-- website_cms_state: preserve the old SELECT union explicitly while splitting
-- the write operations into INSERT/UPDATE/DELETE.
drop policy if exists "controlled website cms writes" on public.website_cms_state;
drop policy if exists "members read website cms state" on public.website_cms_state;

create policy "members read website cms state"
on public.website_cms_state
for select
to authenticated
using (
  (
    coalesce((select auth.jwt()->>'aal'),'aal1')='aal2'
    and (select lt_security.session_within_personal_limit())
    and exists (
      select 1 from public.company_memberships m
      where m.company_id=website_cms_state.company_id
        and m.auth_user_id=(select auth.uid())
    )
  )
  or (
    (select lt_security.setting_is_one('app.website_cms_write'))
    and exists (
      select 1 from public.company_memberships m
      where m.company_id=website_cms_state.company_id
        and m.auth_user_id=(select auth.uid())
        and m.role in ('admin','accountant')
    )
  )
);

create policy "controlled website cms inserts"
on public.website_cms_state
for insert
to authenticated
with check (
  (select lt_security.setting_is_one('app.website_cms_write'))
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=website_cms_state.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

create policy "controlled website cms updates"
on public.website_cms_state
for update
to authenticated
using (
  (select lt_security.setting_is_one('app.website_cms_write'))
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=website_cms_state.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
)
with check (
  (select lt_security.setting_is_one('app.website_cms_write'))
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=website_cms_state.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);

create policy "controlled website cms deletes"
on public.website_cms_state
for delete
to authenticated
using (
  (select lt_security.setting_is_one('app.website_cms_write'))
  and exists (
    select 1 from public.company_memberships m
    where m.company_id=website_cms_state.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant')
  )
);
