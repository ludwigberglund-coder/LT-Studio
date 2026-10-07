-- Rotate an unclaimed activation safely without changing company data.

create or replace function public.operator_reissue_company_activation(
  p_operator_id uuid,
  p_company_id text,
  p_code_sha256 text,
  p_admin_name text,
  p_admin_email text
)
returns table(invite_expires_at timestamptz)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_expires_at timestamptz:=now()+interval '48 hours';
  v_admin_email text:=lower(btrim(coalesce(p_admin_email,'')));
begin
  if p_operator_id is null or not exists(
    select 1 from public.platform_operators op
    where op.auth_user_id=p_operator_id and op.disabled=false
  ) then raise exception 'OPERATOR_ACCESS_DENIED'; end if;

  if not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  if exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.role='admin'
  ) then raise exception 'COMPANY_ALREADY_ACTIVATED'; end if;

  if coalesce(p_code_sha256,'') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INVITE_HASH'; end if;
  if char_length(btrim(coalesce(p_admin_name,''))) not between 2 and 120 then raise exception 'INVALID_ADMIN_NAME'; end if;
  if v_admin_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_ADMIN_EMAIL'; end if;

  update public.company_activation_invites
  set revoked_at=now()
  where company_id=p_company_id
    and claimed_at is null
    and revoked_at is null;

  insert into public.company_activation_invites(
    code_sha256,company_id,recipient_email,recipient_display_name,membership_role,
    expires_at,created_by_operator
  ) values(
    p_code_sha256,p_company_id,v_admin_email,btrim(p_admin_name),'admin',
    v_expires_at,p_operator_id
  );

  insert into public.operator_audit_events(
    operator_auth_user_id,action,company_id,details
  ) values(
    p_operator_id,'CUSTOMER_ACTIVATION_REISSUED',p_company_id,
    jsonb_build_object(
      'initialAdminEmailDomain',split_part(v_admin_email,'@',2),
      'inviteExpiresAt',v_expires_at
    )
  );

  return query select v_expires_at;
end;
$$;

revoke all on function public.operator_reissue_company_activation(uuid,text,text,text,text)
from public,anon,authenticated;

grant execute on function public.operator_reissue_company_activation(uuid,text,text,text,text)
to service_role;
