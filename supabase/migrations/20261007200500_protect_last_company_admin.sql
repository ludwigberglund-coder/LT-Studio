-- Atomically protect the last active company administrator.
-- Service-role only: operator-admin calls this RPC after its own AAL2/operator checks.

create or replace function public.operator_change_company_membership(
  p_company_id text,
  p_target_auth_user_id uuid,
  p_action text,
  p_role text,
  p_operator_auth_user_id uuid
)
returns table(previous_role text, resulting_role text, removed boolean)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_member public.company_memberships%rowtype;
  v_other_active_admins integer;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_role text:=lower(btrim(coalesce(p_role,'')));
begin
  if coalesce(p_company_id,'')='' or p_target_auth_user_id is null or p_operator_auth_user_id is null then
    raise exception 'INVALID_MEMBERSHIP_CHANGE';
  end if;
  if v_action not in ('set-role','remove') then
    raise exception 'INVALID_MEMBERSHIP_ACTION';
  end if;
  if v_action='set-role' and v_role not in ('admin','accountant','approver','readonly') then
    raise exception 'INVALID_ROLE';
  end if;

  -- Serializes every membership change that can affect the company's admin floor.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':company-admin-floor',0));

  select * into v_member
  from public.company_memberships m
  where m.company_id=p_company_id
    and m.auth_user_id=p_target_auth_user_id
  for update;

  if not found then
    raise exception 'MEMBERSHIP_NOT_FOUND';
  end if;

  if v_member.role='admin'
     and (v_action='remove' or v_role<>'admin') then
    select count(*) into v_other_active_admins
    from public.company_memberships m
    join public.app_users u on u.auth_user_id=m.auth_user_id
    where m.company_id=p_company_id
      and m.role='admin'
      and m.auth_user_id<>p_target_auth_user_id
      and u.disabled=false;

    if v_other_active_admins<1 then
      raise exception 'LAST_ACTIVE_ADMIN_REQUIRED';
    end if;
  end if;

  if v_action='set-role' then
    update public.company_memberships
    set role=v_role
    where company_id=p_company_id
      and auth_user_id=p_target_auth_user_id;

    insert into public.operator_audit_events(
      operator_auth_user_id,action,company_id,target_auth_user_id,details
    ) values(
      p_operator_auth_user_id,'CUSTOMER_USER_ROLE_CHANGED',p_company_id,p_target_auth_user_id,
      jsonb_build_object('beforeRole',v_member.role,'afterRole',v_role)
    );

    return query select v_member.role,v_role,false;
  else
    delete from public.company_memberships
    where company_id=p_company_id
      and auth_user_id=p_target_auth_user_id;

    insert into public.operator_audit_events(
      operator_auth_user_id,action,company_id,target_auth_user_id,details
    ) values(
      p_operator_auth_user_id,'CUSTOMER_USER_REMOVED',p_company_id,p_target_auth_user_id,
      jsonb_build_object('role',v_member.role)
    );

    return query select v_member.role,null::text,true;
  end if;
end;
$$;

revoke all on function public.operator_change_company_membership(text,uuid,text,text,uuid)
from public,anon,authenticated;

grant execute on function public.operator_change_company_membership(text,uuid,text,text,uuid)
to service_role;
