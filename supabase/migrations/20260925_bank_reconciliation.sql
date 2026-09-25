-- Applied to Supabase UAT on 2026-09-25.
-- Bank reconciliation, automation proposals and approved customer-payment posting.

grant insert,update on public.invoices to authenticated;
grant insert,update on public.invoice_transactions to authenticated;

create table if not exists public.bank_payments (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  external_id text not null,
  booking_date date not null,
  value_date date,
  amount_ore bigint not null check (amount_ore > 0),
  currency text not null default 'SEK' check (currency='SEK'),
  reference text,
  message text,
  payer_name text,
  payer_account text,
  status text not null default 'unmatched' check (status in ('unmatched','proposal-created','reviewed','posted','ignored')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,external_id),
  unique(company_id,id)
);
alter table public.bank_payments enable row level security;
create index if not exists bank_payments_company_status_idx on public.bank_payments(company_id,status,booking_date desc);
create index if not exists bank_payments_created_by_idx on public.bank_payments(created_by);

create table if not exists public.automation_proposals (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  proposal_type text not null,
  source_id text not null,
  status text not null check (status in ('manual-review','ready-for-approval','approved','rejected','superseded')),
  confidence_ppm integer not null check (confidence_ppm between 0 and 1000000),
  deterministic boolean not null default false,
  ambiguous boolean not null default false,
  reason text not null,
  decision_reason text not null,
  evidence_json jsonb not null default '[]'::jsonb,
  suggestion_json jsonb not null default '{}'::jsonb,
  engine_json jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  idempotency_key text not null,
  unique(company_id,idempotency_key),
  unique(company_id,id)
);
alter table public.automation_proposals enable row level security;
create index if not exists automation_proposals_company_status_idx on public.automation_proposals(company_id,status,created_at desc);
create index if not exists automation_proposals_source_idx on public.automation_proposals(company_id,proposal_type,source_id);
create index if not exists automation_proposals_created_by_idx on public.automation_proposals(created_by);
create index if not exists automation_proposals_approved_by_idx on public.automation_proposals(approved_by);
create index if not exists automation_proposals_rejected_by_idx on public.automation_proposals(rejected_by);

create table if not exists public.customer_payment_executions (
  company_id text not null references public.companies(id) on delete cascade,
  proposal_id text not null,
  bank_payment_id text not null,
  invoice_id text not null,
  accounting_entry_id text not null,
  invoice_transaction_id text not null,
  amount_ore bigint not null check (amount_ore>0),
  posting_date date not null,
  invoice_status_before text,
  executed_by uuid not null references auth.users(id),
  executed_at timestamptz not null default now(),
  primary key(company_id,proposal_id),
  unique(company_id,bank_payment_id),
  unique(company_id,accounting_entry_id),
  unique(company_id,invoice_transaction_id),
  foreign key(company_id,proposal_id) references public.automation_proposals(company_id,id) on delete restrict,
  foreign key(company_id,bank_payment_id) references public.bank_payments(company_id,id) on delete restrict,
  foreign key(company_id,invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,accounting_entry_id) references public.journal_entries(company_id,id) on delete restrict
);
alter table public.customer_payment_executions enable row level security;
create index if not exists customer_payment_executions_invoice_idx on public.customer_payment_executions(company_id,invoice_id);
create index if not exists customer_payment_executions_executed_by_idx on public.customer_payment_executions(executed_by);

