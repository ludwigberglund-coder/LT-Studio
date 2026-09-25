-- Secure audit-event write path for financial batch approval.
-- The browser role may append audit events only from a controlled AAL2 backend flow.
-- Existing audit rows remain immutable for authenticated users.

revoke all on public.audit_events from anon;
revoke update,delete,truncate,trigger,references on public.audit_events from authenticated;
grant select,insert on public.audit_events to authenticated;

drop policy if exists "controlled authenticated audit inserts" on public.audit_events;
create policy "controlled authenticated audit inserts"
on public.audit_events
as restrictive
for insert
to authenticated
with check (
  current_setting('app.audit_event_write',true)='1'
  and actor_user_id=(select auth.uid())
  and company_id is not null
  and exists(
    select 1
    from public.company_memberships m
    where m.company_id=audit_events.company_id
      and m.auth_user_id=(select auth.uid())
      and m.role in ('admin','accountant','approver')
  )
);

-- Allow a user to approve a financial batch they created or prepared.
-- Self-approval remains fully traceable in the batch event log and audit log.
create or replace function public.approve_financial_batch(p_company_id text,p_batch_id text)
returns table(batch_id text,batch_number integer,status text,posted_entries integer)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;v_tx record;v_line record;v_year text;v_seq bigint;v_entry text;v_posted int:=0;v_tx_total bigint;v_self_approval boolean:=false;
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  perform set_config('app.audit_event_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(
    select 1 from public.company_memberships m
    where m.company_id=p_company_id
      and m.auth_user_id=v_uid
      and m.role in ('admin','accountant','approver')
  ) then raise exception 'ACCESS_DENIED'; end if;

  select * into v_batch
  from public.financial_batches b
  where b.company_id=p_company_id and b.id=p_batch_id
  for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then
    return query select v_batch.id,v_batch.batch_number,v_batch.status,0;
    return;
  end if;
  if v_batch.status<>'ready' then raise exception 'BATCH_NOT_READY'; end if;
  if v_batch.transaction_count<1 or v_batch.control_state<>'balanced' or v_batch.total_debit_ore<>v_batch.total_credit_ore then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_batch.external_total_ore is not null and v_batch.external_total_ore<>v_batch.total_debit_ore then raise exception 'EXTERNAL_TOTAL_MISMATCH'; end if;

  v_self_approval:=v_batch.created_by=v_uid or v_batch.updated_by=v_uid or v_batch.ready_by=v_uid;

  for v_tx in
    select * from public.financial_batch_transactions t
    where t.company_id=p_company_id and t.batch_id=p_batch_id
    order by t.sequence_number
  loop
    if exists(
      select 1 from public.accounting_periods ap
      where ap.company_id=p_company_id
        and ap.period=to_char(v_tx.posting_date,'YYYY-MM')
        and ap.status='locked'
    ) then raise exception 'PERIOD_LOCKED'; end if;

    select coalesce(sum(l.debit_ore),0) into v_tx_total
    from public.financial_batch_lines l
    where l.company_id=p_company_id and l.transaction_id=v_tx.id;

    if v_tx_total<>(
      select coalesce(sum(l.credit_ore),0)
      from public.financial_batch_lines l
      where l.company_id=p_company_id and l.transaction_id=v_tx.id
    ) or v_tx_total<=0 then raise exception 'TRANSACTION_NOT_BALANCED'; end if;

    if v_tx.external_amount_ore is not null and abs(v_tx.external_amount_ore)<>v_tx_total then raise exception 'TRANSACTION_EXTERNAL_TOTAL_MISMATCH'; end if;

    v_year=to_char(v_tx.posting_date,'YYYY');
    perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
    insert into public.accounting_sequences(company_id,series,fiscal_year,last_number)
    values(p_company_id,'A',v_year,1)
    on conflict(company_id,series,fiscal_year)
    do update set last_number=public.accounting_sequences.last_number+1
    returning last_number into v_seq;

    v_entry='entry_'||replace(gen_random_uuid()::text,'-','');
    insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
    values(v_entry,p_company_id,'A',v_seq::text,v_tx.posting_date,v_tx.description,'financial-batch',v_tx.id,v_uid);

    for v_line in
      select * from public.financial_batch_lines l
      where l.company_id=p_company_id and l.transaction_id=v_tx.id
      order by l.line_number
    loop
      insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
      values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry,v_line.line_number,v_line.account,v_line.description,v_line.debit_ore,v_line.credit_ore);
    end loop;
    v_posted:=v_posted+1;
  end loop;

  update public.financial_batches b
  set status='approved',approved_by=v_uid,approved_at=now(),updated_by=v_uid,updated_at=now()
  where b.company_id=p_company_id and b.id=p_batch_id;

  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(
    p_company_id,p_batch_id,v_uid,'BATCH_APPROVED',
    jsonb_build_object('postedEntries',v_posted,'selfApproval',v_self_approval)
  );

  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(
    p_company_id,v_uid,'FINANCIAL_BATCH_APPROVED','financial_batch',p_batch_id,
    jsonb_build_object('batchNumber',v_batch.batch_number,'postedEntries',v_posted,'selfApproval',v_self_approval)
  );

  return query
  select b.id,b.batch_number,b.status,v_posted
  from public.financial_batches b
  where b.company_id=p_company_id and b.id=p_batch_id;
end;
$$;

revoke all on function public.approve_financial_batch(text,text) from public,anon;
grant execute on function public.approve_financial_batch(text,text) to authenticated;

