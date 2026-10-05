-- Supabase Performance Advisor cleanup for RLS init-plan and duplicate permissive policies.
-- GitHub is source of truth. Apply to hosted UAT only after this branch passes clean rebuild + CI.

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

-- Optimize existing policies that use request-local write guards directly.
-- The expressions are taken from the already-versioned policies; only
-- current_setting(...)=1 is replaced with a scalar init-plan helper.
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_using_new text;
  v_check_new text;
  v_setting text;
  v_changed integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname='public'
      and not (tablename='company_revenue_accounts' and policyname='accountants write company revenue accounts')
      and not (tablename='website_cms_state' and policyname='controlled website cms writes')
      and (
        coalesce(qual,'') like '%current_setting(%'
        or coalesce(with_check,'') like '%current_setting(%'
      )
  loop
    v_using := r.qual;
    v_check := r.with_check;
    v_using_new := v_using;
    v_check_new := v_check;

    foreach v_setting in array array[
      'app.audit_event_write',
      'app.system_batch_stage',
      'app.financial_batch_approval',
      'app.invoice_comment_write',
      'app.invoice_reminder_write',
      'app.website_cms_write'
    ]
    loop
      if v_using_new is not null then
        v_using_new := replace(
          v_using_new,
          format('current_setting(%L::text, true) = ''1''::text', v_setting),
          format('(select lt_security.setting_is_one(%L))', v_setting)
        );
      end if;
      if v_check_new is not null then
        v_check_new := replace(
          v_check_new,
          format('current_setting(%L::text, true) = ''1''::text', v_setting),
          format('(select lt_security.setting_is_one(%L))', v_setting)
        );
      end if;
    end loop;

    if v_using_new is distinct from v_using or v_check_new is distinct from v_check then
      execute format(
        'alter policy %I on %I.%I%s%s',
        r.policyname,
        r.schemaname,
        r.tablename,
        case when v_using_new is null then '' else format(' using (%s)',v_using_new) end,
        case when v_check_new is null then '' else format(' with check (%s)',v_check_new) end
      );
      v_changed := v_changed + 1;
    end if;
  end loop;

  if v_changed <> 14 then
    raise exception 'RLS_INITPLAN_EXPECTED_14_POLICIES_CHANGED_GOT_%', v_changed;
  end if;
end;
$$;

-- company_revenue_accounts: preserve the old FOR ALL semantics while ensuring
-- authenticated SELECT has only one permissive policy.
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

-- website_cms_state: the old FOR ALL write policy also participated in SELECT.
-- Preserve that union explicitly in the single SELECT policy, then split writes.
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
