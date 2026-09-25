-- Applied to Supabase UAT on 2026-09-25.
-- Safe reclassification of a fully allocated customer payment to another exact-open invoice.

create table if not exists public.customer_payment_reclassifications(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  bank_payment_id text not null,
  original_proposal_id text not null,
  sequence integer not null check(sequence>0),
  source_invoice_id text not null,
  target_invoice_id text not null,
  source_status_before_payment text not null,
  target_status_before_payment text not null,
  original_payment_transaction_id text not null,
  source_reversal_transaction_id text not null,
  target_payment_transaction_id text not null,
  accounting_entry_id text not null,
  amount_ore bigint not null check(amount_ore>0),
  correction_date date not null,
  reason text not null check(char_length(reason) between 5 and 500),
  request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  corrected_by uuid not null references auth.users(id),
  corrected_at timestamptz not null default now(),
  unique(company_id,bank_payment_id,sequence),
  unique(company_id,request_id),
  unique(company_id,accounting_entry_id),
  unique(company_id,source_reversal_transaction_id),
  unique(company_id,target_payment_transaction_id),
  foreign key(company_id,bank_payment_id) references public.bank_payments(company_id,id) on delete restrict,
  foreign key(company_id,original_proposal_id) references public.automation_proposals(company_id,id) on delete restrict,
  foreign key(company_id,source_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,target_invoice_id) references public.invoices(company_id,id) on delete restrict,
  foreign key(company_id,accounting_entry_id) references public.journal_entries(company_id,id) on delete restrict
);
alter table public.customer_payment_reclassifications enable row level security;
create index if not exists customer_payment_reclass_bank_idx on public.customer_payment_reclassifications(company_id,bank_payment_id,sequence desc);
create index if not exists customer_payment_reclass_proposal_idx on public.customer_payment_reclassifications(company_id,original_proposal_id);
create index if not exists customer_payment_reclass_corrected_by_idx on public.customer_payment_reclassifications(corrected_by);
create index if not exists customer_payment_reclass_source_invoice_idx on public.customer_payment_reclassifications(company_id,source_invoice_id);
create index if not exists customer_payment_reclass_target_invoice_idx on public.customer_payment_reclassifications(company_id,target_invoice_id);

