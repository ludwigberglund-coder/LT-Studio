-- Automatically identify one safe invoice when a bank payment is imported.
-- Matching only creates an existing auditable automation proposal. Posting remains gated.
-- No automatic match for deliberately staged manual/unplaced payments.
-- All lookups are scoped to the authenticated company and use SECURITY INVOKER.

create or replace function public.bank_match_normalize_name(p_name text)
returns text language sql immutable set search_path=''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.translate(pg_catalog.lower(pg_catalog.btrim(coalesce(p_name,''))),
        'åäöéèü','aaoeeu'),
      '(^|[[:space:]])(aktiebolag|ab|handelsbolag|hb|kommanditbolag|kb)[[:space:]]*$',
      '', 'i'),
    '[^a-z0-9]', '', 'g');
$$;

create or replace function public.bank_match_has_reference(
  p_reference text, p_message text, p_identifier text
)
returns boolean language sql immutable set search_path=''
as $$
  select pg_catalog.length(v.identifier) >= 4
    and exists (
      select 1
      from pg_catalog.unnest(array[p_reference,p_message]) as source(raw)
      cross join lateral pg_catalog.regexp_split_to_table(
        pg_catalog.lower(coalesce(source.raw,'')), '[^a-z0-9/-]+'
      ) as token(piece)
      where pg_catalog.regexp_replace(token.piece,'[^a-z0-9]','','g') = v.identifier
         or pg_catalog.regexp_replace(
           pg_catalog.lower(coalesce(source.raw,'')), '[^a-z0-9]','','g'
         ) = v.identifier
    )
  from (select pg_catalog.regexp_replace(
    pg_catalog.lower(coalesce(p_identifier,'')), '[^a-z0-9]', '', 'g'
  ) as identifier) v;
$$;

create or replace function public.bank_match_mentions_org(p_source text, p_org_number text)
returns boolean language sql immutable set search_path=''
as $$
  select case when pg_catalog.length(v.number)=10 then
    coalesce(p_source,'') ~ (
      '(^|[^0-9])(16)?' || pg_catalog.left(v.number,6) ||
      '[-/[:space:]]?' || pg_catalog.right(v.number,4) || '([^0-9]|$)'
    )
    else false end
  from (
    select case
      when pg_catalog.length(raw.digits)=12 and pg_catalog.left(raw.digits,2)='16'
        then pg_catalog.substring(raw.digits from 3)
      else raw.digits end as number
    from (
      select pg_catalog.regexp_replace(coalesce(p_org_number,''),'[^0-9]','','g') as digits
    ) raw
  ) v;
$$;

revoke all on function public.bank_match_normalize_name(text) from public,anon;
revoke all on function public.bank_match_has_reference(text,text,text) from public,anon;
revoke all on function public.bank_match_mentions_org(text,text) from public,anon;
grant execute on function public.bank_match_normalize_name(text) to authenticated;
grant execute on function public.bank_match_has_reference(text,text,text) to authenticated;
grant execute on function public.bank_match_mentions_org(text,text) to authenticated;

