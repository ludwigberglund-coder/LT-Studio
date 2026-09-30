-- LT Studio financial batches: temporary review layer before definitive accounting
create table if not exists public.financial_batches(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  batch_number integer not null check(batch_number between 10000 and 99999),
  title text not null default 'Ny bunt' check(char_length(title) between 1 and 160),
  status text not null default 'draft' check(status in ('draft','ready','rejected','approved')),
  external_total_ore bigint,
  transaction_count integer not null default 0 check(transaction_count >= 0),
  total_debit_ore bigint not null default 0 check(total_debit_ore >= 0),
  total_credit_ore bigint not null default 0 check(total_credit_ore >= 0),
  control_state text not null default 'unchecked' check(control_state in ('unchecked','balanced','error')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  ready_by uuid references auth.users(id),
  ready_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  unique(company_id,batch_number),
  unique(company_id,id)
);
create index if not exists financial_batches_company_recent_idx on public.financial_batches(company_id,created_at desc,batch_number desc);
create index if not exists financial_batches_company_status_idx on public.financial_batches(company_id,status,updated_at desc);

create table if not exists public.financial_batch_transactions(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  batch_id text not null,
  transaction_number text not null,
  sequence_number integer not null check(sequence_number > 0),
  posting_date date not null,
  description text not null check(char_length(description) between 1 and 240),
  source_type text not null default 'manual',
  source_id text,
  reference text,
  external_amount_ore bigint,
  created_at timestamptz not null default now(),
  unique(company_id,batch_id,sequence_number),
  unique(company_id,transaction_number),
  unique(company_id,id),
  foreign key(company_id,batch_id) references public.financial_batches(company_id,id) on delete cascade
);
create index if not exists financial_batch_transactions_batch_idx on public.financial_batch_transactions(company_id,batch_id,sequence_number);

create table if not exists public.financial_batch_lines(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  transaction_id text not null,
  line_number integer not null check(line_number > 0),
  account text not null check(account ~ '^[0-9]{4}$'),
  description text,
  debit_ore bigint not null default 0 check(debit_ore >= 0),
  credit_ore bigint not null default 0 check(credit_ore >= 0),
  created_at timestamptz not null default now(),
  check((debit_ore > 0 and credit_ore = 0) or (credit_ore > 0 and debit_ore = 0)),
  unique(company_id,transaction_id,line_number),
  foreign key(company_id,transaction_id) references public.financial_batch_transactions(company_id,id) on delete cascade
);
create index if not exists financial_batch_lines_tx_idx on public.financial_batch_lines(company_id,transaction_id,line_number);

create table if not exists public.financial_batch_events(
  id bigint generated always as identity primary key,
  company_id text not null references public.companies(id) on delete cascade,
  batch_id text not null,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(company_id,batch_id) references public.financial_batches(company_id,id) on delete cascade
);
create index if not exists financial_batch_events_batch_idx on public.financial_batch_events(company_id,batch_id,created_at desc);

alter table public.financial_batches enable row level security;
alter table public.financial_batch_transactions enable row level security;
alter table public.financial_batch_lines enable row level security;
alter table public.financial_batch_events enable row level security;

drop policy if exists "members read financial batches" on public.financial_batches;
create policy "members read financial batches" on public.financial_batches for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=financial_batches.company_id and m.auth_user_id=(select auth.uid())));

drop policy if exists "members write financial batches" on public.financial_batches;
create policy "members write financial batches" on public.financial_batches for all to authenticated
using (current_setting('app.financial_batch_write',true)='1' and exists(select 1 from public.company_memberships m where m.company_id=financial_batches.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant','approver')))
with check (current_setting('app.financial_batch_write',true)='1' and exists(select 1 from public.company_memberships m where m.company_id=financial_batches.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant','approver')));

drop policy if exists "members read financial batch transactions" on public.financial_batch_transactions;
create policy "members read financial batch transactions" on public.financial_batch_transactions for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid())));

drop policy if exists "members write financial batch transactions" on public.financial_batch_transactions;
create policy "members write financial batch transactions" on public.financial_batch_transactions for all to authenticated
using (current_setting('app.financial_batch_write',true)='1' and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (current_setting('app.financial_batch_write',true)='1' and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_transactions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

drop policy if exists "members read financial batch lines" on public.financial_batch_lines;
create policy "members read financial batch lines" on public.financial_batch_lines for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid())));

