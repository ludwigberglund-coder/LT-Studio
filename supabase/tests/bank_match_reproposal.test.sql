-- Synthetic, rollback-only end-to-end regression for a rejected bank match.
-- No hosted customer data or permanent payment data is created by these tests.
begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(
  not (select prosecdef from pg_proc
       where oid='public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb)'::regprocedure),
  'bank match RPC remains security invoker'
);

select ok(
  position('app.controlled_financial_write' in pg_get_functiondef(
    'public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb)'::regprocedure
  ))>0,
  'bank match RPC opts into the controlled financial-write guard'
);

select ok(
  position('app.controlled_financial_write' in pg_get_functiondef(
    'public.decide_automation_proposal(text,text,text,text)'::regprocedure
  ))>0,
  'approve/reject RPC opts into the controlled financial-write guard'
);

select ok(
  not has_function_privilege('anon','public.create_bank_match_proposal(text,text,text,integer,boolean,boolean,text,jsonb)','EXECUTE'),
  'anonymous users cannot invoke bank matching'
);

do $fixture$
begin
  perform set_config('app.controlled_financial_write','1',true);
  perform set_config('app.audit_event_write','1',true);

  insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
  values('00000000-0000-4000-8000-000000007261','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','pgtap-bank-match-726@example.invalid',now(),now());

  insert into public.app_users(id,auth_user_id,username,display_name)
  values('pgtap-match-user-726','00000000-0000-4000-8000-000000007261',
    'pgtap-match-726','Synthetic reviewer');

  insert into public.companies(id,legal_name,org_number,display_name)
  values('pgtap-match-company-a','Synthetic Match A AB','000000-7261','Synthetic Match A'),
        ('pgtap-match-company-b','Synthetic Match B AB','000000-7262','Synthetic Match B');

  insert into public.company_memberships(company_id,auth_user_id,user_id,role)
  values('pgtap-match-company-a','00000000-0000-4000-8000-000000007261',
    'pgtap-match-user-726','accountant');

  insert into public.customers(id,company_id,customer_number,name)
  values('pgtap-match-customer-a','pgtap-match-company-a','P726-C1','Synthetic customer A');

  insert into public.invoices(
    id,company_id,customer_id,invoice_number,invoice_date,posting_date,
    due_date,total_ore,remaining_ore,vat_ore,status,invoice_account
  ) values
    ('pgtap-match-invoice-a','pgtap-match-company-a','pgtap-match-customer-a',
      'P726-001','2026-10-01','2026-10-01','2026-10-31',10000,10000,0,'Obetald','1510'),
    ('pgtap-match-invoice-b','pgtap-match-company-a','pgtap-match-customer-a',
      'P726-002','2026-10-01','2026-10-01','2026-10-31',10000,10000,0,'Obetald','1510');

  insert into public.bank_payments(
    id,company_id,external_id,booking_date,value_date,amount_ore,
    currency,reference,status,created_by
  ) values(
    'pgtap-match-bank-726','pgtap-match-company-a','synthetic-bank-match-726',
    '2026-10-05','2026-10-05',10000,'SEK','P726','unmatched',
    '00000000-0000-4000-8000-000000007261'
  );

  perform set_config('app.controlled_financial_write','',true);
  perform set_config('app.audit_event_write','',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000007261',true);
end;
$fixture$;

create temp table pgtap_bank_match_rounds (
  round text primary key,
  proposal_id text not null,
  status text not null,
  duplicate boolean not null
) on commit drop;

insert into pgtap_bank_match_rounds
select 'first',proposal_id,status,duplicate
from public.create_bank_match_proposal(
  'pgtap-match-company-a','pgtap-match-bank-726','pgtap-match-invoice-a',
  500000,false,true,'Synthetic manual invoice A','[]'::jsonb
);

select is(
  (select status from pgtap_bank_match_rounds where round='first'),
  'manual-review','first invoice A match opens manual review'
);

select is(
  (select idempotency_key from public.automation_proposals
   where id=(select proposal_id from pgtap_bank_match_rounds where round='first')),
  'bank-payment-match:pgtap-match-bank-726:v1',
  'first matching round uses historical v1 key'
);

do $reset_guard$
begin
  perform set_config('app.controlled_financial_write','',true);
end;
$reset_guard$;

select is(
  (select status from public.decide_automation_proposal(
    'pgtap-match-company-a',
    (select proposal_id from pgtap_bank_match_rounds where round='first'),
    'reject','Wrong invoice in synthetic test'
  )),
  'rejected','authorized user can reject under the write guard'
);

select is(
  (select status from public.bank_payments where id='pgtap-match-bank-726'),
  'unmatched','rejection returns payment to unplaced queue'
);

insert into pgtap_bank_match_rounds
select 'second',proposal_id,status,duplicate
from public.create_bank_match_proposal(
  'pgtap-match-company-a','pgtap-match-bank-726','pgtap-match-invoice-b',
  500000,false,true,'Synthetic manual invoice B','[]'::jsonb
);

select isnt(
  (select proposal_id from pgtap_bank_match_rounds where round='first'),
  (select proposal_id from pgtap_bank_match_rounds where round='second'),
  'retry against invoice B creates a new proposal'
);

select is(
  (select status from pgtap_bank_match_rounds where round='second'),
  'manual-review','second proposal can be reviewed'
);

select is(
  (select idempotency_key from public.automation_proposals
   where id=(select proposal_id from pgtap_bank_match_rounds where round='second')),
  'bank-payment-match:pgtap-match-bank-726:v2',
  'second round uses a unique v2 key'
);

select is(
  (select status from public.automation_proposals
   where id=(select proposal_id from pgtap_bank_match_rounds where round='first')),
  'rejected','first proposal remains rejected and auditable'
);

select is(
  (select suggestion_json->>'invoiceId' from public.automation_proposals
   where id=(select proposal_id from pgtap_bank_match_rounds where round='second')),
  'pgtap-match-invoice-b','new proposal references the newly selected invoice'
);

insert into pgtap_bank_match_rounds
select 'duplicate',proposal_id,status,duplicate
from public.create_bank_match_proposal(
  'pgtap-match-company-a','pgtap-match-bank-726','pgtap-match-invoice-b',
  500000,false,true,'Synthetic manual invoice B','[]'::jsonb
);

select ok(
  (select proposal_id from pgtap_bank_match_rounds where round='second')
  =(select proposal_id from pgtap_bank_match_rounds where round='duplicate')
  and (select duplicate from pgtap_bank_match_rounds where round='duplicate'),
  'repeating the active match reuses its proposal'
);

select throws_ok(
  $$select * from public.create_bank_match_proposal(
    'pgtap-match-company-a','pgtap-match-bank-726','pgtap-match-invoice-a',
    500000,false,true,'Try to override active invoice','[]'::jsonb)$$,
  'BANK_PAYMENT_ALREADY_PENDING',
  'a different invoice cannot silently replace an active proposal'
);

select throws_ok(
  $$select * from public.create_bank_match_proposal(
    'pgtap-match-company-b','pgtap-match-bank-726','pgtap-match-invoice-b',
    500000,false,true,'Cross-company attempt','[]'::jsonb)$$,
  'ACCESS_DENIED',
  'tenant B cannot access tenant A bank matches'
);

select is(
  (select count(*)::integer from public.customer_payment_executions
   where company_id='pgtap-match-company-a'),
  0::integer,'creating and rejecting proposals never posts a customer payment'
);

select * from finish();
rollback;
