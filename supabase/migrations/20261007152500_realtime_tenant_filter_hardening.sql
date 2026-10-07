-- Harden Supabase Realtime tenant isolation for DELETE events.
-- Postgres Changes filters use the old row for deletes; REPLICA IDENTITY FULL
-- keeps company_id available so the explicit company filter can be evaluated.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'accounting_corrections','accounting_periods','audit_events','automation_proposals',
    'bank_payments','company_invoice_settings','company_memberships','company_revenue_accounts',
    'customer_credit_refunds','customer_invoice_credit_adjustments','customer_invoice_documents',
    'customer_invoice_drafts','customer_invoice_number_reservations','customer_manual_payments',
    'customer_payment_executions','customer_payment_reclassifications','customers',
    'document_upload_verifications','documents','financial_batch_events','financial_batch_lines',
    'financial_batch_transactions','financial_batches','inventory_adjustments','inventory_items',
    'inventory_movements','invoice_comments','invoice_reminders','invoice_transactions','invoices',
    'journal_entries','journal_lines','payroll_runs','period_unlock_requests','supplier_change_events',
    'supplier_invoice_date_corrections','supplier_invoices','supplier_payments','suppliers',
    'website_cms_revisions','website_cms_state'
  ]
  loop
    if to_regclass('public.'||v_table) is not null then
      execute format('alter table public.%I replica identity full',v_table);
    end if;
  end loop;
end
$$;