drop policy if exists "members write financial batch lines" on public.financial_batch_lines;
create policy "members write financial batch lines" on public.financial_batch_lines for all to authenticated
using (current_setting('app.financial_batch_write',true)='1' and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (current_setting('app.financial_batch_write',true)='1' and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_lines.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

drop policy if exists "members read financial batch events" on public.financial_batch_events;
create policy "members read financial batch events" on public.financial_batch_events for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=financial_batch_events.company_id and m.auth_user_id=(select auth.uid())));

drop policy if exists "members write financial batch events" on public.financial_batch_events;
create policy "members write financial batch events" on public.financial_batch_events for insert to authenticated
with check (current_setting('app.financial_batch_write',true)='1' and actor_user_id=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=financial_batch_events.company_id and m.auth_user_id=(select auth.uid())));

revoke all on public.financial_batches,public.financial_batch_transactions,public.financial_batch_lines,public.financial_batch_events from anon;
grant select,insert,update,delete on public.financial_batches,public.financial_batch_transactions,public.financial_batch_lines to authenticated;
grant select,insert on public.financial_batch_events to authenticated;

create or replace function public.create_financial_batch(p_company_id text,p_title text default 'Ny bunt',p_external_total_ore bigint default null)
returns table(batch_id text,batch_number integer,status text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_no integer;v_id text;
begin
  perform set_config('app.financial_batch_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':financial-batches',0));
  select coalesce(max(b.batch_number),9999)+1 into v_no from public.financial_batches b where b.company_id=p_company_id;
  if v_no>99999 then raise exception 'BATCH_NUMBER_EXHAUSTED'; end if;
  v_id='batch_'||replace(gen_random_uuid()::text,'-','');
  insert into public.financial_batches(id,company_id,batch_number,title,external_total_ore,created_by,updated_by)
  values(v_id,p_company_id,v_no,left(coalesce(nullif(btrim(p_title),''),'Ny bunt'),160),p_external_total_ore,v_uid,v_uid);
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(p_company_id,v_id,v_uid,'BATCH_CREATED',jsonb_build_object('batchNumber',v_no));
  return query select v_id,v_no,'draft'::text;
end;
$$;
revoke all on function public.create_financial_batch(text,text,bigint) from public,anon;
grant execute on function public.create_financial_batch(text,text,bigint) to authenticated;

create or replace function public.save_financial_batch(
  p_company_id text,p_batch_id text,p_title text,p_external_total_ore bigint,p_transactions jsonb
)
returns table(batch_id text,batch_number integer,status text,transaction_count integer,total_debit_ore bigint,total_credit_ore bigint,control_state text)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;v_tx jsonb;v_line jsonb;v_seq int:=0;v_line_no int;v_tx_id text;v_tx_no text;
  v_td bigint:=0;v_tc bigint:=0;v_tx_d bigint;v_tx_c bigint;v_count int:=0;v_state text:='balanced';
begin
  perform set_config('app.financial_batch_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_batch from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then raise exception 'APPROVED_BATCH_LOCKED'; end if;
  if jsonb_typeof(coalesce(p_transactions,'[]'::jsonb))<>'array' then raise exception 'INVALID_TRANSACTIONS'; end if;

  delete from public.financial_batch_lines l using public.financial_batch_transactions t where t.company_id=p_company_id and t.batch_id=p_batch_id and l.company_id=t.company_id and l.transaction_id=t.id;
  delete from public.financial_batch_transactions t where t.company_id=p_company_id and t.batch_id=p_batch_id;

  for v_tx in select value from jsonb_array_elements(coalesce(p_transactions,'[]'::jsonb)) loop
    v_seq:=v_seq+1;v_line_no:=0;v_tx_d:=0;v_tx_c:=0;
    if coalesce(v_tx->>'postingDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_POSTING_DATE'; end if;
    if char_length(btrim(coalesce(v_tx->>'description','')))<1 then raise exception 'TRANSACTION_DESCRIPTION_REQUIRED'; end if;
    if jsonb_typeof(coalesce(v_tx->'lines','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(v_tx->'lines','[]'::jsonb))<2 then raise exception 'TRANSACTION_NEEDS_TWO_LINES'; end if;
    v_tx_id='btx_'||replace(gen_random_uuid()::text,'-','');v_tx_no=lpad(v_batch.batch_number::text,5,'0')||'-'||lpad(v_seq::text,3,'0');
    insert into public.financial_batch_transactions(id,company_id,batch_id,transaction_number,sequence_number,posting_date,description,source_type,source_id,reference,external_amount_ore)
    values(v_tx_id,p_company_id,p_batch_id,v_tx_no,v_seq,(v_tx->>'postingDate')::date,left(v_tx->>'description',240),coalesce(nullif(v_tx->>'sourceType',''),'manual'),nullif(v_tx->>'sourceId',''),nullif(v_tx->>'reference',''),nullif(v_tx->>'externalAmountOre','')::bigint);
    for v_line in select value from jsonb_array_elements(v_tx->'lines') loop
      v_line_no:=v_line_no+1;
      if coalesce(v_line->>'account','') !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
      if coalesce((v_line->>'debitOre')::bigint,0)<0 or coalesce((v_line->>'creditOre')::bigint,0)<0 then raise exception 'NEGATIVE_BOOKING_AMOUNT'; end if;
      if not ((coalesce((v_line->>'debitOre')::bigint,0)>0 and coalesce((v_line->>'creditOre')::bigint,0)=0) or (coalesce((v_line->>'creditOre')::bigint,0)>0 and coalesce((v_line->>'debitOre')::bigint,0)=0)) then raise exception 'INVALID_BOOKING_LINE'; end if;
      v_tx_d:=v_tx_d+coalesce((v_line->>'debitOre')::bigint,0);v_tx_c:=v_tx_c+coalesce((v_line->>'creditOre')::bigint,0);
      insert into public.financial_batch_lines(id,company_id,transaction_id,line_number,account,description,debit_ore,credit_ore)
      values('bline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_tx_id,v_line_no,v_line->>'account',left(coalesce(v_line->>'description',''),240),coalesce((v_line->>'debitOre')::bigint,0),coalesce((v_line->>'creditOre')::bigint,0));
    end loop;
    if v_tx_d<>v_tx_c or v_tx_d<=0 then v_state:='error'; end if;
    v_td:=v_td+v_tx_d;v_tc:=v_tc+v_tx_c;v_count:=v_count+1;
  end loop;

  update public.financial_batches b
  set title=left(coalesce(nullif(btrim(p_title),''),b.title),160),external_total_ore=p_external_total_ore,transaction_count=v_count,total_debit_ore=v_td,total_credit_ore=v_tc,
      control_state=case when v_count=0 then 'unchecked' when v_state='balanced' and v_td=v_tc then 'balanced' else 'error' end,
      status='draft',ready_by=null,ready_at=null,updated_by=v_uid,updated_at=now()
  where b.company_id=p_company_id and b.id=p_batch_id;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type,details)
  values(p_company_id,p_batch_id,v_uid,'BATCH_SAVED',jsonb_build_object('transactions',v_count,'debitOre',v_td,'creditOre',v_tc));
  return query select b.id,b.batch_number,b.status,b.transaction_count,b.total_debit_ore,b.total_credit_ore,b.control_state from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id;
end;
$$;
revoke all on function public.save_financial_batch(text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.save_financial_batch(text,text,text,bigint,jsonb) to authenticated;

create or replace function public.mark_financial_batch_ready(p_company_id text,p_batch_id text)
returns table(batch_id text,status text,control_state text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;
begin
  perform set_config('app.financial_batch_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_batch from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then raise exception 'APPROVED_BATCH_LOCKED'; end if;
  if v_batch.transaction_count<1 or v_batch.control_state<>'balanced' or v_batch.total_debit_ore<>v_batch.total_credit_ore then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_batch.external_total_ore is not null and v_batch.external_total_ore<>v_batch.total_debit_ore then raise exception 'EXTERNAL_TOTAL_MISMATCH'; end if;
  if exists(select 1 from public.financial_batch_transactions t join public.financial_batch_lines l on l.company_id=t.company_id and l.transaction_id=t.id
            where t.company_id=p_company_id and t.batch_id=p_batch_id group by t.id having sum(l.debit_ore)<>sum(l.credit_ore) or sum(l.debit_ore)<=0) then raise exception 'TRANSACTION_NOT_BALANCED'; end if;
  if exists(select 1 from public.financial_batch_transactions t join public.accounting_periods ap on ap.company_id=t.company_id and ap.period=to_char(t.posting_date,'YYYY-MM') and ap.status='locked'
            where t.company_id=p_company_id and t.batch_id=p_batch_id) then raise exception 'PERIOD_LOCKED'; end if;
  update public.financial_batches b set status='ready',ready_by=v_uid,ready_at=now(),updated_by=v_uid,updated_at=now() where b.company_id=p_company_id and b.id=p_batch_id;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type) values(p_company_id,p_batch_id,v_uid,'BATCH_READY');
  return query select b.id,b.status,b.control_state from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id;
end;
$$;
revoke all on function public.mark_financial_batch_ready(text,text) from public,anon;
grant execute on function public.mark_financial_batch_ready(text,text) to authenticated;

create or replace function public.reopen_financial_batch(p_company_id text,p_batch_id text)
returns table(batch_id text,status text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_status text;
begin
  perform set_config('app.financial_batch_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select b.status into v_status from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_status='approved' then raise exception 'APPROVED_BATCH_LOCKED'; end if;
  update public.financial_batches b set status='draft',ready_by=null,ready_at=null,updated_by=v_uid,updated_at=now() where b.company_id=p_company_id and b.id=p_batch_id;
  insert into public.financial_batch_events(company_id,batch_id,actor_user_id,event_type) values(p_company_id,p_batch_id,v_uid,'BATCH_REOPENED');
  return query select b.id,b.status from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id;
end;
$$;
revoke all on function public.reopen_financial_batch(text,text) from public,anon;
grant execute on function public.reopen_financial_batch(text,text) to authenticated;

create or replace function public.approve_financial_batch(p_company_id text,p_batch_id text)
returns table(batch_id text,batch_number integer,status text,posted_entries integer)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_batch public.financial_batches%rowtype;v_tx record;v_line record;v_year text;v_seq bigint;v_entry text;v_posted int:=0;
begin
  perform set_config('app.financial_batch_write','1',true);
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','approver')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_batch from public.financial_batches b where b.company_id=p_company_id and b.id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status='approved' then return query select v_batch.id,v_batch.batch_number,v_batch.status,0;return; end if;
  if v_batch.status<>'ready' then raise exception 'BATCH_NOT_READY'; end if;
  if v_batch.transaction_count<1 or v_batch.control_state<>'balanced' or v_batch.total_debit_ore<>v_batch.total_credit_ore then raise exception 'BATCH_NOT_BALANCED'; end if;
  if v_batch.external_total_ore is not null and v_batch.external_total_ore<>v_batch.total_debit_ore then raise exception 'EXTERNAL_TOTAL_MISMATCH'; end if;

  for v_tx in select * from public.financial_batch_transactions t where t.company_id=p_company_id and t.batch_id=p_batch_id order by t.sequence_number loop
    if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=to_char(v_tx.posting_date,'YYYY-MM') and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
    if (select coalesce(sum(l.debit_ore),0) from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id)
       <> (select coalesce(sum(l.credit_ore),0) from public.financial_batch_lines l where l.company_id=p_company_id and l.transaction_id=v_tx.id) then raise exception 'TRANSACTION_NOT_BALANCED'; end if;
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
