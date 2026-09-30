-- Customer-specific invoice defaults for shared Supabase UAT.
-- Existing customers retain 30 days and empty references.

alter table public.customers
  add column if not exists payment_terms_days integer not null default 30
    check (payment_terms_days between 0 and 365),
  add column if not exists our_reference text
    check (our_reference is null or char_length(our_reference) <= 120),
  add column if not exists your_reference text
    check (your_reference is null or char_length(your_reference) <= 120);

comment on column public.customers.payment_terms_days is
  'Default payment terms copied into new customer invoices.';
comment on column public.customers.our_reference is
  'Default seller reference copied into new customer invoices.';
comment on column public.customers.your_reference is
  'Default buyer reference copied into new customer invoices.';
