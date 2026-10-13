-- Synthetic rollback-only regression for bank direction and provenance.
-- No hosted data is read or changed by this test.
begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_column('public','bank_payments','direction','bank events expose explicit direction');
select has_column('public','bank_payments','direction_source','bank direction records a source');
select has_column('public','bank_payments','direction_source_reference','bank direction records a source reference');
select has_column('public','bank_payments','direction_evidence_sha256','bank direction records evidence integrity');
select has_column('public','bank_payments','direction_verified_at','bank direction records verification time');
select has_column('public','bank_payments','direction_verified','bank direction exposes a generated verification result');

do $fixture$
begin
  perform set_config('app.controlled_financial_write','1',true);

  insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  values('00000000-0000-4000-8000-000000008011','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','pgtap-bank-direction-801@example.invalid',now(),now());

  insert into public.companies(id,legal_name,org_number,display_name)
  values('pgtap-direction-company-a','Synthetic Direction A AB','000000-8011','Synthetic Direction A'),
        ('pgtap-direction-company-b','Synthetic Direction B AB','000000-8012','Synthetic Direction B');

  insert into public.bank_payments(
    id,company_id,external_id,booking_date,amount_ore,currency,status,created_by
  ) values
    ('pgtap-direction-bank-unknown','pgtap-direction-company-a','synthetic-direction-unknown',
      '2026-10-13',10000,'SEK','unmatched','00000000-0000-4000-8000-000000008011'),
    ('pgtap-direction-bank-other-tenant','pgtap-direction-company-b','synthetic-direction-other',
      '2026-10-13',10000,'SEK','unmatched','00000000-0000-4000-8000-000000008011');

  insert into public.bank_payments(
    id,company_id,external_id,booking_date,amount_ore,currency,status,created_by,
    direction,direction_source,direction_source_reference,direction_evidence_sha256,direction_verified_at
  ) values(
    'pgtap-direction-bank-incoming','pgtap-direction-company-a','synthetic-direction-incoming',
    '2026-10-13',25000,'SEK','unmatched','00000000-0000-4000-8000-000000008011',
    'incoming','synthetic-bank-import','event-801-incoming',repeat('a',64),now()
  );
end;
$fixture$;

select is(
  (select direction from public.bank_payments where id='pgtap-direction-bank-unknown'),
  'unknown','legacy-compatible inserts default to unknown instead of guessing from a positive amount'
);

select is(
  (select direction_verified from public.bank_payments where id='pgtap-direction-bank-unknown'),
  false,'unknown direction fails closed'
);

select is(
  (select direction_verified from public.bank_payments where id='pgtap-direction-bank-incoming'),
  true,'incoming direction with complete source evidence is verified'
);

select is(
  (select direction from public.bank_payments where id='pgtap-direction-bank-other-tenant'),
  'unknown','a separate tenant receives the same fail-closed default'
);

select throws_ok(
  $$update public.bank_payments
      set direction='outgoing'
      where id='pgtap-direction-bank-unknown'$$,
  '23514',null,
  'a known direction without provenance is rejected'
);

select throws_ok(
  $$update public.bank_payments
      set direction_source='synthetic-import',
          direction_source_reference='event-801-partial'
      where id='pgtap-direction-bank-unknown'$$,
  '23514',null,
  'partial provenance is rejected'
);

select throws_ok(
  $$update public.bank_payments
      set direction='outgoing',
          direction_source='synthetic-import',
          direction_source_reference='event-801-invalid-hash',
          direction_evidence_sha256='NOT-A-SHA256',
          direction_verified_at=now()
      where id='pgtap-direction-bank-unknown'$$,
  '23514',null,
  'non-canonical direction evidence hash is rejected'
);

select lives_ok(
  $$update public.bank_payments
      set direction='outgoing',
          direction_source='synthetic-import',
          direction_source_reference='event-801-outgoing',
          direction_evidence_sha256=repeat('b',64),
          direction_verified_at=now()
      where id='pgtap-direction-bank-unknown'$$,
  'complete outgoing provenance is accepted'
);

select * from finish();
rollback;
