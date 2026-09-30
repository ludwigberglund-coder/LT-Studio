-- Applied to Supabase UAT on 2026-09-25.
-- Prevent direct browser writes to financial core tables.
--
-- Financial RPCs remain SECURITY INVOKER and must opt in per transaction by
-- setting app.controlled_financial_write=1. Direct PostgREST table writes do
-- not have this flag and are rejected by the trigger guard.

create schema if not exists private;

create or replace function private.require_controlled_financial_write()
returns trigger
language plpgsql
security invoker
set search_path=''
as $guard$
begin
  if coalesce(current_setting('app.controlled_financial_write', true),'') <> '1' then
    raise exception 'DIRECT_FINANCIAL_WRITE_BLOCKED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$guard$;

do $block$
declare
  t text;
begin
  foreach t in array array[
    'invoices',
    'invoice_transactions',
    'journal_entries',
    'journal_lines',
    'accounting_sequences',
    'bank_payments',
    'automation_proposals',
    'customer_payment_executions'
  ]
  loop
    execute format('drop trigger if exists controlled_financial_write_guard on public.%I',t);
    execute format(
      'create trigger controlled_financial_write_guard before insert or update or delete on public.%I for each row execute function private.require_controlled_financial_write()',
      t
    );
  end loop;
end
$block$;

do $block$
declare
  f record;
  ddl text;
begin
  for f in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prokind='f'
      and p.proname in (
        'confirm_supplier_payment',
        'execute_customer_payment',
        'finalize_customer_credit',
        'finalize_customer_invoice',
        'post_supplier_invoice_liability',
        'register_customer_credit_refund',
        'import_bank_payment',
        'create_bank_match_proposal',
        'decide_automation_proposal'
      )
  loop
    ddl:=pg_get_functiondef(f.oid);
    if position('app.controlled_financial_write' in ddl)=0 then
      ddl:=regexp_replace(
        ddl,
        E'\nbegin\n',
        E'\nbegin\n  perform set_config(''app.controlled_financial_write'',''1'',true);\n',
        ''
      );
      execute ddl;
    end if;
  end loop;
end
$block$;
