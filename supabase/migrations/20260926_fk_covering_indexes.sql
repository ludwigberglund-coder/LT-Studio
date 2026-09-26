-- Cover foreign keys reported by Supabase Performance Advisor on 2026-09-26.
-- These indexes do not change business data or authorization. They support
-- referential checks and joins for existing foreign-key relationships.

create index if not exists company_revenue_accounts_created_by_idx
  on public.company_revenue_accounts(created_by);

create index if not exists company_revenue_accounts_updated_by_idx
  on public.company_revenue_accounts(updated_by);

create index if not exists invoice_comments_author_user_id_idx
  on public.invoice_comments(author_user_id);

create index if not exists invoice_comments_invoice_id_fk_idx
  on public.invoice_comments(invoice_id);

create index if not exists invoice_reminders_created_by_idx
  on public.invoice_reminders(created_by);

create index if not exists invoice_reminders_invoice_id_fk_idx
  on public.invoice_reminders(invoice_id);

create index if not exists supplier_invoice_date_corrections_batch_fk_idx
  on public.supplier_invoice_date_corrections(company_id,batch_id);

create index if not exists supplier_invoice_date_corrections_reversal_tx_fk_idx
  on public.supplier_invoice_date_corrections(company_id,reversal_transaction_id);

create index if not exists supplier_invoice_date_corrections_replacement_tx_fk_idx
  on public.supplier_invoice_date_corrections(company_id,replacement_transaction_id);

create index if not exists supplier_invoice_date_corrections_original_entry_fk_idx
  on public.supplier_invoice_date_corrections(company_id,original_entry_id);

create index if not exists supplier_invoice_date_corrections_reversal_entry_fk_idx
  on public.supplier_invoice_date_corrections(company_id,reversal_entry_id);

create index if not exists supplier_invoice_date_corrections_replacement_entry_fk_idx
  on public.supplier_invoice_date_corrections(company_id,replacement_entry_id);

create index if not exists supplier_invoice_date_corrections_created_by_idx
  on public.supplier_invoice_date_corrections(created_by);

create index if not exists supplier_invoice_date_corrections_approved_by_idx
  on public.supplier_invoice_date_corrections(approved_by);

create index if not exists website_cms_revisions_published_by_idx
  on public.website_cms_revisions(published_by);

create index if not exists website_cms_state_draft_updated_by_idx
  on public.website_cms_state(draft_updated_by);

create index if not exists website_cms_state_published_by_idx
  on public.website_cms_state(published_by);
