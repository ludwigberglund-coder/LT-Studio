-- Document archive immutability hardening.
-- Once metadata references an archived original, browser roles may only read it.
-- Corrections must be registered as new documents.

drop policy if exists "accounting members can update company documents" on public.documents;
drop policy if exists "accounting members can delete company documents" on public.documents;

revoke all on public.documents from anon;
revoke update,delete,truncate,references,trigger on public.documents from authenticated;
grant select,insert on public.documents to authenticated;

revoke all on public.customer_invoice_documents from anon;
revoke update,delete,truncate,references,trigger on public.customer_invoice_documents from authenticated;
grant select,insert on public.customer_invoice_documents to authenticated;
