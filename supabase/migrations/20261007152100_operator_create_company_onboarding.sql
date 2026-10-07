-- Atomic operator-only creation of a real customer company plus its first admin activation.
-- The function is callable only with the service role and verifies the operator again.

create or replace function public.operator_create_company_onboarding(
  p_operator_id uuid,
  p_code_sha256 text,
  p_legal_name text,
  p_display_name text,
  p_org_number text,
  p_address text,
  p_vat_number text,
  p_phone text,
  p_company_email text,
  p_website text,
  p_bankgiro text,
  p_tax_status text,
  p_admin_name text,
  p_admin_email text
)
returns table(company_id text, invite_expires_at timestamptz)
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_company_id text;
  v_expires_at timestamptz:=now()+interval '48 hours';
  v_admin_email text:=lower(btrim(coalesce(p_admin_email,'')));
  v_company_email text:=lower(btrim(coalesce(p_company_email,'')));
  v_org_digits text:=replace(coalesce(p_org_number,''),'-','');
  v_luhn_sum integer:=0;
  v_luhn_digit integer;
  v_i integer;
begin
  if p_operator_id is null or not exists(
    select 1
    from public.platform_operators op
    where op.auth_user_id=p_operator_id
      and op.disabled=false
  ) then
    raise exception 'OPERATOR_ACCESS_DENIED';
  end if;

  if coalesce(p_code_sha256,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITE_HASH';
  end if;

  if char_length(btrim(coalesce(p_legal_name,''))) not between 2 and 160 then
    raise exception 'INVALID_COMPANY_NAME';
  end if;

  if char_length(btrim(coalesce(p_display_name,''))) not between 2 and 80 then
    raise exception 'INVALID_COMPANY_DISPLAY_NAME';
  end if;

  if coalesce(p_org_number,'') !~ '^[0-9]{6}-[0-9]{4}$' then
    raise exception 'INVALID_ORG_NUMBER';
  end if;

  for v_i in 1..9 loop
    v_luhn_digit:=substr(v_org_digits,v_i,1)::integer
      * case when mod(v_i,2)=1 then 2 else 1 end;
    if v_luhn_digit>9 then
      v_luhn_digit:=v_luhn_digit-9;
    end if;
    v_luhn_sum:=v_luhn_sum+v_luhn_digit;
  end loop;

  if mod(10-mod(v_luhn_sum,10),10)<>substr(v_org_digits,10,1)::integer then
    raise exception 'INVALID_ORG_NUMBER';
  end if;

  if char_length(btrim(coalesce(p_address,''))) not between 4 and 240 then
    raise exception 'INVALID_COMPANY_ADDRESS';
  end if;

  if upper(btrim(coalesce(p_vat_number,'')))<>('SE'||v_org_digits||'01') then
    raise exception 'INVALID_VAT_NUMBER';
  end if;

  if v_company_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'INVALID_COMPANY_EMAIL';
  end if;

  if char_length(btrim(coalesce(p_phone,'')))>40 then
    raise exception 'INVALID_COMPANY_PHONE';
  end if;

  if btrim(coalesce(p_website,''))<>''
     and btrim(p_website) !~ '^https://[^[:space:]]+$' then
    raise exception 'INVALID_COMPANY_WEBSITE';
  end if;

  if btrim(coalesce(p_bankgiro,''))<>''
     and btrim(p_bankgiro) !~ '^[0-9]{3,4}-[0-9]{4}$' then
    raise exception 'INVALID_BANKGIRO';
  end if;

  if btrim(coalesce(p_tax_status,'')) not in (
    'Godkänd för F-skatt',
    'Godkänd för FA-skatt',
    'Ej godkänd för F-skatt'
  ) then
    raise exception 'INVALID_TAX_STATUS';
  end if;

  if char_length(btrim(coalesce(p_admin_name,''))) not between 2 and 120 then
    raise exception 'INVALID_ADMIN_NAME';
  end if;

  if v_admin_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'INVALID_ADMIN_EMAIL';
  end if;

  if exists(
    select 1
    from public.companies c
    where c.org_number=p_org_number
  ) then
    raise exception 'COMPANY_ORG_NUMBER_EXISTS';
  end if;

  v_company_id:='company_'||replace(gen_random_uuid()::text,'-','');

  insert into public.companies(
    id,
    legal_name,
    org_number,
    display_name
  ) values(
    v_company_id,
    btrim(p_legal_name),
    p_org_number,
    btrim(p_display_name)
  );

  insert into public.company_invoice_settings(
    company_id,
    address,
    vat_number,
    phone,
    email,
    website,
    bankgiro,
    tax_status,
    updated_by,
    updated_at
  ) values(
    v_company_id,
    btrim(p_address),
    upper(btrim(p_vat_number)),
    btrim(coalesce(p_phone,'')),
    v_company_email,
    btrim(coalesce(p_website,'')),
    btrim(coalesce(p_bankgiro,'')),
    btrim(p_tax_status),
    p_operator_id,
    now()
  );

  insert into public.company_activation_invites(
    code_sha256,
    company_id,
    recipient_email,
    recipient_display_name,
    membership_role,
    expires_at,
    created_by_operator
  ) values(
    p_code_sha256,
    v_company_id,
    v_admin_email,
    btrim(p_admin_name),
    'admin',
    v_expires_at,
    p_operator_id
  );

  insert into public.operator_audit_events(
    operator_auth_user_id,
    action,
    company_id,
    details
  ) values(
    p_operator_id,
    'CUSTOMER_COMPANY_CREATED',
    v_company_id,
    jsonb_build_object(
      'legalName',btrim(p_legal_name),
      'displayName',btrim(p_display_name),
      'orgNumber',p_org_number,
      'initialAdminEmailDomain',split_part(v_admin_email,'@',2),
      'inviteExpiresAt',v_expires_at
    )
  );

  return query
  select v_company_id,v_expires_at;
end;
$$;

revoke all on function public.operator_create_company_onboarding(
  uuid,text,text,text,text,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;

grant execute on function public.operator_create_company_onboarding(
  uuid,text,text,text,text,text,text,text,text,text,text,text,text,text
) to service_role;
