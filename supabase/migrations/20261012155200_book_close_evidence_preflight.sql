-- P1C / #745: bank and invoice evidence preflight, NOT a reconciliation or approval.
-- One read-only SQL statement for a consistent observed snapshot; all business rows stay RLS-bound.
create or replace function public.book_close_evidence_preflight(
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
      where m.company_id = p_company_id
        and m.auth_user_id = auth.uid()
        and m.role in ('admin','accountant','approver','readonly')
    )
),
bank_period as materialized (
  select b.id, b.external_id, b.status, b.currency, b.amount_ore
  from public.bank_payments b
  join authorized a on true
  where b.company_id = p_company_id
    and b.booking_date >= p_start and b.booking_date < p_end
),
customer_period as materialized (
  select i.id, i.pdf_sha256, i.total_ore, i.remaining_ore
  from public.invoices i
  join authorized a on true
  where i.company_id = p_company_id
    and i.posting_date >= p_start and i.posting_date < p_end
),
supplier_period as materialized (
  select i.id, i.pdf_sha256, i.currency, i.total_ore,
         i.remaining_ore, i.liability_accounting_entry_id
  from public.supplier_invoices i
  join authorized a on true
  where i.company_id = p_company_id
    and i.posting_date >= p_start and i.posting_date < p_end
),
bank_summary as (
  select count(*) as records,
         count(*) filter (where status = 'unmatched') as unmatched,
         count(*) filter (where status = 'proposal-created') as pending_proposal,
         count(*) filter (where status is null or btrim(status) = '') as missing_status,
         count(*) filter (where currency is distinct from 'SEK') as other_currency,
         count(*) filter (where amount_ore is null or amount_ore = 0) as missing_or_zero_amount
  from bank_period
),
bank_dupes as (
  select count(*) as groups
  from (
    select external_id
    from bank_period
    where external_id is not null and btrim(external_id) <> ''
    group by external_id having count(*) > 1
  ) d
),
undated_bank as (
  select count(*) as records
  from public.bank_payments b
  join authorized a on true
  where b.company_id = p_company_id and b.booking_date is null
),
customer_summary as (
  select count(*) as records,
         count(*) filter (where pdf_sha256 is null or btrim(pdf_sha256) = '') as missing_pdf_reference,
         count(*) filter (where total_ore is null or total_ore = 0 or remaining_ore is null) as missing_or_zero_amount
  from customer_period
),
supplier_summary as (
  select count(*) as records,
         count(*) filter (where pdf_sha256 is null or btrim(pdf_sha256) = '') as missing_pdf_reference,
         count(*) filter (where liability_accounting_entry_id is null or btrim(liability_accounting_entry_id) = '') as missing_liability_reference,
         count(*) filter (where currency is distinct from 'SEK') as other_currency,
         count(*) filter (where total_ore is null or total_ore = 0 or remaining_ore is null) as missing_or_zero_amount
  from supplier_period
),
undated_invoices as (
  select
   (select count(*) from public.invoices i join authorized a on true
     where i.company_id = p_company_id and i.posting_date is null
       and i.invoice_date >= p_start and i.invoice_date < p_end) as customer_count,
   (select count(*) from public.supplier_invoices i join authorized a on true
     where i.company_id = p_company_id and i.posting_date is null
       and i.invoice_date >= p_start and i.invoice_date < p_end) as supplier_count
)
select jsonb_build_object(
  'version', 1,
  'scope', 'book-close-evidence-preflight-not-reconciled',
  'company_id', p_company_id,
  'start_date', p_start,
  'end_exclusive', p_end,
  'observed_at', statement_timestamp(),
  'bank', jsonb_build_object(
    'period_records', b.records::text,
    'unmatched', b.unmatched::text,
    'pending_proposal', b.pending_proposal::text,
    'missing_status', b.missing_status::text,
    'non_sek', b.other_currency::text,
    'zero_or_missing_amount', b.missing_or_zero_amount::text,
    'duplicate_external_id_groups', bd.groups::text,
    'undated_company_records', ub.records::text
  ),
  'customer', jsonb_build_object(
    'period_posted_invoices', c.records::text,
    'missing_pdf_reference', c.missing_pdf_reference::text,
    'zero_or_missing_amount', c.missing_or_zero_amount::text,
    'undated_invoices_with_period_invoice_date', ui.customer_count::text
  ),
  'supplier', jsonb_build_object(
    'period_posted_invoices', s.records::text,
    'missing_pdf_reference', s.missing_pdf_reference::text,
    'missing_liability_reference', s.missing_liability_reference::text,
    'non_sek', s.other_currency::text,
    'zero_or_missing_amount', s.missing_or_zero_amount::text,
    'undated_invoices_with_period_invoice_date', ui.supplier_count::text
  ),
  'reconciliation', jsonb_build_object(
    'bank_to_external_statement', 'not_verified',
    'customer_1510_as_of', 'not_verified',
    'supplier_2440_as_of', 'not_verified',
    'reason', 'No verified external bank ending balance or historical receivable/payable as-of snapshot in this preflight'
  )
)
from authorized a
cross join bank_summary b
cross join bank_dupes bd
cross join undated_bank ub
cross join customer_summary c
cross join supplier_summary s
cross join undated_invoices ui;
$function$;

revoke all on function public.book_close_evidence_preflight(text,date,date) from public, anon;
grant execute on function public.book_close_evidence_preflight(text,date,date) to authenticated;
