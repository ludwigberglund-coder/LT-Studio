-- Bokslut #745 P1D: historical ledger cut-off evidence, NOT a reconciled closing balance.
-- Source of truth: GitHub; no customer data, no writes, no implied opening balance.
create or replace function public.book_close_ledger_cutoff(
  p_company_id text, p_start date, p_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with authorized as materialized (
  select 1 as allowed
  where auth.uid() is not null
    and p_company_id is not null
    and btrim(p_company_id) <> ''
    and p_start >= date '2000-01-01'
    and p_end > p_start
    and p_end <= (p_start + interval '18 months')::date
    and p_end <= date '2200-01-01'
    and lt_security.request_has_aal2_personal_session()
    and exists (
      select 1 from public.company_memberships m
      where m.company_id = p_company_id
        and m.auth_user_id = auth.uid()
        and m.role in ('admin','accountant','approver','readonly')
    )
),
entries as materialized (
  select e.id, e.company_id, e.posting_date
  from public.journal_entries e
  join authorized a on true
  where e.company_id = p_company_id
    and (e.posting_date < p_end or e.posting_date is null)
),
tracked_accounts as (
  select account
  from (values ('1510'),('1630'),('1930'),('1940'),('2440'),('2650')) a(account)
),
tracked_lines as materialized (
  select e.posting_date, l.account, l.id as line_id,
         l.debit_ore, l.credit_ore
  from entries e
  join public.journal_lines l
    on l.company_id = e.company_id and l.journal_entry_id = e.id
  join tracked_accounts a on a.account = l.account
),
account_totals as (
  select a.account,
    count(t.line_id) filter (where t.posting_date < p_start)::text as before_period_lines,
    count(t.line_id) filter (where t.posting_date >= p_start)::text as in_period_lines,
    coalesce(sum(t.debit_ore::numeric - t.credit_ore::numeric)
      filter (where t.posting_date < p_start),0) as before_net,
    coalesce(sum(t.debit_ore::numeric - t.credit_ore::numeric)
      filter (where t.posting_date >= p_start),0) as period_net,
    coalesce(sum(t.debit_ore::numeric - t.credit_ore::numeric)
      filter (where t.posting_date is not null),0) as through_end_net,
    count(t.line_id) filter (
      where t.debit_ore is null or t.credit_ore is null
         or t.debit_ore < 0 or t.credit_ore < 0
         or (t.debit_ore > 0 and t.credit_ore > 0)
         or (t.debit_ore = 0 and t.credit_ore = 0)
    ) as invalid_line_count
  from tracked_accounts a
  left join tracked_lines t on t.account = a.account
  group by a.account
),
overview as (
 select
   count(*) filter (where posting_date is null)::text as undated_entries,
   count(*) filter (where posting_date < p_start)::text as earlier_entries,
   count(*) filter (where posting_date >= p_start)::text as period_entries,
   min(posting_date)::text as first_known_posting_date
 from entries
)
select jsonb_build_object(
  'version',1,
  'scope','ledger-cutoff-from-available-history-not-reconciled',
  'company_id',p_company_id,
  'start_date',p_start,
  'end_exclusive',p_end,
  'observed_at',statement_timestamp(),
  'status','not_reconciled',
  'history_coverage','not_verified',
  'external_statement','not_verified',
  'asof_subledger','not_verified',
  'counts',jsonb_build_object(
    'undated_entries',o.undated_entries,
    'earlier_entries',o.earlier_entries,
    'period_entries',o.period_entries,
    'first_known_posting_date',o.first_known_posting_date,
    'invalid_tracked_lines', (select coalesce(sum(invalid_line_count),0)::text from account_totals)
  ),
  'accounts',(
    select jsonb_object_agg(account,jsonb_build_object(
      'prior_net_ore',before_net::text,
      'period_net_ore',period_net::text,
      'through_end_net_ore',through_end_net::text,
      'prior_lines',before_period_lines,
      'period_lines',in_period_lines
    ))
    from account_totals
  )
)
from authorized a
cross join overview o;
$function$;
revoke all on function public.book_close_ledger_cutoff(text,date,date) from public, anon;
grant execute on function public.book_close_ledger_cutoff(text,date,date) to authenticated;
