-- Safe synthetic invoice identity for the shared Supabase UAT company.
-- These values must never be reused in production.
-- UAT invoices are also watermarked "DEMO – INTE BETALNINGSUNDERLAG" by the frontend.

insert into public.company_invoice_settings(
  company_id,address,vat_number,phone,email,website,bankgiro,tax_status,updated_by,updated_at
)
values(
  'uat-lt-studio',
  'UAT-MILJÖ – EJ SKARP ADRESS, Göteborg',
  'SE000000000001',
  '000-000 00 00',
  'uat@example.invalid',
  'https://ludwigberglund-coder.github.io/LT-Studio/',
  'EJ-BETALNING',
  'UAT – EJ SKARP / EJ F-SKATT',
  null,
  now()
)
on conflict(company_id) do update set
  address=excluded.address,
  vat_number=excluded.vat_number,
  phone=excluded.phone,
  email=excluded.email,
  website=excluded.website,
  bankgiro=excluded.bankgiro,
  tax_status=excluded.tax_status,
  updated_by=null,
  updated_at=now();