create policy "members read bank payments" on public.bank_payments for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=bank_payments.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert bank payments" on public.bank_payments for insert to authenticated
with check (created_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=bank_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update bank payments" on public.bank_payments for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=bank_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=bank_payments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create policy "members read automation proposals" on public.automation_proposals for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=automation_proposals.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert automation proposals" on public.automation_proposals for insert to authenticated
with check (created_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=automation_proposals.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update automation proposals" on public.automation_proposals for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=automation_proposals.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=automation_proposals.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create policy "members read customer payment executions" on public.customer_payment_executions for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_payment_executions.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert customer payment executions" on public.customer_payment_executions for insert to authenticated
with check (executed_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=customer_payment_executions.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

revoke all on public.bank_payments,public.automation_proposals,public.customer_payment_executions from anon;
grant select,insert,update on public.bank_payments,public.automation_proposals to authenticated;
grant select,insert on public.customer_payment_executions to authenticated;

create or replace function public.import_bank_payment(
  p_company_id text,p_external_id text,p_booking_date date,p_value_date date,p_amount_ore bigint,p_currency text,
  p_reference text,p_message text,p_payer_name text,p_payer_account text
)
returns table(bank_payment_id text,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_existing public.bank_payments%rowtype; v_id text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if btrim(coalesce(p_external_id,''))='' or char_length(p_external_id)>180 then raise exception 'INVALID_BANK_ID'; end if;
  if p_amount_ore<=0 then raise exception 'INVALID_BANK_AMOUNT'; end if;
  if upper(coalesce(p_currency,'SEK'))<>'SEK' then raise exception 'UNSUPPORTED_CURRENCY'; end if;
  select * into v_existing from public.bank_payments b where b.company_id=p_company_id and b.external_id=btrim(p_external_id);
  if found then
    if v_existing.booking_date<>p_booking_date or v_existing.value_date is distinct from p_value_date or v_existing.amount_ore<>p_amount_ore
       or coalesce(v_existing.reference,'')<>coalesce(nullif(btrim(p_reference),''),'')
       or coalesce(v_existing.message,'')<>coalesce(nullif(btrim(p_message),''),'')
       or coalesce(v_existing.payer_name,'')<>coalesce(nullif(btrim(p_payer_name),''),'')
       or coalesce(v_existing.payer_account,'')<>coalesce(nullif(btrim(p_payer_account),''),'') then raise exception 'BANK_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id,v_existing.status,true; return;
  end if;
  v_id:='bank_'||replace(gen_random_uuid()::text,'-','');
  insert into public.bank_payments(id,company_id,external_id,booking_date,value_date,amount_ore,currency,reference,message,payer_name,payer_account,status,created_by)
  values(v_id,p_company_id,btrim(p_external_id),p_booking_date,p_value_date,p_amount_ore,'SEK',nullif(btrim(p_reference),''),nullif(btrim(p_message),''),nullif(btrim(p_payer_name),''),nullif(btrim(p_payer_account),''),'unmatched',v_uid);
  return query select v_id,'unmatched'::text,false;
end;
$$;
revoke all on function public.import_bank_payment(text,text,date,date,bigint,text,text,text,text,text) from public,anon;
grant execute on function public.import_bank_payment(text,text,date,date,bigint,text,text,text,text,text) to authenticated;

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
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_confidence_ppm<0 or p_confidence_ppm>1000000 then raise exception 'INVALID_CONFIDENCE'; end if;
  if btrim(coalesce(p_reason,''))='' or char_length(p_reason)>2000 then raise exception 'MISSING_REASON'; end if;
  if jsonb_typeof(coalesce(p_evidence,'[]'::jsonb))<>'array' then raise exception 'INVALID_EVIDENCE'; end if;
  select * into v_bank from public.bank_payments b where b.company_id=p_company_id and b.id=p_bank_payment_id for update;
  if not found then raise exception 'BANK_PAYMENT_NOT_FOUND'; end if;
  if v_bank.status not in ('unmatched','proposal-created') then raise exception 'INVALID_BANK_PAYMENT_STATUS'; end if;
  select * into v_invoice from public.invoices i where i.company_id=p_company_id and i.id=p_target_invoice_id;
  if not found then raise exception 'TARGET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.total_ore<=0 or v_invoice.remaining_ore<=0 or v_invoice.invoice_account<>'1510' then raise exception 'TARGET_INVOICE_NOT_OPEN'; end if;
  if v_bank.amount_ore>v_invoice.remaining_ore then raise exception 'CUSTOMER_PAYMENT_AMOUNT_MISMATCH'; end if;
  select c.name into v_customer_name from public.customers c where c.company_id=p_company_id and c.id=v_invoice.customer_id;
  v_key:='bank-payment-match:'||v_bank.id||':v1';
  select * into v_existing from public.automation_proposals p where p.company_id=p_company_id and p.idempotency_key=v_key;
  if found then return query select v_existing.id,v_existing.status,true; return; end if;
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

create or replace function public.execute_customer_payment(p_company_id text,p_proposal_id text)
returns table(execution_proposal_id text,bank_payment_id text,invoice_id text,journal_number text,remaining_ore bigint,status text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid(); v_proposal public.automation_proposals%rowtype; v_bank public.bank_payments%rowtype; v_invoice public.invoices%rowtype;
  v_existing public.customer_payment_executions%rowtype; v_invoice_id text; v_bank_id text; v_amount bigint; v_booking_date date; v_external_id text;
  v_expected_remaining bigint; v_original_entry text; v_original_receivable bigint; v_period text; v_year text; v_seq bigint;
  v_entry_id text; v_tx_id text; v_remaining_after bigint; v_status_after text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_existing from public.customer_payment_executions e where e.company_id=p_company_id and e.proposal_id=p_proposal_id;
  if found then
    select i.remaining_ore,i.status into v_remaining_after,v_status_after from public.invoices i where i.company_id=p_company_id and i.id=v_existing.invoice_id;
    return query select v_existing.proposal_id,v_existing.bank_payment_id,v_existing.invoice_id,
      (select j.series||j.journal_number from public.journal_entries j where j.company_id=p_company_id and j.id=v_existing.accounting_entry_id),
      v_remaining_after,v_status_after,true;return;
  end if;
  select * into v_proposal from public.automation_proposals p where p.company_id=p_company_id and p.id=p_proposal_id for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.proposal_type<>'bank-payment-match' then raise exception 'PROPOSAL_EXECUTION_NOT_SUPPORTED'; end if;
  if v_proposal.status<>'approved' or v_proposal.approved_by is null or v_proposal.approved_at is null then raise exception 'PROPOSAL_NOT_APPROVED'; end if;
  v_bank_id=coalesce(v_proposal.suggestion_json->>'bankPaymentId',v_proposal.source_id);v_invoice_id=v_proposal.suggestion_json->>'invoiceId';
  v_amount=coalesce((v_proposal.suggestion_json->>'amountOre')::bigint,0);v_booking_date=(v_proposal.suggestion_json->>'bookingDate')::date;v_external_id=v_proposal.suggestion_json->>'externalId';
  if v_bank_id<>v_proposal.source_id or coalesce(v_invoice_id,'')='' then raise exception 'CUSTOMER_PAYMENT_SOURCE_MISMATCH'; end if;
  if coalesce(v_proposal.suggestion_json->>'bankAccount','1930')<>'1930' or coalesce(v_proposal.suggestion_json->>'receivableAccount','1510')<>'1510' then raise exception 'CUSTOMER_PAYMENT_CODING_NOT_SUPPORTED'; end if;
  select * into v_bank from public.bank_payments b where b.company_id=p_company_id and b.id=v_bank_id for update;
  if not found then raise exception 'BANK_PAYMENT_NOT_FOUND'; end if;
  if v_bank.status not in ('proposal-created','reviewed') then raise exception 'INVALID_BANK_PAYMENT_STATUS'; end if;
  if v_bank.booking_date<>v_booking_date or v_bank.external_id<>v_external_id or v_bank.amount_ore<>v_amount then raise exception 'CUSTOMER_PAYMENT_SOURCE_CHANGED'; end if;
  if exists(select 1 from public.customer_payment_executions e where e.company_id=p_company_id and e.bank_payment_id=v_bank.id) then raise exception 'BANK_PAYMENT_ALREADY_EXECUTED'; end if;
  if exists(select 1 from public.invoice_transactions t where t.company_id=p_company_id and t.bank_reference=v_bank.external_id and t.approved) then raise exception 'BANK_REFERENCE_ALREADY_POSTED'; end if;
  select * into v_invoice from public.invoices i where i.company_id=p_company_id and i.id=v_invoice_id for update;
  if not found then raise exception 'TARGET_INVOICE_NOT_FOUND'; end if;
  if v_invoice.total_ore<=0 or v_invoice.remaining_ore<=0 or v_invoice.invoice_account<>'1510' then raise exception 'TARGET_INVOICE_NOT_OPEN'; end if;
  if v_amount<=0 or v_amount<>v_bank.amount_ore or v_amount>v_invoice.remaining_ore then raise exception 'CUSTOMER_PAYMENT_AMOUNT_MISMATCH'; end if;
  select j.id into v_original_entry from public.journal_entries j where j.company_id=p_company_id and j.source_type='customer-invoice' and j.source_id=v_invoice.id order by j.created_at limit 1;
  if v_original_entry is null then raise exception 'CUSTOMER_RECEIVABLE_NOT_POSTED'; end if;
  select coalesce(sum(l.debit_ore-l.credit_ore),0) into v_original_receivable from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original_entry and l.account='1510';
  if v_original_receivable<>v_invoice.total_ore then raise exception 'CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'; end if;
  select v_invoice.total_ore+coalesce(sum(t.amount_ore),0) into v_expected_remaining from public.invoice_transactions t where t.company_id=p_company_id and t.invoice_id=v_invoice.id and t.approved;
  if v_expected_remaining<>v_invoice.remaining_ore then raise exception 'CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'; end if;
  v_period:=to_char(v_bank.booking_date,'YYYY-MM');v_year:=to_char(v_bank.booking_date,'YYYY');
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'A',v_year,1)
    on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_seq;
  v_entry_id='entry_'||replace(gen_random_uuid()::text,'-','');v_tx_id='transaction_'||replace(gen_random_uuid()::text,'-','');
  v_remaining_after=v_invoice.remaining_ore-v_amount;v_status_after=case when v_remaining_after=0 then 'Betald' else v_invoice.status end;
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
    values(v_entry_id,p_company_id,'A',v_seq::text,v_bank.booking_date,left('Kundinbetalning '||v_invoice.invoice_number,240),'customer-payment',v_bank.id,v_uid);
  insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore) values
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,1,'1930',left('Bankinbetalning '||v_bank.external_id,240),v_amount,0),
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry_id,2,'1510',left('Inbetalning kundfaktura '||v_invoice.invoice_number,240),0,v_amount);
  insert into public.invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,journal_number,amount_ore,approved,account,bank_reference)
    values(v_tx_id,p_company_id,v_invoice.id,'payment','Bank',v_bank.booking_date,v_bank.booking_date,'A'||v_seq,-v_amount,true,'1930',v_bank.external_id);
  update public.invoices i set remaining_ore=v_remaining_after,status=v_status_after,updated_at=now()
    where i.company_id=p_company_id and i.id=v_invoice.id and i.remaining_ore=v_invoice.remaining_ore and i.status=v_invoice.status and i.total_ore>0;
  if not found then raise exception 'CUSTOMER_PAYMENT_INVOICE_CONFLICT'; end if;
  update public.bank_payments b set status='posted',updated_at=now()
    where b.company_id=p_company_id and b.id=v_bank.id and b.status in ('proposal-created','reviewed');
  if not found then raise exception 'CUSTOMER_PAYMENT_BANK_CONFLICT'; end if;
  insert into public.customer_payment_executions(company_id,proposal_id,bank_payment_id,invoice_id,accounting_entry_id,invoice_transaction_id,amount_ore,posting_date,invoice_status_before,executed_by)
    values(p_company_id,v_proposal.id,v_bank.id,v_invoice.id,v_entry_id,v_tx_id,v_amount,v_bank.booking_date,v_invoice.status,v_uid);
  return query select v_proposal.id,v_bank.id,v_invoice.id,'A'||v_seq,v_remaining_after,v_status_after,false;
end;
$$;
revoke all on function public.execute_customer_payment(text,text) from public,anon;
grant execute on function public.execute_customer_payment(text,text) to authenticated;