create policy "members read customer payment reclassifications"
on public.customer_payment_reclassifications for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=customer_payment_reclassifications.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert customer payment reclassifications"
on public.customer_payment_reclassifications for insert to authenticated
with check (corrected_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=customer_payment_reclassifications.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

revoke all on public.customer_payment_reclassifications from anon;
grant select,insert on public.customer_payment_reclassifications to authenticated;

drop trigger if exists controlled_financial_write_guard on public.customer_payment_reclassifications;
create trigger controlled_financial_write_guard before insert or update or delete on public.customer_payment_reclassifications
for each row execute function private.require_controlled_financial_write();

create or replace function public.reclassify_customer_payment(
  p_company_id text,p_proposal_id text,p_target_invoice_id text,p_request_id text,p_correction_date date,p_reason text
)
returns table(reclassification_id text,journal_number text,source_invoice_id text,target_invoice_id text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();v_reason text:=btrim(coalesce(p_reason,''));v_prior public.customer_payment_reclassifications%rowtype;
  v_exec public.customer_payment_executions%rowtype;v_bank public.bank_payments%rowtype;v_latest public.customer_payment_reclassifications%rowtype;
  v_source public.invoices%rowtype;v_target public.invoices%rowtype;v_source_status text;v_payment_tx_id text;v_seq integer:=1;
  v_payment_tx public.invoice_transactions%rowtype;v_original_entry text;v_receivable bigint;v_expected bigint;
  v_period text:=to_char(p_correction_date,'YYYY-MM');v_year text:=to_char(p_correction_date,'YYYY');v_jseq bigint;v_entry text;
  v_source_rev text;v_target_pay text;v_id text;
begin
  perform set_config('app.controlled_financial_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_CUSTOMER_PAYMENT_RECLASS_REQUEST_ID'; end if;
  if char_length(v_reason)<5 or char_length(v_reason)>500 then raise exception 'CUSTOMER_PAYMENT_RECLASS_REASON_REQUIRED'; end if;
  select * into v_prior from public.customer_payment_reclassifications r where r.company_id=p_company_id and r.request_id=p_request_id;
  if found then
    if v_prior.original_proposal_id<>p_proposal_id or v_prior.target_invoice_id<>p_target_invoice_id or v_prior.correction_date<>p_correction_date or v_prior.reason<>v_reason or v_prior.corrected_by<>v_uid then raise exception 'CUSTOMER_PAYMENT_RECLASS_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_prior.id,(select j.series||j.journal_number from public.journal_entries j where j.company_id=p_company_id and j.id=v_prior.accounting_entry_id),v_prior.source_invoice_id,v_prior.target_invoice_id,true;return;
  end if;
  select * into v_exec from public.customer_payment_executions e where e.company_id=p_company_id and e.proposal_id=p_proposal_id;
  if not found then raise exception 'CUSTOMER_PAYMENT_NOT_EXECUTED'; end if;
  if v_exec.invoice_status_before is null then raise exception 'CUSTOMER_PAYMENT_RECLASS_LEGACY_BLOCKED'; end if;
  select * into v_bank from public.bank_payments b where b.company_id=p_company_id and b.id=v_exec.bank_payment_id for update;
  if not found or v_bank.status<>'posted' then raise exception 'INVALID_BANK_PAYMENT_STATUS'; end if;
  select * into v_latest from public.customer_payment_reclassifications r where r.company_id=p_company_id and r.bank_payment_id=v_exec.bank_payment_id order by r.sequence desc limit 1;
  if found then
    v_source_status:=v_latest.target_status_before_payment;v_payment_tx_id:=v_latest.target_payment_transaction_id;v_seq:=v_latest.sequence+1;
    select * into v_source from public.invoices i where i.company_id=p_company_id and i.id=v_latest.target_invoice_id for update;
  else
    v_source_status:=v_exec.invoice_status_before;v_payment_tx_id:=v_exec.invoice_transaction_id;
    select * into v_source from public.invoices i where i.company_id=p_company_id and i.id=v_exec.invoice_id for update;
  end if;
  select * into v_target from public.invoices i where i.company_id=p_company_id and i.id=p_target_invoice_id for update;
  if v_source.id is null or v_target.id is null then raise exception 'TARGET_INVOICE_NOT_FOUND'; end if;
  if v_source.id=v_target.id then raise exception 'CUSTOMER_PAYMENT_ALREADY_ALLOCATED'; end if;
  if v_source.remaining_ore<>0 or v_source.status<>'Betald' then raise exception 'CUSTOMER_PAYMENT_RECLASS_PARTIAL_UNSUPPORTED'; end if;
  if v_target.total_ore<=0 or v_target.remaining_ore<>v_exec.amount_ore or v_target.invoice_account<>'1510' then raise exception 'CUSTOMER_PAYMENT_AMOUNT_MISMATCH'; end if;
  if p_correction_date<v_exec.posting_date then raise exception 'CUSTOMER_PAYMENT_RECLASS_DATE_BEFORE_PAYMENT'; end if;
  if exists(select 1 from public.accounting_periods ap where ap.company_id=p_company_id and ap.period=v_period and ap.status='locked') then raise exception 'PERIOD_LOCKED'; end if;
  select j.id into v_original_entry from public.journal_entries j where j.company_id=p_company_id and j.source_type='customer-invoice' and j.source_id=v_source.id order by j.created_at limit 1;
  if v_original_entry is null then raise exception 'CUSTOMER_RECEIVABLE_NOT_POSTED'; end if;
  select coalesce(sum(l.debit_ore-l.credit_ore),0) into v_receivable from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original_entry and l.account='1510';
  if v_receivable<>v_source.total_ore then raise exception 'CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'; end if;
  select v_source.total_ore+coalesce(sum(t.amount_ore),0) into v_expected from public.invoice_transactions t where t.company_id=p_company_id and t.invoice_id=v_source.id and t.approved;
  if v_expected<>v_source.remaining_ore then raise exception 'CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'; end if;
  select j.id into v_original_entry from public.journal_entries j where j.company_id=p_company_id and j.source_type='customer-invoice' and j.source_id=v_target.id order by j.created_at limit 1;
  if v_original_entry is null then raise exception 'CUSTOMER_RECEIVABLE_NOT_POSTED'; end if;
  select coalesce(sum(l.debit_ore-l.credit_ore),0) into v_receivable from public.journal_lines l where l.company_id=p_company_id and l.journal_entry_id=v_original_entry and l.account='1510';
  if v_receivable<>v_target.total_ore then raise exception 'CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'; end if;
  select v_target.total_ore+coalesce(sum(t.amount_ore),0) into v_expected from public.invoice_transactions t where t.company_id=p_company_id and t.invoice_id=v_target.id and t.approved;
  if v_expected<>v_target.remaining_ore then raise exception 'CUSTOMER_RECEIVABLE_INTEGRITY_ERROR'; end if;
  select * into v_payment_tx from public.invoice_transactions t where t.company_id=p_company_id and t.id=v_payment_tx_id;
  if not found or v_payment_tx.invoice_id<>v_source.id or v_payment_tx.transaction_type<>'payment' or v_payment_tx.amount_ore<>-v_exec.amount_ore then raise exception 'CUSTOMER_PAYMENT_RECLASS_INTEGRITY_ERROR'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':A:'||v_year,0));
  insert into public.accounting_sequences(company_id,series,fiscal_year,last_number) values(p_company_id,'A',v_year,1)
  on conflict(company_id,series,fiscal_year) do update set last_number=public.accounting_sequences.last_number+1 returning last_number into v_jseq;
  v_entry='entry_'||replace(gen_random_uuid()::text,'-','');
  insert into public.journal_entries(id,company_id,series,journal_number,posting_date,description,source_type,source_id,created_by)
  values(v_entry,p_company_id,'A',v_jseq::text,p_correction_date,left('Omför kundinbetalning '||v_source.invoice_number||' → '||v_target.invoice_number,240),'customer-payment-reclassification',v_exec.bank_payment_id||':'||v_seq,v_uid);
  insert into public.journal_lines(id,company_id,journal_entry_id,line_number,account,description,debit_ore,credit_ore) values
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry,1,'1510',left('Återöppna kundfaktura '||v_source.invoice_number,240),v_exec.amount_ore,0),
    ('jline_'||replace(gen_random_uuid()::text,'-',''),p_company_id,v_entry,2,'1510',left('Reglera kundfaktura '||v_target.invoice_number,240),0,v_exec.amount_ore);
  v_source_rev='transaction_'||replace(gen_random_uuid()::text,'-','');v_target_pay='transaction_'||replace(gen_random_uuid()::text,'-','');
  insert into public.invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,journal_number,amount_ore,approved,account,bank_reference)
  values(v_source_rev,p_company_id,v_source.id,'payment-reversal','Bank',v_bank.booking_date,p_correction_date,'A'||v_jseq,v_exec.amount_ore,true,'1510',v_bank.external_id||':R'||v_seq||':SOURCE');
  insert into public.invoice_transactions(id,company_id,invoice_id,transaction_type,payment_method,payment_date,posting_date,journal_number,amount_ore,approved,account,bank_reference)
  values(v_target_pay,p_company_id,v_target.id,'payment','Bank',v_bank.booking_date,p_correction_date,'A'||v_jseq,-v_exec.amount_ore,true,'1510',v_bank.external_id||':R'||v_seq||':TARGET');
  update public.invoices i set remaining_ore=v_exec.amount_ore,status=v_source_status,updated_at=now() where i.company_id=p_company_id and i.id=v_source.id and i.remaining_ore=0 and i.status='Betald';
  if not found then raise exception 'CUSTOMER_PAYMENT_RECLASS_SOURCE_CONFLICT'; end if;
  update public.invoices i set remaining_ore=0,status='Betald',updated_at=now() where i.company_id=p_company_id and i.id=v_target.id and i.remaining_ore=v_exec.amount_ore and i.total_ore>0;
  if not found then raise exception 'CUSTOMER_PAYMENT_RECLASS_TARGET_CONFLICT'; end if;
  v_id='cpreclass_'||replace(gen_random_uuid()::text,'-','');
  insert into public.customer_payment_reclassifications(id,company_id,bank_payment_id,original_proposal_id,sequence,source_invoice_id,target_invoice_id,source_status_before_payment,target_status_before_payment,original_payment_transaction_id,source_reversal_transaction_id,target_payment_transaction_id,accounting_entry_id,amount_ore,correction_date,reason,request_id,corrected_by)
  values(v_id,p_company_id,v_exec.bank_payment_id,p_proposal_id,v_seq,v_source.id,v_target.id,v_source_status,v_target.status,v_payment_tx.id,v_source_rev,v_target_pay,v_entry,v_exec.amount_ore,p_correction_date,v_reason,p_request_id,v_uid);
  return query select v_id,'A'||v_jseq,v_source.id,v_target.id,false;
end;
$$;
revoke all on function public.reclassify_customer_payment(text,text,text,text,date,text) from public,anon;
grant execute on function public.reclassify_customer_payment(text,text,text,text,date,text) to authenticated;
