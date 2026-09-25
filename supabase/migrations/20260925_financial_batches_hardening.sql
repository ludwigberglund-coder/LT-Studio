-- Hardening for financial batches after advisor review.
create index if not exists financial_batches_created_by_idx on public.financial_batches(created_by);
create index if not exists financial_batches_updated_by_idx on public.financial_batches(updated_by);
create index if not exists financial_batches_ready_by_idx on public.financial_batches(ready_by);
create index if not exists financial_batches_approved_by_idx on public.financial_batches(approved_by);
create index if not exists financial_batch_events_actor_idx on public.financial_batch_events(actor_user_id);

drop policy if exists "members write financial batches" on public.financial_batches;
drop policy if exists "members insert financial batches" on public.financial_batches;
drop policy if exists "members update financial batches" on public.financial_batches;
drop policy if exists "members delete financial batches" on public.financial_batches;
create policy "members insert financial batches" on public.financial_batches for insert to authenticated
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batches.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);
create policy "members update financial batches" on public.financial_batches for update to authenticated
using (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batches.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant','approver'))
)
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batches.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant','approver'))
);

drop policy if exists "members write financial batch transactions" on public.financial_batch_transactions;
drop policy if exists "members insert financial batch transactions" on public.financial_batch_transactions;
drop policy if exists "members update financial batch transactions" on public.financial_batch_transactions;
drop policy if exists "members delete financial batch transactions" on public.financial_batch_transactions;
create policy "members insert financial batch transactions" on public.financial_batch_transactions for insert to authenticated
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);
create policy "members update financial batch transactions" on public.financial_batch_transactions for update to authenticated
using (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
)
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);
create policy "members delete financial batch transactions" on public.financial_batch_transactions for delete to authenticated
using (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);

drop policy if exists "members write financial batch lines" on public.financial_batch_lines;
drop policy if exists "members insert financial batch lines" on public.financial_batch_lines;
drop policy if exists "members update financial batch lines" on public.financial_batch_lines;
drop policy if exists "members delete financial batch lines" on public.financial_batch_lines;
create policy "members insert financial batch lines" on public.financial_batch_lines for insert to authenticated
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);
create policy "members update financial batch lines" on public.financial_batch_lines for update to authenticated
using (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
)
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);
create policy "members delete financial batch lines" on public.financial_batch_lines for delete to authenticated
using (
  (select current_setting('app.financial_batch_write',true))='1'
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant'))
);

drop policy if exists "members write financial batch events" on public.financial_batch_events;
create policy "members write financial batch events" on public.financial_batch_events for insert to authenticated
with check (
  (select current_setting('app.financial_batch_write',true))='1'
  and actor_user_id=(select auth.uid())
  and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_events.company_id and m.auth_user_id=(select auth.uid()))
);

revoke delete on public.financial_batches from authenticated;

create or replace function private.audit_financial_batch_transaction()
returns trigger
language plpgsql security invoker set search_path=''
as $$
declare v_row jsonb;v_batch text;v_company text;v_event text;
begin
  if tg_op='INSERT' then v_row=to_jsonb(new);v_batch=new.batch_id;v_company=new.company_id;v_event='TRANSACTION_CREATED';
  elsif tg_op='UPDATE' then v_row=jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new));v_batch=new.batch_id;v_company=new.company_id;v_event='TRANSACTION_UPDATED';
  else v_row=to_jsonb(old);v_batch=old.batch_id;v_company=old.company_id;v_event='TRANSACTION_DELETED'; end if;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(v_company,v_batch,(select auth.uid()),v_event,v_row);
  return coalesce(new,old);
end;
$$;

create or replace function private.audit_financial_batch_line()
returns trigger
language plpgsql security invoker set search_path=''
as $$
declare v_row jsonb;v_tx text;v_company text;v_batch text;v_event text;
begin
  if tg_op='INSERT' then v_row=to_jsonb(new);v_tx=new.transaction_id;v_company=new.company_id;v_event='LINE_CREATED';
  elsif tg_op='UPDATE' then v_row=jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new));v_tx=new.transaction_id;v_company=new.company_id;v_event='LINE_UPDATED';
  else v_row=to_jsonb(old);v_tx=old.transaction_id;v_company=old.company_id;v_event='LINE_DELETED'; end if;
  select t.batch_id into v_batch from public.financial_batch_transactions t where t.company_id=v_company and t.id=v_tx;
  if v_batch is not null then
    insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
    values(v_company,v_batch,(select auth.uid()),v_event,v_row);
  end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists audit_financial_batch_transaction on public.financial_batch_transactions;