create or replace function public.auto_match_imported_bank_payment(
  p_company_id text, p_bank_payment_id text
)
returns table(proposal_id text, status text, matched_invoice_id text, reason text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_bank public.bank_payments%rowtype;
  v_reference_invoices text[]:=array[]::text[];
  v_eligible_references text[]:=array[]::text[];
  v_eligible_orgs text[]:=array[]::text[];
  v_eligible_names text[]:=array[]::text[];
  v_org_customers text[]:=array[]::text[];
  v_name_customers text[]:=array[]::text[];
  v_invoice record;
  v_choice text;
  v_kind text;
  v_confidence integer;
  v_reason text;
  v_evidence jsonb;
  v_saved record;
  v_payer_name text;
  v_payer_text text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;

  -- Serializes matching with any other status change to this same bank event.
  select * into v_bank from public.bank_payments b
  where b.company_id=p_company_id and b.id=p_bank_payment_id for update;
  if not found then raise exception 'BANK_PAYMENT_NOT_FOUND'; end if;

  if v_bank.status <> 'unmatched' then
    return query select null::text,v_bank.status,null::text,
      'Betalningen är redan hanterad eller har ett öppet förslag.'::text;
    return;
  end if;
  if exists(select 1 from public.customer_payment_executions e
            where e.company_id=p_company_id and e.bank_payment_id=v_bank.id)
     or exists(select 1 from public.unplaced_payment_resolutions r
               where r.company_id=p_company_id and r.bank_payment_id=v_bank.id) then
    return query select null::text,'unmatched'::text,null::text,
      'Bankhändelsen har redan en bokförd hantering.'::text;
    return;
  end if;

  v_payer_name:=public.bank_match_normalize_name(v_bank.payer_name);
  v_payer_text:=pg_catalog.concat_ws(' ',v_bank.payer_name,v_bank.reference,v_bank.message);

  -- Look for invoice identifiers even on ineligible invoices. A reference to
  -- a paid or pending invoice must never silently fall back to a name match.
  select coalesce(pg_catalog.array_agg(i.id order by i.id),array[]::text[])
  into v_reference_invoices
  from public.invoices i
  where i.company_id=p_company_id and i.total_ore>0
    and (
      public.bank_match_has_reference(v_bank.reference,v_bank.message,i.ocr)
      or public.bank_match_has_reference(v_bank.reference,v_bank.message,i.invoice_number)
    );

  -- A customer identity must be unique: duplicate customer cards or conflicting
  -- payer name / org-number evidence prevent any automatic invoice placement.
  select
    coalesce(pg_catalog.array_agg(c.id order by c.id) filter (
      where public.bank_match_mentions_org(v_payer_text,c.org_number)
    ),array[]::text[]),
    coalesce(pg_catalog.array_agg(c.id order by c.id) filter (
      where pg_catalog.length(v_payer_name)>=6
        and v_payer_name=public.bank_match_normalize_name(c.name)
    ),array[]::text[])
  into v_org_customers,v_name_customers
  from public.customers c
  where c.company_id=p_company_id and c.archived_at is null;

  if pg_catalog.cardinality(v_reference_invoices)>1
     or pg_catalog.cardinality(v_org_customers)>1
     or pg_catalog.cardinality(v_name_customers)>1
     or (pg_catalog.cardinality(v_org_customers)=1
       and pg_catalog.cardinality(v_name_customers)=1
       and v_org_customers[1]<>v_name_customers[1]) then
    return query select null::text,'unmatched'::text,null::text,
      'Motstridiga uppgifter eller flera möjliga fakturor/kunder. Manuell kontroll krävs.'::text;
    return;
  end if;

  -- Exclude invoices that cannot be booked yet, overpayments and invoices
  -- already reserved by an open or approved matching proposal.
  with candidates as (
    select i.id,i.customer_id,(i.remaining_ore=v_bank.amount_ore) as exact_amount,
      (
        public.bank_match_has_reference(v_bank.reference,v_bank.message,i.ocr)
        or public.bank_match_has_reference(v_bank.reference,v_bank.message,i.invoice_number)
      ) as reference_match,
      public.bank_match_mentions_org(v_payer_text,c.org_number) as org_match,
      (pg_catalog.length(v_payer_name)>=6
        and v_payer_name=public.bank_match_normalize_name(c.name)) as name_match
    from public.invoices i
    join public.customers c on c.company_id=i.company_id and c.id=i.customer_id
    where i.company_id=p_company_id and i.total_ore>0
      and i.remaining_ore>=v_bank.amount_ore and i.remaining_ore>0
      and i.invoice_account='1510'
      and i.journal_number is not null
      and i.status<>'Väntar på bunt'
      and not exists (
        select 1 from public.automation_proposals a
        where a.company_id=i.company_id
          and a.proposal_type='bank-payment-match'
          and a.status in ('manual-review','ready-for-approval','approved')
          and a.suggestion_json->>'invoiceId'=i.id
      )
  )
  select
    coalesce(pg_catalog.array_agg(x.id order by x.id) filter (
      where x.reference_match
    ),array[]::text[]),
    coalesce(pg_catalog.array_agg(x.id order by x.id) filter (
      where x.org_match and x.exact_amount
    ),array[]::text[]),
    coalesce(pg_catalog.array_agg(x.id order by x.id) filter (
      where x.name_match and x.exact_amount
    ),array[]::text[])
  into v_eligible_references,v_eligible_orgs,v_eligible_names
  from candidates x;

  if pg_catalog.cardinality(v_reference_invoices)=1 then
    if not (v_reference_invoices[1]=any(v_eligible_references)) then
      return query select null::text,'unmatched'::text,null::text,
        'Fakturan i betalningsmeddelandet är inte öppen eller har redan en väntande betalning.'::text;
      return;
    end if;
    v_choice:=v_reference_invoices[1];
    v_kind:='reference';
  elsif pg_catalog.cardinality(v_eligible_orgs)=1 then
    v_choice:=v_eligible_orgs[1];
    v_kind:='organisation';
  elsif pg_catalog.cardinality(v_eligible_names)=1 then
    v_choice:=v_eligible_names[1];
    v_kind:='name';
  end if;

  if v_choice is null then
    return query select null::text,'unmatched'::text,null::text,
      'Ingen entydig träff på fakturanummer, OCR, organisationsnummer eller kundnamn och belopp.'::text;
    return;
  end if;

  select i.id,i.customer_id,i.invoice_number,i.remaining_ore,c.name as customer_name
  into v_invoice
  from public.invoices i
  join public.customers c on c.company_id=i.company_id and c.id=i.customer_id
  where i.company_id=p_company_id and i.id=v_choice;

  -- An exact invoice reference cannot override a contradictory named payer or
  -- organisation number, even when the amount is correct.
  if (pg_catalog.cardinality(v_org_customers)=1
        and v_org_customers[1]<>v_invoice.customer_id)
     or (pg_catalog.cardinality(v_name_customers)=1
        and v_name_customers[1]<>v_invoice.customer_id) then
    return query select null::text,'unmatched'::text,null::text,
      'Fakturanumret och betalarens identitet pekar på olika kunder.'::text;
    return;
  end if;

  if v_kind='reference' then
    v_confidence:=case when v_invoice.remaining_ore=v_bank.amount_ore
      then 1000000 else 950000 end;
    v_reason:=case when v_invoice.remaining_ore=v_bank.amount_ore
      then 'Exakt OCR/fakturanummer och belopp.'
      else 'Exakt OCR/fakturanummer, möjlig delbetalning.' end;
  elsif v_kind='organisation' then
    v_confidence:=960000;
    v_reason:='Organisationsnummer och exakt återstående fakturabelopp.';
  else
    v_confidence:=930000;
    v_reason:='Exakt kundnamn och exakt återstående fakturabelopp.';
  end if;

  v_evidence:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'kind',case when v_kind='reference' then 'payment-reference'
        else 'customer-identity' end,
      'label',case v_kind when 'reference' then 'OCR / fakturanummer'
        when 'organisation' then 'Organisationsnummer' else 'Kundnamn' end,
      'value',case when v_kind='organisation' then 'Matchar kundregistret'
        when v_kind='reference' then v_invoice.invoice_number
        else v_invoice.customer_name end,
      'sourceId',v_bank.id
    ),
    pg_catalog.jsonb_build_object(
      'kind','amount',
      'label',case when v_invoice.remaining_ore=v_bank.amount_ore
        then 'Exakt restbelopp' else 'Delbetalning' end,
      'value',v_bank.amount_ore::text,'sourceId',v_bank.id
    )
  );
  select * into v_saved from public.create_bank_match_proposal(
    p_company_id,v_bank.id,v_choice,v_confidence,
    (v_kind='reference' and v_invoice.remaining_ore=v_bank.amount_ore),
    false,v_reason,v_evidence
  );
  if v_saved.proposal_id is null
      or v_saved.status not in ('ready-for-approval','manual-review') then
    raise exception 'AUTO_BANK_MATCH_PROPOSAL_FAILED';
  end if;
  return query select v_saved.proposal_id,'proposal-created'::text,
    v_choice,v_reason;
