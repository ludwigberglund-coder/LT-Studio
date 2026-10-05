-- Applied to Supabase UAT on 2026-10-05.
-- One-time recovery for a stale saved invoice draft that still referenced an old
-- reserved request id after the draft payload had changed.
--
-- The runtime fix in apps/portal/invoices.js now recovers this condition
-- automatically. This migration only reconciles already-existing UAT state.
-- It never reuses the abandoned invoice number; the old reservation is kept as
-- cancelled audit history and the saved draft receives a fresh request id.

create temporary table lt_stale_invoice_draft_reservation_recovery
on commit drop
as
select
  r.company_id,
  r.request_id as old_request_id,
  d.user_id,
  gen_random_uuid()::text as new_request_id
from public.customer_invoice_number_reservations r
join public.customer_invoice_drafts d
  on d.company_id=r.company_id
 and d.request_id=r.request_id
where r.status='reserved'
  and r.purpose='invoice'
  and d.updated_at>r.updated_at
  and r.created_at<now()-interval '1 day';

do $$
begin
  if (select count(*) from lt_stale_invoice_draft_reservation_recovery)>10 then
    raise exception 'STALE_INVOICE_RESERVATION_RECOVERY_SCOPE_TOO_LARGE';
  end if;
end
$$;

update public.customer_invoice_drafts d
set request_id=s.new_request_id,
    updated_at=now()
from lt_stale_invoice_draft_reservation_recovery s
where d.company_id=s.company_id
  and d.user_id=s.user_id
  and d.request_id=s.old_request_id;

update public.customer_invoice_number_reservations r
set status='cancelled',
    updated_at=now()
from lt_stale_invoice_draft_reservation_recovery s
where r.company_id=s.company_id
  and r.request_id=s.old_request_id
  and r.status='reserved';