create trigger audit_financial_batch_transaction
after insert or update or delete on public.financial_batch_transactions
for each row execute function private.audit_financial_batch_transaction();

drop trigger if exists audit_financial_batch_line on public.financial_batch_lines;
create trigger audit_financial_batch_line
after insert or update or delete on public.financial_batch_lines
for each row execute function private.audit_financial_batch_line();

create or replace function public.reject_financial_batch(p_company_id text,p_batch_id text,p_reason text)
returns table(batch_id text,status text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;v_reason text:=btrim(coalesce(p_reason,''));
begin
  perform set_config('app.financial_batch_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_reason)<5 or char_length(v_reason)>500 then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','approver')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_batch from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status<>'ready' then raise exception 'BATCH_NOT_READY'; end if;
  if v_batch.created_by=v_uid or v_batch.updated_by=v_uid or v_batch.ready_by=v_uid then raise exception 'SEPARATION_OF_DUTIES_FAILED'; end if;
  update public.financial_batches b set status='rejected',updated_by=v_uid,updated_at=now() where b.company_id=p_company_id and b.id=p_batch_id;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(p_company_id,p_batch_id,v_uid,'BATCH_REJECTED',jsonb_build_object('reason',v_reason));
  return query select b.id,b.status from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id;
end;
$$;
revoke all on function public.reject_financial_batch(text,text,text) from public,anon;
grant execute on function public.reject_financial_batch(text,text,text) to authenticated;

create or replace function public.approve_financial_batch(p_company_id text,p_batch_id text)
returns table(batch_id text,batch_number integer,status text,posted_entries integer)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;v_tx record;v_line record;v_year text;v_seq bigint;v_entry text;v_posted int:=0;v_tx_total bigint;
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','approver')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_batch from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then return query select v_batch.id,v_batch.batch_number,v_batch.status,0;return; end if;
  if v_batch.status<>'ready' then raise exception 'BATCH_NOT_READY'; end if;
  if v_batch.created_by=v_uid or v_batch.updated_by=v_uid or v_batch.ready_by=v_uid then raise exception 'SEPARATION_OF_DUTIES_FAILED'; end if;
  if v_batch.transaction_count<1 or v_batch.control_state<>'balanced' or v_batch.total_debit_ore<>v_batch.total_credit_ore then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_batch.external_total_ore is not null and v_batch.external_total_ore<>v_batch.total_debit_ore then raise exception 'EXTERNAL_TOTAL_MISMATCH'; end if;

  for v_tx in select * from public.financial_batch_transactions t where t.company_id=p_company_id and t.batch_id=p_batch_id order by t.sequence_number loop
    if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=to_char(v_tx.posting_date,'YYYY-MM') and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
    select coalesce(sum(l.debit_ore),0) into v_tx_total from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id;
    if v_tx_total<>(select coalesce(sum(l.credit_ore),0) from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id) or v_tx_total<=0 then raise exception 'TRANSACTION_NOT_BALANCED'; end if;
    if v_tx.external_amount_ore is not null and abs(v_tx.external_amount_ore)<>v_tx_total then raise exception 'TRANSACTION_EXTERNAL_TOTAL_MISMATCH'; end if;
    v_year=to_char(v_tx.posting_date,'YYYY');
    perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
    insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'A',v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
    v_entry='entry_'||replace(gen_random_uuid()::text,'-','');
    insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
    values(v_entry,p_company_id,'A',v_seq::text,v_tx.posting_date,v_tx.description,'financial-batch',v_tx.id,v_uid);
    for v_line in select * from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id order by l.line_number loop
      insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore)
      values('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry,v_line.line_number,v_line.account,v_line.description,v_line.debit_ore,v_line.credit_ore);
    end loop;
    v_posted:=v_posted+1;
  end loop;
  update public.financial_batches b set status='approved',approved_by=v_uid,approved_at=now(),updated_by=v_uid,updated_at=now() where b.company_id=p_company_id and b.id=p_batch_id;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(p_company_id,p_batch_id,v_uid,'BATCH_APPROVED',jsonb_build_object('postedEntries',v_posted));
  insert into public.audit_events(company_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(p_company_id,v_uid,'FINANCIAL_BATCH_APPROVED','financial_batch',p_batch_id,jsonb_build_object('batchNumber',v_batch.batch_number,'postedEntries',v_posted));
  return query select b.id,b.batch_number,b.status,v_posted from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id;
end;
$$;
revoke all on function public.approve_financial_batch(text,text) from public,anon;
grant execute on function public.approve_financial_batch(text,text) to authenticated;
