-- #745 P1E: every-account trial balance for explicit fiscal date bounds.
-- Read-only evidence, NOT a verified opening/closing balance or K2 annual report.
create or replace function public.book_close_trial_balance(
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
    and p_company_id is not null and btrim(p_company_id) <> ''
    and p_start >= date '2000-01-01'
    and p_end > p_start
    and p_end <= (p_start + interval '18 months')::date
    and p_end <= date '2200-01-01'
    and lt_security.request_has_aal2_personal_session()
    and exists (
      select 1 from public.company_memberships m
      where m.company_id = p_company_id and m.auth_user_id = auth.uid()
        and m.role in ('admin','accountant','approver','readonly')
    )
),
entries as materialized (
  select e.id,e.company_id,e.posting_date
  from public.journal_entries e
  join authorized a on true
  where e.company_id=p_company_id and e.posting_date < p_end
),
lines as materialized (
  select e.posting_date,l.account,l.id,
    l.debit_ore::numeric as debit_ore,
    l.credit_ore::numeric as credit_ore
  from entries e
  join public.journal_lines l
    on l.company_id=e.company_id and l.journal_entry_id=e.id
),
account_totals as (
  select account,
    count(*) filter(where posting_date<p_start) as prior_lines,
    count(*) filter(where posting_date>=p_start) as period_lines,
    coalesce(sum(debit_ore) filter(where posting_date>=p_start),0) as debit,
    coalesce(sum(credit_ore) filter(where posting_date>=p_start),0) as credit,
    coalesce(sum(debit_ore-credit_ore) filter(where posting_date<p_start),0) as prior_net,
    coalesce(sum(debit_ore-credit_ore) filter(where posting_date>=p_start),0) as period_net,
    count(*) filter(where account !~ '^[0-9]{4}$'
         or debit_ore<0 or credit_ore<0
         or (debit_ore=0 and credit_ore=0)
         or (debit_ore>0 and credit_ore>0)) as invalid_lines
  from lines group by account
),
totals as (
  select coalesce(sum(debit),0) as debits,coalesce(sum(credit),0) as credits,
    coalesce(sum(prior_net),0) as prior_net,
    coalesce(sum(period_net),0) as period_net,
    coalesce(sum(invalid_lines),0) as invalid_lines,
    coalesce(sum(prior_lines),0) as prior_lines,
    coalesce(sum(period_lines),0) as period_lines
  from account_totals
)
select jsonb_build_object(
  'version',1,
  'scope','all-account-trial-balance-not-reconciled',
  'company_id',p_company_id,
  'start_date',p_start,
  'end_exclusive',p_end,
  'observed_at',statement_timestamp(),
  'status','not_reconciled',
  'history_coverage','not_verified',
  'opening_balance','not_verified',
  'external_reconciliation','not_verified',
  'counts',jsonb_build_object(
    'account_count',(select count(*)::text from account_totals),
    'prior_lines',t.prior_lines::text,
    'period_lines',t.period_lines::text,
    'invalid_lines',t.invalid_lines::text
  ),
  'totals',jsonb_build_object(
    'period_debit_ore',t.debits::text,
    'period_credit_ore',t.credits::text,
    'prior_net_ore',t.prior_net::text,
    'period_net_ore',t.period_net::text
  ),
  'accounts',(
    select coalesce(jsonb_agg(jsonb_build_object(
      'account',account,
      'prior_net_ore',prior_net::text,
      'period_debit_ore',debit::text,
      'period_credit_ore',credit::text,
      'period_net_ore',period_net::text,
      'through_end_net_ore',(prior_net+period_net)::text,
      'prior_lines',prior_lines::text,
      'period_lines',period_lines::text,
      'invalid_lines',invalid_lines::text
    ) order by account),'[]'::jsonb)
    from account_totals
  )
) from authorized a cross join totals t;
$function$;
revoke all on function public.book_close_trial_balance(text,date,date) from public,anon;
grant execute on function public.book_close_trial_balance(text,date,date) to authenticated;
