-- Current Supabase foreign-key covering indexes as of 2026-09-30.
-- Verified against live UAT in a BEGIN/ROLLBACK test: 0 unindexed foreign keys remain.

create index if not exists company_revenue_accounts_created_by_idx on public.company_revenue_accounts(created_by);
create index if not exists company_revenue_accounts_updated_by_idx on public.company_revenue_accounts(updated_by);
create index if not exists customer_credit_settlements_approved_by_idx on public.customer_credit_settlements(approved_by);
create index if not exists customer_credit_settlements_created_by_idx on public.customer_credit_settlements(created_by);
create index if not exists customer_manual_payments_approved_by_idx on public.customer_manual_payments(approved_by);
create index if not exists customer_manual_payments_company_accounting_entry_idx on public.customer_manual_payments(company_id, accounting_entry_id);
create index if not exists customer_manual_payments_company_customer_idx on public.customer_manual_payments(company_id, customer_id);
create index if not exists customer_manual_payments_created_by_idx on public.customer_manual_payments(created_by);
create index if not exists customer_manual_payments_invoice_transaction_idx on public.customer_manual_payments(invoice_transaction_id);
create index if not exists customer_manual_payments_rejected_by_idx on public.customer_manual_payments(rejected_by);
create index if not exists invoice_comments_author_user_idx on public.invoice_comments(author_user_id);
create index if not exists invoice_comments_invoice_id_fk_idx on public.invoice_comments(invoice_id);
create index if not exists invoice_reminders_created_by_idx on public.invoice_reminders(created_by);
create index if not exists invoice_reminders_invoice_id_fk_idx on public.invoice_reminders(invoice_id);
create index if not exists supplier_invoice_date_corrections_original_entry_idx on public.supplier_invoice_date_corrections(company_id, original_entry_id);
create index if not exists supplier_invoice_date_corrections_replacement_entry_idx on public.supplier_invoice_date_corrections(company_id, replacement_entry_id);
create index if not exists supplier_invoice_date_corrections_replacement_transaction_idx on public.supplier_invoice_date_corrections(company_id, replacement_transaction_id);
create index if not exists supplier_invoice_date_corrections_reversal_entry_idx on public.supplier_invoice_date_corrections(company_id, reversal_entry_id);
create index if not exists supplier_invoice_date_corrections_reversal_transaction_idx on public.supplier_invoice_date_corrections(company_id, reversal_transaction_id);
create index if not exists supplier_invoice_date_corrections_approved_by_idx on public.supplier_invoice_date_corrections(approved_by);
create index if not exists supplier_invoice_date_corrections_company_batch_idx on public.supplier_invoice_date_corrections(company_id, batch_id);
create index if not exists supplier_invoice_date_corrections_created_by_idx on public.supplier_invoice_date_corrections(created_by);
create index if not exists website_cms_revisions_published_by_idx on public.website_cms_revisions(published_by);
create index if not exists website_cms_state_draft_updated_by_idx on public.website_cms_state(draft_updated_by);
create index if not exists website_cms_state_published_by_idx on public.website_cms_state(published_by);
