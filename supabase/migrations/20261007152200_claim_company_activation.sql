-- Atomic service-role-only claim of the first customer administrator.
-- Supports both a brand-new Auth identity and an existing LT Studio identity.

create or replace function public.claim_company_activation_invite(
  p_code_sha256 text,
  p_email text,
  p_auth_user_id uuid,
  p_app_user_id text
)
returns table(company_id text, company_name text, membership_role text)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_invite public.company_activation_invites%rowtype;
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_company_name text;
  v_profile_id text;
begin
  if coalesce(p_code_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INVITE'; end if;
  if p_auth_user_id is null or coalesce(p_app_user_id,'')='' then raise exception 'INVALID_ACCOUNT'; end if;

  select * into v_invite
  from public.company_activation_invites i
  where i.code_sha256=p_code_sha256
  for update;

  if not found
     or v_invite.revoked_at is not null
     or v_invite.claimed_at is not null
     or v_invite.expires_at<=now()
     or lower(v_invite.recipient_email)<>v_email then
    raise exception 'INVALID_INVITE';
  end if;

  select u.id into v_profile_id
  from public.app_users u
  where u.auth_user_id=p_auth_user_id;

  if v_profile_id is null then
    insert into public.app_users(
      id,auth_user_id,username,display_name,disabled,session_duration_minutes
    ) values(
      p_app_user_id,p_auth_user_id,v_email,v_invite.recipient_display_name,false,480
    );
    v_profile_id:=p_app_user_id;
  end if;

  if exists(
    select 1 from public.company_memberships m
    where m.company_id=v_invite.company_id and m.auth_user_id=p_auth_user_id
  ) then
    raise exception 'MEMBERSHIP_EXISTS';
  end if;

  insert into public.company_memberships(
    company_id,auth_user_id,user_id,role
  ) values(
    v_invite.company_id,p_auth_user_id,v_profile_id,v_invite.membership_role
  );

  update public.company_activation_invites
  set claimed_auth_user_id=p_auth_user_id,claimed_at=now()
  where id=v_invite.id;

  select coalesce(c.display_name,c.legal_name) into v_company_name
  from public.companies c where c.id=v_invite.company_id;

  insert into public.operator_audit_events(
    operator_auth_user_id,action,company_id,target_auth_user_id,details
  ) values(
    v_invite.created_by_operator,'CUSTOMER_INITIAL_ADMIN_ACTIVATED',
    v_invite.company_id,p_auth_user_id,
    jsonb_build_object('role',v_invite.membership_role)
  );

  return query select v_invite.company_id,v_company_name,v_invite.membership_role;
end;
$$;

revoke all on function public.claim_company_activation_invite(text,text,uuid,text)
from public,anon,authenticated;

grant execute on function public.claim_company_activation_invite(text,text,uuid,text)
to service_role;
