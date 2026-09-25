-- Applied to Supabase UAT on 2026-09-25.
-- GitHub is source of truth for this schema.

create table if not exists public.suppliers (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  supplier_number text not null,
  name text not null,
  org_number text,
  email text,
  bankgiro text,
  plusgiro text,
  address_json jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, supplier_number),
  unique(company_id, id)
);

create table if not exists public.supplier_invoices (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  supplier_id text not null,
  supplier_invoice_number text not null,
  invoice_date date not null,
  due_date date not null,
  posting_date date not null,
  total_ore bigint not null,
  vat_ore bigint not null default 0,
  remaining_ore bigint not null,
  status text not null default 'draft',
  payment_reference text,
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-fA-F]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, supplier_id) references public.suppliers(company_id, id),
  unique(company_id, supplier_invoice_number),
  unique(company_id, id)
);

create table if not exists public.journal_entries (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  series text not null default 'A',
  journal_number text not null,
  posting_date date not null,
  description text not null,
  source_type text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id, series, journal_number),
  unique(company_id, id)
);

create table if not exists public.journal_lines (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  journal_entry_id text not null,
  line_number integer not null check (line_number > 0),
  account text not null,
  description text,
  debit_ore bigint not null default 0 check (debit_ore >= 0),
  credit_ore bigint not null default 0 check (credit_ore >= 0),
  created_at timestamptz not null default now(),
  check ((debit_ore = 0) <> (credit_ore = 0)),
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id) on delete restrict,
  unique(company_id, journal_entry_id, line_number)
);

create table if not exists public.documents (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  object_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  source_type text,
  source_id text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id, object_path)
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  company_id text references public.companies(id) on delete restrict,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suppliers enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.documents enable row level security;
alter table public.audit_events enable row level security;

create index if not exists suppliers_company_idx on public.suppliers(company_id);
create index if not exists supplier_invoices_company_idx on public.supplier_invoices(company_id);
create index if not exists supplier_invoices_supplier_fk_idx on public.supplier_invoices(company_id, supplier_id);
create index if not exists journal_entries_company_idx on public.journal_entries(company_id, posting_date);
create index if not exists journal_entries_created_by_idx on public.journal_entries(created_by);
create index if not exists journal_lines_entry_idx on public.journal_lines(company_id, journal_entry_id);
create index if not exists documents_company_idx on public.documents(company_id);
create index if not exists documents_uploaded_by_idx on public.documents(uploaded_by);
create index if not exists audit_events_company_created_idx on public.audit_events(company_id, created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id);

create policy "members can read company suppliers" on public.suppliers for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id = suppliers.company_id and m.auth_user_id = (select auth.uid())));

create policy "members can read company supplier invoices" on public.supplier_invoices for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id = supplier_invoices.company_id and m.auth_user_id = (select auth.uid())));

create policy "members can read company journal entries" on public.journal_entries for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id = journal_entries.company_id and m.auth_user_id = (select auth.uid())));

create policy "members can read company journal lines" on public.journal_lines for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id = journal_lines.company_id and m.auth_user_id = (select auth.uid())));

create policy "members can read company documents" on public.documents for select to authenticated
using (exists (select 1 from public.company_memberships m where m.company_id = documents.company_id and m.auth_user_id = (select auth.uid())));

create policy "members can read company audit events" on public.audit_events for select to authenticated
using (company_id is not null and exists (
  select 1 from public.company_memberships m
  where m.company_id = audit_events.company_id
    and m.auth_user_id = (select auth.uid())
    and m.role = 'admin'
));

revoke insert, update, delete on public.audit_events from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['customers','invoices','invoice_transactions','suppliers','supplier_invoices','journal_entries','journal_lines','documents'] loop
    execute format('drop policy if exists %I on public.%I', 'members can write company ' || t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant'')))', 'accounting members can insert company ' || t, t, t);
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant''))) with check (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant'')))', 'accounting members can update company ' || t, t, t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.company_memberships m where m.company_id = %I.company_id and m.auth_user_id = (select auth.uid()) and m.role in (''admin'',''accountant'')))', 'accounting members can delete company ' || t, t, t);
  end loop;
end $$;
