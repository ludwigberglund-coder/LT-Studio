-- Fix rejected bank matches getting stuck on the immutable v1 idempotency key.
-- Maintain prior proposal/rejection history while allowing a new round for an unmatched payment.
-- Also restore the controlled-financial-write opt-in lost in the latest decision RPC definition.
-- SECURITY INVOKER + explicit tenant/role checks are intentionally unchanged.
-- Source: existing GitHub migration definitions (20260925075745, 20260925083140).
-- Source-of-truth: GitHub. Apply to hosted environments only after PR merges.

create or replace function public.create_bank_match_proposal(
  p_company_id text,p_bank_payment_id text,p_target_invoice_id text,p_confidence_ppm integer,
  p_deterministic boolean,p_ambiguous boolean,p_reason text,p_evidence jsonb
)
returns table(proposal_id text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_bank public.bank_payments%rowtype; v_invoice public.invoices%rowtype; v_customer_name text;
  v_existing public.automation_proposals%rowtype; v_id text; v_status text; v_decision text; v_key text; v_suggestion jsonb;
  v_prefix text; v_revision bigint;
begin
  -- Opt in to the existing protected financial mutation boundary only inside this authorized RPC.
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_confidence_ppm<0 or p_confidence_ppm>1000000 then raise exception 'INVALID_CONFIDENCE'; end if;
  if btrim(coalesce(p_reason,''))='' or char_length(p_reason)>2000 then raise exception 'MISSING_REASON'; end if;
  if jsonb_typeof(coalesce(p_evidence,'[]'::jsonb))<>'array' then raise exception 'INVALID_EVIDENCE'; end if;
  select * into v_bank from public.bank_payments b where b.company_id=p_company_id and b.id=p_bank_payment_id for update;
  if not found then raise exception 'BANK_PAYMENT_NOT_FOUND'; end if;
  if v_bank.status not in ('unmatched','proposal-created') then raise exception 'INVALID_BANK_PAYMENT_STATUS'; end if;
  if v_bank.currency <> 'SEK' then raise exception 'UNSUPPORTED_CURRENCY'; end if;
  select * into v_invoice from public.invoices i where i.company_id=p_company_id and i.id=p_target_invoice_id;
  if not found then raise exception 'TARGET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.total_ore<=0 or v_invoice.remaining_ore<=0 or v_invoice.invoice_account<>'1510' then raise exception 'TARGET_INVOICE_NOT_OPEN'; end if;
  if v_bank.amount_ore>v_invoice.remaining_ore then raise exception 'CUSTOMER_PAYMENT_AMOUNT_MISMATCH'; end if;
  select c.name into v_customer_name from public.customers c where c.company_id=p_company_id and c.id=v_invoice.customer_id;
  -- The bank row is locked above, so only one active round can be created at a time.
  -- Rejected rounds remain immutable audit history. Only active rounds can be replayed.
  select * into v_existing
  from public.automation_proposals p
  where p.company_id=p_company_id
    and p.proposal_type='bank-payment-match'
    and p.source_id=v_bank.id
    and p.status in ('manual-review','ready-for-approval','approved')
  order by p.created_at desc,p.id desc
  limit 1;
  if found then
    if v_bank.status <> 'proposal-created' then
      raise exception 'BANK_PAYMENT_PROPOSAL_STATE_CONFLICT';
    end if;
    if v_existing.status='approved' then
      raise exception 'BANK_PAYMENT_PROPOSAL_STATE_CONFLICT';
    end if;
    if v_existing.suggestion_json->>'invoiceId' is distinct from p_target_invoice_id then
      raise exception 'BANK_PAYMENT_ALREADY_PENDING';
    end if;
    return query select v_existing.id,v_existing.status,true;
    return;
  end if;
  -- If the bank still says "proposal-created" there is no safe active round to reuse.
  if v_bank.status <> 'unmatched' then
    raise exception 'BANK_PAYMENT_PROPOSAL_STATE_CONFLICT';
  end if;

  -- Version idempotency per bank payment; v1/v2/... are unique and audit preserving.
  v_prefix:='bank-payment-match:'||v_bank.id||':v';
  select coalesce(max(substring(p.idempotency_key from char_length(v_prefix)+1)::bigint),0)+1
  into v_revision
  from public.automation_proposals p
  where p.company_id=p_company_id
    and p.proposal_type='bank-payment-match'
    and p.source_id=v_bank.id
    and left(p.idempotency_key,char_length(v_prefix))=v_prefix
    and substring(p.idempotency_key from char_length(v_prefix)+1) ~ '^[0-9]{1,12}
  if coalesce(p_ambiguous,false) then v_status:='manual-review';v_decision:='Underlaget ger flera möjliga tolkningar.';
  elsif coalesce(p_deterministic,false) and p_confidence_ppm=1000000 then v_status:='ready-for-approval';v_decision:='Deterministiska regler gav en entydig träff. En behörig person ska fortfarande godkänna åtgärden.';
  elsif p_confidence_ppm>=900000 then v_status:='ready-for-approval';v_decision:='Förslaget har hög säkerhet men kräver mänskligt godkännande.';
  else v_status:='manual-review';v_decision:='Säkerheten är för låg för godkännande utan manuell granskning.'; end if;
  v_suggestion=jsonb_build_object('action','match-customer-payment','bankPaymentId',v_bank.id,'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,
    'customerName',coalesce(v_customer_name,''),'amountOre',v_bank.amount_ore,'bookingDate',v_bank.booking_date,'externalId',v_bank.external_id,
    'bankAccount','1930','receivableAccount','1510','accountingLines',jsonb_build_array(
      jsonb_build_object('account','1930','label','Bankinbetalning','debitOre',v_bank.amount_ore,'creditOre',0),
      jsonb_build_object('account','1510','label','Kundfordringar','debitOre',0,'creditOre',v_bank.amount_ore)));
  v_id:='proposal_'||replace(gen_random_uuid()::text,'-','');
  insert into public.automation_proposals(id,company_id,proposal_type,source_id,status,confidence_ppm,deterministic,ambiguous,reason,decision_reason,evidence_json,suggestion_json,engine_json,created_by,idempotency_key)
  values(v_id,p_company_id,'bank-payment-match',v_bank.id,v_status,p_confidence_ppm,coalesce(p_deterministic,false),coalesce(p_ambiguous,false),
    btrim(p_reason),v_decision,coalesce(p_evidence,'[]'::jsonb),v_suggestion,jsonb_build_object('kind','rules','name','incoming-payment-matcher','version','2'),v_uid,v_key);
  update public.bank_payments b set status='proposal-created',updated_at=now() where b.company_id=p_company_id and b.id=v_bank.id and b.status='unmatched';
  return query select v_id,v_status,false;
end;
$$;
revoke all on function public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb) from public,anon;
grant execute on function public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb) to authenticated;

