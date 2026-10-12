-- Bokslut #745 P1B: one read-only, company-scoped ledger integrity statement.
-- This is an evidence snapshot, NOT a reconciled year close or durable/locked snapshot.
-- SECURITY INVOKER respects existing AAL2, membership and journal RLS.
create or replace function public.book_close_ledger_integrity(
  p_company_id text,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with access_guard as materialized (
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
          and m.role in ('admin', 'accountant', 'approver', 'readonly')
      )
  ),
  scoped_entries as materialized (
    select e.id, e.company_id, e.series, e.journal_number
    from public.journal_entries e
    join access_guard a on true
    where e.company_id = p_company_id
      and e.posting_date >= p_start
      and e.posting_date < p_end
  ),
  entry_totals as materialized (
    select e.id, e.series, e.journal_number,
      count(l.id) as line_count,
      coalesce(sum(l.debit_ore::numeric), 0) as debit_ore,
      coalesce(sum(l.credit_ore::numeric), 0) as credit_ore,
      count(l.id) filter (
        where l.account is null or l.account !~ '^[0-9]{4}$'
          or l.debit_ore is null or l.credit_ore is null
          or l.debit_ore < 0 or l.credit_ore < 0
          or (l.debit_ore > 0 and l.credit_ore > 0)
          or (l.debit_ore = 0 and l.credit_ore = 0)
      ) as invalid_line_count
    from scoped_entries e
    left join public.journal_lines l
      on l.company_id = e.company_id and l.journal_entry_id = e.id
    group by e.id, e.series, e.journal_number
  ),
  period_accounts as (
    select l.account,
      sum(l.debit_ore::numeric) as debit_ore,
      sum(l.credit_ore::numeric) as credit_ore
    from scoped_entries e
    join public.journal_lines l
      on l.company_id = e.company_id and l.journal_entry_id = e.id
    where l.account in ('1510', '1630', '1930', '1940', '2440', '2650')
    group by l.account
  ),
  repeated_numbers as (
    select 1
    from entry_totals t
    where t.journal_number is not null and btrim(t.journal_number) <> ''
    group by t.series, t.journal_number
    having count(*) > 1
  ),
  orphan_company_lines as (
    select count(*) as orphan_count
    from public.journal_lines l
    join access_guard a on true
    where l.company_id = p_company_id
      and not exists (
        select 1 from public.journal_entries e
        where e.id = l.journal_entry_id and e.company_id = l.company_id
      )
  )
  select jsonb_build_object(
    'version', 1,
    'scope', 'ledger-integrity-not-reconciled',
    'company_id', p_company_id,
    'start_date', p_start,
    'end_exclusive', p_end,
    'observed_at', statement_timestamp(),
    'counts', jsonb_build_object(
      'entries', (select count(*)::text from entry_totals),
      'lines', (select coalesce(sum(line_count),0)::text from entry_totals),
      'entries_without_two_lines', (select count(*)::text from entry_totals where line_count < 2),
      'unbalanced_entries', (select count(*)::text from entry_totals where debit_ore <> credit_ore),
      'invalid_lines', (select coalesce(sum(invalid_line_count),0)::text from entry_totals),
      'duplicate_number_groups', (select count(*)::text from repeated_numbers),
      'orphan_company_lines_all_dates', (select orphan_count::text from orphan_company_lines)
    ),
    'period_totals', jsonb_build_object(
      'debit_ore', (select coalesce(sum(debit_ore),0)::text from entry_totals),
      'credit_ore', (select coalesce(sum(credit_ore),0)::text from entry_totals)
    ),
    'account_movements', (
      select coalesce(
        jsonb_object_agg(account, jsonb_build_object(
          'debit_ore', debit_ore::text,
          'credit_ore', credit_ore::text,
          'net_ore', (debit_ore-credit_ore)::text
        )),
        '{}'::jsonb
      )
      from period_accounts
    )
  )
  from access_guard;
$function$;

revoke all on function public.book_close_ledger_integrity(text,date,date) from public, anon;
grant execute on function public.book_close_ledger_integrity(text,date,date) to authenticated;
