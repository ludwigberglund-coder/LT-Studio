-- Recovered from live Supabase migration history (20260925083140 qualify_status_output_conflicts).
-- GitHub is source of truth for rebuilds.

create or replace function public.decide_inventory_adjustment(
  p_company_id text,p_adjustment_id text,p_decision text
)
returns table(adjustment_id text,status text,movement_id text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_adj public.inventory_adjustments%rowtype;v_current bigint;v_movement_id text;
begin
  perform set_config('app.controlled_inventory_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_adj from public.inventory_adjustments a where a.company_id=p_company_id and a.id=p_adjustment_id for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if v_adj.status<>'pending' then
    if p_decision='approve' and v_adj.status='approved' and v_adj.approved_by=v_uid then
      select m.id into v_movement_id from public.inventory_movements m where m.company_id=p_company_id and m.reference_type='inventory-adjustment' and m.reference_id=v_adj.id order by m.created_at limit 1;
      return query select v_adj.id,v_adj.status,v_movement_id;return;
    elsif p_decision='reject' and v_adj.status='rejected' and v_adj.rejected_by=v_uid then
      return query select v_adj.id,v_adj.status,null::text;return;
    else
      raise exception 'ADJUSTMENT_ALREADY_DECIDED';
    end if;
  end if;
  if p_decision='approve' then
    if v_adj.counted_by=v_uid then raise exception 'SEPARATION_OF_DUTIES_FAILED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id||':inventory:'||v_adj.item_id,0));
    select coalesce(sum(m.quantity_milli),0) into v_current from public.inventory_movements m where m.company_id=p_company_id and m.item_id=v_adj.item_id;
    if v_current<>v_adj.current_quantity_milli then raise exception 'STOCK_CHANGED_SINCE_COUNT'; end if;
    if v_current+v_adj.difference_milli<0 then raise exception 'NEGATIVE_STOCK'; end if;
    v_movement_id='imov_'||replace(gen_random_uuid()::text,'-','');
    insert into public.inventory_movements(id,company_id,item_id,movement_date,type,quantity_milli,reference_type,reference_id,note,actor_id,request_id)
    values(v_movement_id,p_company_id,v_adj.item_id,v_adj.adjustment_date,'adjustment',v_adj.difference_milli,'inventory-adjustment',v_adj.id,v_adj.reason,v_uid,'inventory-adjustment-'||v_adj.id);
    update public.inventory_adjustments as a set status='approved',approved_by=v_uid,approved_at=now() where a.company_id=p_company_id and a.id=v_adj.id and a.status='pending';
    return query select v_adj.id,'approved'::text,v_movement_id;return;
  elsif p_decision='reject' then
    update public.inventory_adjustments as a set status='rejected',rejected_by=v_uid,rejected_at=now() where a.company_id=p_company_id and a.id=v_adj.id and a.status='pending';
    return query select v_adj.id,'rejected'::text,null::text;return;
  else
    raise exception 'INVALID_DECISION';
  end if;
end;
$$;
revoke all on function public.decide_inventory_adjustment(text,text,text) from public,anon;
grant execute on function public.decide_inventory_adjustment(text,text,text) to authenticated;

create or replace function public.decide_automation_proposal(p_company_id text,p_proposal_id text,p_decision text,p_reason text default null)
returns table(proposal_id text,status text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_proposal public.automation_proposals%rowtype;
begin
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

create or replace function public.post_payroll_run(p_company_id text,p_payroll_run_id text)
returns table(payroll_run_id text,journal_number text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_run public.payroll_runs%rowtype;v_period text;v_year text;v_seq bigint;v_entry_id text;v_line jsonb;v_line_no int:=0;v_debit numeric:=0;v_credit numeric:=0;
begin
  perform set_config('app.controlled_payroll_write','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_run from public.payroll_runs r where r.company_id=p_company_id and r.id=p_payroll_run_id for update;
  if not found then raise exception 'PAYROLL_RUN_NOT_FOUND'; end if;
  if v_run.status='posted' then
    if v_run.posted_by=v_uid and v_run.accounting_entry_id is not null
       and exists(select 1 from public.journal_entries j where j.company_id=p_company_id and j.id=v_run.accounting_entry_id and j.source_type='payroll-run' and j.source_id=v_run.id) then
      return query select v_run.id,(select j.series||j.journal_number from public.journal_entries j where j.company_id=p_company_id and j.id=v_run.accounting_entry_id),v_run.status,true;return;
    end if;
    raise exception 'PAYROLL_ALREADY_POSTED';
  end if;
  if v_run.status<>'validated' then raise exception 'INVALID_PAYROLL_STATUS'; end if;
  for v_line in select value from jsonb_array_elements(v_run.lines_json) loop
    if (v_line->>'account') !~ '^[0-9]{4}$' then raise exception 'INVALID_PAYROLL_ACCOUNT'; end if;
    v_debit:=v_debit+coalesce((v_line->>'debitOre')::numeric,0);v_credit:=v_credit+coalesce((v_line->>'creditOre')::numeric,0);
  end loop;
  if v_debit<>v_credit or v_debit<=0 then raise exception 'UNBALANCED_PAYROLL_JOURNAL'; end if;
  if encode(digest(convert_to(v_run.lines_json::text,'UTF8'),'sha256'),'hex')<>v_run.journal_sha256 then raise exception 'PAYROLL_POSTING_INTEGRITY_ERROR'; end if;
  v_period:=to_char(v_run.pay_date,'YYYY-MM');v_year:=to_char(v_run.pay_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  if exists(select 1 from public.journal_entries j where j.company_id=p_company_id and j.source_type='payroll-run' and j.source_id=v_run.id) then raise exception 'PAYROLL_ALREADY_POSTED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':L:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'L',v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_entry_id:='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry_id,p_company_id,'L',v_seq::text,v_run.pay_date,left('Lönejournal '||v_run.period||' – '||v_run.source_name,240),'payroll-run',v_run.id,v_uid);
  for v_line in select value from jsonb_array_elements(v_run.lines_json) loop
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
    values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,v_line_no,v_line->>'account',left(coalesce(v_line->>'text',''),240),
      coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
  end loop;
  update public.payroll_runs as r set status='posted',posted_by=v_uid,posted_at=now(),accounting_entry_id=v_entry_id
  where r.company_id=p_company_id and r.id=v_run.id and r.status='validated';
  if not found then raise exception 'PAYROLL_POSTING_CONFLICT'; end if;
  return query select v_run.id,'L'||v_seq,'posted'::text,false;
end;
$$;
revoke all on function public.post_payroll_run(text,text) from public,anon;
grant execute on function public.post_payroll_run(text,text) to authenticated;

;
