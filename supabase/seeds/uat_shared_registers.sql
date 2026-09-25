-- Shared synthetic register seed for LT Studio Supabase UAT.
-- Runtime fixture only: no real customer/supplier information and no payable bank details.
-- Safe to run repeatedly; existing rows are never overwritten.
--
-- Important: invoices are intentionally NOT seeded here. They must be created through
-- the real UAT UI so PDF, SHA-256, document archive and accounting are tested together.

insert into public.customers(
  id,company_id,customer_number,name,org_number,email,address_json,customer_type,reminder_fee_agreed
)
values
  (
    'uat_customer_nord',
    'uat-lt-studio',
    'UAT-K001',
    'UAT Kund Nord AB',
    '000000-1001',
    'kund-nord@example.invalid',
    '{"street":"Testgatan 1","postalCode":"000 01","city":"UAT-staden","country":"SE"}'::jsonb,
    'business',
    false
  ),
  (
    'uat_customer_vast',
    'uat-lt-studio',
    'UAT-K002',
    'UAT Kund Väst AB',
    '000000-1002',
    'kund-vast@example.invalid',
    '{"street":"Provgatan 2","postalCode":"000 02","city":"UAT-staden","country":"SE"}'::jsonb,
    'business',
    false
  ),
  (
    'uat_customer_offentlig',
    'uat-lt-studio',
    'UAT-K003',
    'UAT Offentlig Testkund',
    '000000-1003',
    'offentlig-testkund@example.invalid',
    '{"street":"Kontrollvägen 3","postalCode":"000 03","city":"UAT-staden","country":"SE"}'::jsonb,
    'public-body',
    false
  )
on conflict do nothing;

insert into public.suppliers(
  id,company_id,supplier_number,name,org_number,email,bankgiro,plusgiro,address_json,default_cost_account
)
values
  (
    'uat_supplier_varor',
    'uat-lt-studio',
    'UAT-L001',
    'UAT Leverantör Varor AB',
    '000000-2001',
    'leverantor-varor@example.invalid',
    '000-0000',
    null,
    '{"street":"Leveransgatan 1","postalCode":"000 11","city":"UAT-staden","country":"SE"}'::jsonb,
    '4010'
  ),
  (
    'uat_supplier_service',
    'uat-lt-studio',
    'UAT-L002',
    'UAT Leverantör Service AB',
    '000000-2002',
    'leverantor-service@example.invalid',
    '000-0000',
    null,
    '{"street":"Servicevägen 2","postalCode":"000 12","city":"UAT-staden","country":"SE"}'::jsonb,
    '6540'
  ),
  (
    'uat_supplier_logistics',
    'uat-lt-studio',
    'UAT-L003',
    'UAT Leverantör Logistik AB',
    '000000-2003',
    'leverantor-logistik@example.invalid',
    '000-0000',
    null,
    '{"street":"Transportgatan 3","postalCode":"000 13","city":"UAT-staden","country":"SE"}'::jsonb,
    '5710'
  )
on conflict do nothing;
