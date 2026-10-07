-- Synthetic-only seed for an isolated LT Studio Supabase staging environment.
-- This file is intentionally NOT part of [db.seed] in supabase/config.toml.
-- The shared UAT keeps its own seed. Apply this file only to a dedicated staging project.
-- Never replace these identities with real customers, suppliers, users or payment details.

insert into public.companies(id, legal_name, org_number, display_name)
values
  ('staging-alpha', 'Synthetic Alpha AB', '000000-9101', 'Synthetic Alpha'),
  ('staging-beta',  'Synthetic Beta AB',  '000000-9102', 'Synthetic Beta')
on conflict do nothing;

insert into public.company_invoice_settings(
  company_id,address,vat_number,phone,email,website,bankgiro,tax_status,updated_by,updated_at
)
values
  (
    'staging-alpha',
    'Syntetisk testadress 1, 000 91 Teststad',
    'SE000000910101',
    '000-000 91 01',
    'alpha@example.invalid',
    'https://example.invalid/staging-alpha',
    'EJ-BETALNING',
    'SYNTHETIC STAGING - EJ SKARP',
    null,
    now()
  ),
  (
    'staging-beta',
    'Syntetisk testadress 2, 000 92 Teststad',
    'SE000000910201',
    '000-000 92 02',
    'beta@example.invalid',
    'https://example.invalid/staging-beta',
    'EJ-BETALNING',
    'SYNTHETIC STAGING - EJ SKARP',
    null,
    now()
  )
on conflict do nothing;

insert into public.customers(
  id,company_id,customer_number,name,org_number,email,address_json,customer_type,reminder_fee_agreed
)
values
  (
    'staging_alpha_customer_1',
    'staging-alpha',
    'ALPHA-K001',
    'Synthetic Alpha Kund AB',
    '000000-9111',
    'alpha-kund@example.invalid',
    '{"street":"Testgatan 11","postalCode":"000 91","city":"Teststad","country":"SE"}'::jsonb,
    'business',
    false
  ),
  (
    'staging_beta_customer_1',
    'staging-beta',
    'BETA-K001',
    'Synthetic Beta Kund AB',
    '000000-9211',
    'beta-kund@example.invalid',
    '{"street":"Testgatan 21","postalCode":"000 92","city":"Teststad","country":"SE"}'::jsonb,
    'business',
    false
  )
on conflict do nothing;

insert into public.suppliers(
  id,company_id,supplier_number,name,org_number,email,bankgiro,plusgiro,address_json,default_cost_account
)
values
  (
    'staging_alpha_supplier_1',
    'staging-alpha',
    'ALPHA-L001',
    'Synthetic Alpha Leverantor AB',
    '000000-9121',
    'alpha-leverantor@example.invalid',
    '000-0000',
    null,
    '{"street":"Leveransgatan 11","postalCode":"000 91","city":"Teststad","country":"SE"}'::jsonb,
    '4010'
  ),
  (
    'staging_beta_supplier_1',
    'staging-beta',
    'BETA-L001',
    'Synthetic Beta Leverantor AB',
    '000000-9221',
    'beta-leverantor@example.invalid',
    '000-0000',
    null,
    '{"street":"Leveransgatan 21","postalCode":"000 92","city":"Teststad","country":"SE"}'::jsonb,
    '6540'
  )
on conflict do nothing;