end;
$$;

revoke all on function public.auto_match_imported_bank_payment(text,text) from public,anon;
grant execute on function public.auto_match_imported_bank_payment(text,text) to authenticated;

-- Preserve the existing API/return type while performing an atomic, idempotent
-- match attempt immediately after importing a new bank event.
create or replace function public.import_bank_payment(
  p_company_id text,p_external_id text,p_booking_date date,p_value_date date,
  p_amount_ore bigint,p_currency text,p_reference text,p_message text,
  p_payer_name text,p_payer_account text
)
returns table(bank_payment_id text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_existing public.bank_payments%rowtype;
  v_id text;
  v_status text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.company_memberships m
    where m.company_id=p_company_id and m.auth_user_id=v_uid
      and m.role in ('admin','accountant')
  ) then raise exception 'ACCESS_DENIED'; end if;
  if pg_catalog.btrim(coalesce(p_external_id,''))=''
     or pg_catalog.char_length(p_external_id)>180 then raise exception 'INVALID_BANK_ID'; end if;
  if p_booking_date is null or p_amount_ore is null or p_amount_ore<=0 then
    raise exception 'INVALID_BANK_AMOUNT_OR_DATE'; end if;
  if pg_catalog.upper(coalesce(p_currency,'SEK'))<>'SEK' then raise exception 'UNSUPPORTED_CURRENCY'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id||':bank-import:'||pg_catalog.btrim(p_external_id),0)
  );
  select * into v_existing from public.bank_payments b
  where b.company_id=p_company_id and b.external_id=pg_catalog.btrim(p_external_id);
  if found then
    if v_existing.booking_date<>p_booking_date
      or v_existing.value_date is distinct from p_value_date
      or v_existing.amount_ore<>p_amount_ore
      or coalesce(v_existing.reference,'')<>coalesce(pg_catalog.nullif(pg_catalog.btrim(p_reference),''),'')
      or coalesce(v_existing.message,'')<>coalesce(pg_catalog.nullif(pg_catalog.btrim(p_message),''),'')
      or coalesce(v_existing.payer_name,'')<>coalesce(pg_catalog.nullif(pg_catalog.btrim(p_payer_name),''),'')
      or coalesce(v_existing.payer_account,'')<>coalesce(pg_catalog.nullif(pg_catalog.btrim(p_payer_account),''),'')
    then raise exception 'BANK_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id,v_existing.status,true;
    return;
  end if;

  v_id:='bank_'||pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  insert into public.bank_payments(
    id,company_id,external_id,booking_date,value_date,amount_ore,currency,
    reference,message,payer_name,payer_account,status,created_by
  ) values (
    v_id,p_company_id,pg_catalog.btrim(p_external_id),p_booking_date,p_value_date,
    p_amount_ore,'SEK',pg_catalog.nullif(pg_catalog.btrim(p_reference),''),
    pg_catalog.nullif(pg_catalog.btrim(p_message),''),
    pg_catalog.nullif(pg_catalog.btrim(p_payer_name),''),
    pg_catalog.nullif(pg_catalog.btrim(p_payer_account),''),
    'unmatched',v_uid
  );

  perform public.auto_match_imported_bank_payment(p_company_id,v_id);
  select b.status into v_status from public.bank_payments b
  where b.company_id=p_company_id and b.id=v_id;
  return query select v_id,v_status,false;
end;
$$;

revoke all on function public.import_bank_payment(text,text,date,date,bigint,text,text,text,text,text)
  from public,anon;
grant execute on function public.import_bank_payment(text,text,date,date,bigint,text,text,text,text,text)
  to authenticated;
