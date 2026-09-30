-- Safe synthetic invoice identity for the shared Supabase UAT company.
-- These values must never be reused in production.
-- UAT invoices are also watermarked "DEMO – INTE BETALNINGSUNDERLAG" by the frontend.
--
-- Live-history compatibility: the UAT company existed before this migration in the
-- hosted project. On a clean rebuild the synthetic company is created later by the
-- seed, so skip this data-only upsert until that seed runs.

do $uat_invoice_settings$
begin
  if exists(select 1 from public.companies where id='uat-lt-studio') then
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
  end if;
end
$uat_invoice_settings$;
