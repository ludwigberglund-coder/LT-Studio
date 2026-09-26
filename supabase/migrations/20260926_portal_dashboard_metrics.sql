-- Dashboard performance: collapse six independent browser reads into one database round-trip.
-- SECURITY INVOKER keeps existing RLS and company membership checks authoritative.

create or replace function public.portal_dashboard_metrics(p_company_id text)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select case
    when exists (
      select 1
      from public.company_memberships m
      where m.company_id = p_company_id
        and m.auth_user_id = (select auth.uid())
    )
    then jsonb_build_object(
      'receivables', (
        select jsonb_build_object(
          'overdueOre', coalesce(sum(greatest(i.remaining_ore,0)) filter (
            where i.remaining_ore > 0
              and i.due_date < (now() at time zone 'Europe/Stockholm')::date
          ),0),
          'overdueCount', count(*) filter (
            where i.remaining_ore > 0
              and i.due_date < (now() at time zone 'Europe/Stockholm')::date
          )
        )
        from public.invoices i
        where i.company_id = p_company_id
      ),
      'payables', (
        select jsonb_build_object(
          'approvalCount', count(*) filter (where s.status = 'coded'),
          'paymentCount', count(*) filter (where s.status in ('approved','payment-prepared','released'))
        )
        from public.supplier_invoices s
        where s.company_id = p_company_id
      ),
      'bank', (
        select jsonb_build_object(
          'reviewCount', count(*) filter (where b.status = 'unmatched')
        )
        from public.bank_payments b
        where b.company_id = p_company_id
      ),
      'automation', (
        select jsonb_build_object(
          'reviewCount', count(*) filter (
            where a.status is null or a.status not in ('approved','rejected','posted')
          )
        )
        from public.automation_proposals a
        where a.company_id = p_company_id
      ),
      'inventory', (
        select jsonb_build_object(
          'pendingCount', count(*) filter (where ia.status = 'pending')
        )
        from public.inventory_adjustments ia
        where ia.company_id = p_company_id
      ),
      'accounting', (
        select jsonb_build_object(
          'pendingUnlocks', count(*) filter (where p.status = 'pending')
        )
        from public.period_unlock_requests p
        where p.company_id = p_company_id
      )
    )
    else null
  end;
$$;

revoke all on function public.portal_dashboard_metrics(text) from public, anon;
grant execute on function public.portal_dashboard_metrics(text) to authenticated;
