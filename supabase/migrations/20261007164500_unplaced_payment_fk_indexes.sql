-- Cover foreign keys introduced by the unplaced-payments workflow.
-- Keeps fresh rebuilds at 0 unindexed foreign keys.

create index if not exists unplaced_payment_resolutions_accounting_entry_idx
  on public.unplaced_payment_resolutions(company_id, accounting_entry_id);

create index if not exists unplaced_payment_resolutions_resolved_by_idx
  on public.unplaced_payment_resolutions(resolved_by);
