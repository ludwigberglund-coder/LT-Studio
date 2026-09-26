-- Synthetic-only shared UAT seed for Supabase.
-- Never replace these identities with real customers or credentials.

begin;

insert into public.companies(id,legal_name,org_number,display_name,created_at)
values
  ('company_11111111-1111-4111-8111-111111111111','Synthetic Staging Company Alpha','000000-0000','Synthetic Alpha',now()),
  ('company_22222222-2222-4222-8222-222222222222','Synthetic Staging Company Beta','000000-0018','Synthetic Beta',now())
on conflict (id) do nothing;

insert into public.customers(
  id,company_id,customer_number,name,org_number,email,address_json,customer_type,reminder_fee_agreed,created_at,updated_at
)
values
  ('customer_11111111-1111-4111-8111-111111111101','company_11111111-1111-4111-8111-111111111111','K-1001','Synthetic Alpha Customer AB','000000-1101','alpha-customer@example.invalid','{"street":"Syntetgatan 1","postalCode":"000 00","city":"Teststad"}'::jsonb,'business',true,now(),now()),
  ('customer_22222222-2222-4222-8222-222222222201','company_22222222-2222-4222-8222-222222222222','K-2001','Synthetic Beta Customer AB','000000-2201','beta-customer@example.invalid','{"street":"Testvägen 2","postalCode":"000 00","city":"Teststad"}'::jsonb,'business',false,now(),now())
on conflict (id) do nothing;

insert into public.suppliers(
  id,company_id,supplier_number,name,org_number,email,bankgiro,plusgiro,default_cost_account,created_at,updated_at
)
values
  ('supplier_11111111-1111-4111-8111-111111111102','company_11111111-1111-4111-8111-111111111111','L-1001','Synthetic Alpha Supplier AB','000000-3101','alpha-supplier@example.invalid','999-1101',null,'4010',now(),now()),
  ('supplier_22222222-2222-4222-8222-222222222202','company_22222222-2222-4222-8222-222222222222','L-2001','Synthetic Beta Supplier AB','000000-3201','beta-supplier@example.invalid','999-2201',null,'4010',now(),now())
on conflict (id) do nothing;

insert into public.customer_invoices(
  id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,
  total_ore,remaining_ore,vat_ore,status,payment_method,payment_account,invoice_account,
  batch_number,journal_number,pdf_sha256,created_at,updated_at
)
values
  ('invoice_11111111-1111-4111-8111-111111111103','company_11111111-1111-4111-8111-111111111111','customer_11111111-1111-4111-8111-111111111101','UAT-A-1001','990011001',current_date,current_date,current_date + 30,125000,125000,25000,'Bokförd','Bankgiro','999-8888','1510',null,null,null,now(),now()),
  ('invoice_22222222-2222-4222-8222-222222222203','company_22222222-2222-4222-8222-222222222222','customer_22222222-2222-4222-8222-222222222201','UAT-B-2001','990022001',current_date,current_date,current_date + 30,75000,75000,15000,'Bokförd','Bankgiro','999-8888','1510',null,null,null,now(),now())
on conflict (id) do nothing;

insert into public.supplier_invoices(
  id,company_id,supplier_id,supplier_invoice_number,invoice_date,due_date,total_ore,vat_ore,
  currency,vat_treatment,status,coding_json,coding_sha256,document_name,document_mime,
  document_sha256,registered_by,approved_by,approved_at,liability_accounting_entry_id,
  liability_posted_at,open_amount_ore,created_at,updated_at
)
values
  ('sinv_11111111-1111-4111-8111-111111111104','company_11111111-1111-4111-8111-111111111111','supplier_11111111-1111-4111-8111-111111111102','SUP-A-1001',current_date,current_date + 20,50000,10000,'SEK','se-domestic-full-input-vat','coded','[{"account":"4010","debitOre":40000},{"account":"2641","debitOre":10000}]'::jsonb,null,null,null,null,null,null,null,null,null,50000,now(),now()),
  ('sinv_22222222-2222-4222-8222-222222222204','company_22222222-2222-4222-8222-222222222222','supplier_22222222-2222-4222-8222-222222222202','SUP-B-2001',current_date,current_date + 20,62500,12500,'SEK','se-domestic-full-input-vat','coded','[{"account":"4010","debitOre":50000},{"account":"2641","debitOre":12500}]'::jsonb,null,null,null,null,null,null,null,null,null,62500,now(),now())
on conflict (id) do nothing;

commit;
