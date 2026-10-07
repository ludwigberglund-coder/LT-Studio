-- Fresh rebuild Advisor parity.
-- Captures already-verified hosted definitions so a clean GitHub rebuild matches production.
-- No authorization scope is broadened: only equivalent policy forms and missing covering indexes are restored.
-- 2026-10-07.

CREATE INDEX IF NOT EXISTS accounting_periods_locked_by_idx ON public.accounting_periods USING btree (locked_by);

CREATE INDEX IF NOT EXISTS company_invoice_settings_updated_by_idx ON public.company_invoice_settings USING btree (updated_by);

CREATE INDEX IF NOT EXISTS customer_credit_adjustments_created_by_idx ON public.customer_invoice_credit_adjustments USING btree (created_by);

CREATE INDEX IF NOT EXISTS customer_credit_refunds_accounting_entry_idx ON public.customer_credit_refunds USING btree (company_id, accounting_entry_id);

CREATE INDEX IF NOT EXISTS customer_credit_refunds_created_by_idx ON public.customer_credit_refunds USING btree (created_by);

CREATE INDEX IF NOT EXISTS customer_invoice_drafts_user_idx ON public.customer_invoice_drafts USING btree (user_id);

CREATE INDEX IF NOT EXISTS customer_invoice_reservations_issued_idx ON public.customer_invoice_number_reservations USING btree (company_id, issued_invoice_id);

CREATE INDEX IF NOT EXISTS customer_payment_reclass_proposal_idx ON public.customer_payment_reclassifications USING btree (company_id, original_proposal_id);

drop policy if exists "accounting members delete accounting periods" on public.accounting_periods;

drop policy if exists "accounting members insert accounting periods" on public.accounting_periods;

drop policy if exists "accounting members update accounting periods" on public.accounting_periods;

drop policy if exists "accounting members delete accounting sequences" on public.accounting_sequences;

drop policy if exists "accounting members insert accounting sequences" on public.accounting_sequences;

drop policy if exists "accounting members update accounting sequences" on public.accounting_sequences;

drop policy if exists "accounting members delete invoice reservations" on public.customer_invoice_number_reservations;

drop policy if exists "accounting members insert invoice reservations" on public.customer_invoice_number_reservations;

drop policy if exists "accounting members update invoice reservations" on public.customer_invoice_number_reservations;

drop policy if exists "accounting members delete supplier payments" on public.supplier_payments;

drop policy if exists "accounting members insert supplier payments" on public.supplier_payments;

drop policy if exists "accounting members update supplier payments" on public.supplier_payments;

drop policy if exists "accounting members manage accounting periods" on public.accounting_periods;

drop policy if exists "accounting members manage accounting sequences" on public.accounting_sequences;

drop policy if exists "accounting members manage invoice reservations" on public.customer_invoice_number_reservations;

drop policy if exists "accounting members manage supplier payments" on public.supplier_payments;

create policy "accounting members delete accounting periods" on public.accounting_periods for delete to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_periods.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members insert accounting periods" on public.accounting_periods for insert to authenticated
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_periods.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members update accounting periods" on public.accounting_periods for update to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_periods.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_periods.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members delete accounting sequences" on public.accounting_sequences for delete to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_sequences.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members insert accounting sequences" on public.accounting_sequences for insert to authenticated
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_sequences.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members update accounting sequences" on public.accounting_sequences for update to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_sequences.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = accounting_sequences.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members delete invoice reservations" on public.customer_invoice_number_reservations for delete to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = customer_invoice_number_reservations.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members insert invoice reservations" on public.customer_invoice_number_reservations for insert to authenticated
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = customer_invoice_number_reservations.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members update invoice reservations" on public.customer_invoice_number_reservations for update to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = customer_invoice_number_reservations.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = customer_invoice_number_reservations.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members delete supplier payments" on public.supplier_payments for delete to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_payments.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members insert supplier payments" on public.supplier_payments for insert to authenticated
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_payments.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

create policy "accounting members update supplier payments" on public.supplier_payments for update to authenticated
using ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_payments.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))))
with check ((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_payments.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))));

alter policy "controlled authenticated audit inserts" on public.audit_events
with check ((( SELECT lt_security.setting_is_one('app.audit_event_write'::text) AS setting_is_one) AND (actor_user_id = ( SELECT auth.uid() AS uid)) AND (company_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = audit_events.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'approver'::text])))))));