;
  v_key:=v_prefix||v_revision::text;
  if coalesce(p_ambiguous,false) then v_status:='manual-review';v_decision:='Underlaget ger flera möjliga tolkningar.';
  elsif coalesce(p_deterministic,false) and p_confidence_ppm=1000000 then v_status:='ready-for-approval';v_decision:='Deterministiska regler gav en entydig träff. En behörig person ska fortfarande godkänna åtgärden.';
  elsif p_confidence_ppm>=900000 then v_status:='ready-for-approval';v_decision:='Förslaget har hög säkerhet men kräver mänskligt godkännande.';
  else v_status:='manual-review';v_decision:='Säkerheten är för låg för godkännande utan manuell granskning.'; end if;
  v_suggestion=jsonb_build_object('action','match-customer-payment','bankPaymentId',v_bank.id,'invoiceId',v_invoice.id,'invoiceNumber',v_invoice.invoice_number,
    'customerName',coalesce(v_customer_name,''),'amountOre',v_bank.amount_ore,'bookingDate',v_bank.booking_date,'externalId',v_bank.external_id,
    'bankAccount','1930','receivableAccount','1510','accountingLines',jsonb_build_array(
      jsonb_build_object('account','1930','label','Bankinbetalning','debitOre',v_bank.amount_ore,'creditOre',0),
      jsonb_build_object('account','1510','label','Kundfordringar','debitOre',0,'creditOre',v_bank.amount_ore)));
  v_id:='proposal_'||replace(gen_random_uuid()::text,'-','');
  insert into public.automation_proposals(id,company_id,proposal_type,source_id,status,confidence_ppm,deterministic,ambiguous,reason,decision_reason,evidence_json,suggestion_json,engine_json,created_by,idempotency_key)
  values(v_id,p_company_id,'bank-payment-match',v_bank.id,v_status,p_confidence_ppm,coalesce(p_deterministic,false),coalesce(p_ambiguous,false),
    btrim(p_reason),v_decision,coalesce(p_evidence,'[]'::jsonb),v_suggestion,jsonb_build_object('kind','rules','name','incoming-payment-matcher','version','2'),v_uid,v_key);
  update public.bank_payments b set status='proposal-created',updated_at=now() where b.company_id=p_company_id and b.id=v_bank.id and b.status='unmatched';
  return query select v_id,v_status,false;
end;
$$;
revoke all on function public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb) from public,anon;
grant execute on function public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb) to authenticated;

create or replace function public.decide_automation_proposal(p_company_id text,p_proposal_id text,p_decision text,p_reason text default null)
returns table(proposal_id text,status text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_proposal public.automation_proposals%rowtype;
begin
  -- Earlier definition (20260925083140) accidentally removed this required guard.
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_proposal from public.automation_proposals p where p.company_id=p_company_id and p.id=p_proposal_id for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if p_decision='approve' then
    if v_proposal.status='approved' and v_proposal.approved_by=v_uid then return query select v_proposal.id,v_proposal.status;return;end if;
    if v_proposal.status not in ('manual-review','ready-for-approval') then raise exception 'INVALID_PROPOSAL_STATUS'; end if;
    update public.automation_proposals set status='approved',approved_by=v_uid,approved_at=now(),rejected_by=null,rejected_at=null,rejection_reason=null where company_id=p_company_id and id=p_proposal_id;
    if v_proposal.proposal_type='bank-payment-match' then update public.bank_payments as b set status='reviewed',updated_at=now() where b.company_id=p_company_id and b.id=v_proposal.source_id and b.status='proposal-created'; end if;
    return query select p_proposal_id,'approved'::text;
  elsif p_decision='reject' then
    if btrim(coalesce(p_reason,''))='' then raise exception 'MISSING_REJECTION_REASON'; end if;
    if v_proposal.status not in ('manual-review','ready-for-approval') then raise exception 'INVALID_PROPOSAL_STATUS'; end if;
    update public.automation_proposals set status='rejected',rejected_by=v_uid,rejected_at=now(),rejection_reason=left(btrim(p_reason),2000),approved_by=null,approved_at=null where company_id=p_company_id and id=p_proposal_id;
    if v_proposal.proposal_type='bank-payment-match' then update public.bank_payments as b set status='unmatched',updated_at=now() where b.company_id=p_company_id and b.id=v_proposal.source_id and b.status='proposal-created'; end if;
    return query select p_proposal_id,'rejected'::text;
  else raise exception 'INVALID_DECISION'; end if;
end;
$$;
revoke all on function public.decide_automation_proposal(text,text,text,text) from public,anon;
grant execute on function public.decide_automation_proposal(text,text,text,text) to authenticated;