alter policy "members delete financial batch lines" on public.financial_batch_lines
using ((EXISTS ( SELECT 1
   FROM ((financial_batch_transactions t
     JOIN financial_batches b ON (((b.company_id = t.company_id) AND (b.id = t.batch_id))))
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((t.company_id = financial_batch_lines.company_id) AND (t.id = financial_batch_lines.transaction_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))));

alter policy "members insert financial batch lines" on public.financial_batch_lines
with check ((EXISTS ( SELECT 1
   FROM ((financial_batch_transactions t
     JOIN financial_batches b ON (((b.company_id = t.company_id) AND (b.id = t.batch_id))))
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((t.company_id = financial_batch_lines.company_id) AND (t.id = financial_batch_lines.transaction_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))));

alter policy "members update financial batch lines" on public.financial_batch_lines
using ((EXISTS ( SELECT 1
   FROM ((financial_batch_transactions t
     JOIN financial_batches b ON (((b.company_id = t.company_id) AND (b.id = t.batch_id))))
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((t.company_id = financial_batch_lines.company_id) AND (t.id = financial_batch_lines.transaction_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))))
with check ((EXISTS ( SELECT 1
   FROM ((financial_batch_transactions t
     JOIN financial_batches b ON (((b.company_id = t.company_id) AND (b.id = t.batch_id))))
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((t.company_id = financial_batch_lines.company_id) AND (t.id = financial_batch_lines.transaction_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))));

alter policy "members delete financial batch transactions" on public.financial_batch_transactions
using ((EXISTS ( SELECT 1
   FROM (financial_batches b
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((b.company_id = financial_batch_transactions.company_id) AND (b.id = financial_batch_transactions.batch_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))));

alter policy "members insert financial batch transactions" on public.financial_batch_transactions
with check ((EXISTS ( SELECT 1
   FROM (financial_batches b
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((b.company_id = financial_batch_transactions.company_id) AND (b.id = financial_batch_transactions.batch_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))));

alter policy "members update financial batch transactions" on public.financial_batch_transactions
using ((EXISTS ( SELECT 1
   FROM (financial_batches b
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((b.company_id = financial_batch_transactions.company_id) AND (b.id = financial_batch_transactions.batch_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))))
with check ((EXISTS ( SELECT 1
   FROM (financial_batches b
     JOIN company_memberships m ON (((m.company_id = b.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))
  WHERE ((b.company_id = financial_batch_transactions.company_id) AND (b.id = financial_batch_transactions.batch_id) AND ((b.kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one))))));

alter policy "members insert financial batches" on public.financial_batches
with check ((((kind = 'manual'::text) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = financial_batches.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))) OR ((kind = 'source'::text) AND ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = financial_batches.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text]))))))));

alter policy "members update financial batches" on public.financial_batches
using (((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = financial_batches.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'approver'::text]))))) AND ((kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one) OR ( SELECT lt_security.setting_is_one('app.financial_batch_approval'::text) AS setting_is_one))))
with check (((EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = financial_batches.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'approver'::text]))))) AND ((kind = 'manual'::text) OR ( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one) OR ( SELECT lt_security.setting_is_one('app.financial_batch_approval'::text) AS setting_is_one))));

alter policy "members create invoice comments" on public.invoice_comments
with check ((( SELECT lt_security.setting_is_one('app.invoice_comment_write'::text) AS setting_is_one) AND ( SELECT lt_security.request_has_aal2_personal_session() AS request_has_aal2_personal_session) AND true AND (author_user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = invoice_comments.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'approver'::text])))))));

alter policy "accountants create invoice reminders" on public.invoice_reminders
with check ((( SELECT lt_security.setting_is_one('app.invoice_reminder_write'::text) AS setting_is_one) AND ( SELECT lt_security.request_has_aal2_personal_session() AS request_has_aal2_personal_session) AND true AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = invoice_reminders.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))));

alter policy "controlled insert supplier invoice date corrections" on public.supplier_invoice_date_corrections
with check ((( SELECT lt_security.setting_is_one('app.system_batch_stage'::text) AS setting_is_one) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_invoice_date_corrections.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))));

alter policy "controlled update supplier invoice date corrections" on public.supplier_invoice_date_corrections
using ((( SELECT lt_security.setting_is_one('app.financial_batch_approval'::text) AS setting_is_one) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_invoice_date_corrections.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'approver'::text])))))))
with check ((( SELECT lt_security.setting_is_one('app.financial_batch_approval'::text) AS setting_is_one) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = supplier_invoice_date_corrections.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'approver'::text])))))));

alter policy "controlled website cms revision writes" on public.website_cms_revisions
with check ((( SELECT lt_security.setting_is_one('app.website_cms_write'::text) AS setting_is_one) AND (published_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM company_memberships m
  WHERE ((m.company_id = website_cms_revisions.company_id) AND (m.auth_user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::text, 'accountant'::text])))))));

do $$
declare
  v_old_manage integer;
  v_direct_app_setting integer;
  v_split_count integer;
begin
  select count(*) into v_old_manage
  from pg_policies
  where schemaname='public'
    and policyname in (
      'accounting members manage accounting periods',
      'accounting members manage accounting sequences',
      'accounting members manage invoice reservations',
      'accounting members manage supplier payments'
    );
  if v_old_manage <> 0 then
    raise exception 'ADVISOR_PARITY_EXPECTED_0_OLD_MANAGE_POLICIES_GOT_%',v_old_manage;
  end if;

  select count(*) into v_split_count
  from pg_policies
  where schemaname='public'
    and policyname in (
      'accounting members insert accounting periods',
      'accounting members update accounting periods',
      'accounting members delete accounting periods',
      'accounting members insert accounting sequences',
      'accounting members update accounting sequences',
      'accounting members delete accounting sequences',
      'accounting members insert invoice reservations',
      'accounting members update invoice reservations',
      'accounting members delete invoice reservations',
      'accounting members insert supplier payments',
      'accounting members update supplier payments',
      'accounting members delete supplier payments'
    );
  if v_split_count <> 12 then
    raise exception 'ADVISOR_PARITY_EXPECTED_12_SPLIT_POLICIES_GOT_%',v_split_count;
  end if;

  select count(*) into v_direct_app_setting
  from pg_policies
  where schemaname='public'
    and not (
      tablename='financial_batch_events'
      and policyname='members write financial batch events'
    )
    and (
      coalesce(qual,'') like '%current_setting(''app.%'
      or coalesce(with_check,'') like '%current_setting(''app.%'
    );
  if v_direct_app_setting <> 0 then
    raise exception 'ADVISOR_PARITY_EXPECTED_0_DIRECT_APP_SETTINGS_GOT_%',v_direct_app_setting;
  end if;
end;
$$;
