-- LT Studio shared UAT foundation for Supabase/PostgreSQL.
-- Synthetic data only. This migration is intentionally additive and is not wired
-- into runtime until the PostgreSQL adapter and isolation tests are green.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  org_number text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_number text not null,
  name text not null,
  org_number text,
  email text,
  address_json jsonb not null default '{}'::jsonb,
  customer_type text not null default 'business'
    check (customer_type in ('business','consumer','public-body')),
  reminder_fee_agreed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, customer_number)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_number text not null,
  name text not null,
  org_number text,
  email text,
  bankgiro text,
  plusgiro text,
  default_cost_account text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, supplier_number)
);

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null,
  posting_date date not null,
  due_date date not null,
  total_ore bigint not null,
  remaining_ore bigint not null,
  vat_ore bigint not null default 0,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_number)
);

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_invoice_number text not null,
  invoice_date date not null,
  due_date date not null,
  total_ore bigint not null check (total_ore > 0),
  vat_ore bigint not null default 0 check (vat_ore >= 0),
  currency text not null default 'SEK',
  vat_treatment text,
  status text not null check (status in ('registered','coding-review','coded','approved','payment-prepared','paid','rejected')),
  coding_json jsonb not null default '[]'::jsonb,
  coding_sha256 text,
  document_name text,
  document_mime text,
  document_sha256 text,
  registered_by uuid references public.app_users(id) on delete restrict,
  approved_by uuid references public.app_users(id) on delete restrict,
  approved_at timestamptz,
  liability_accounting_entry_id uuid,
  liability_posted_at timestamptz,
  open_amount_ore bigint not null default 0 check (open_amount_ore >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, supplier_id, supplier_invoice_number)
);

create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year text not null,
  series text not null,
  sequence integer not null check (sequence > 0),
  number text not null,
  posting_date date not null,
  description text not null,
  source_type text not null,
  source_id text not null,
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (company_id, series, fiscal_year, sequence),
  unique (company_id, source_type, source_id)
);

create table if not exists public.accounting_entry_lines (
  entry_id uuid not null references public.accounting_entries(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  account text not null,
  line_text text not null default '',
  debit_ore bigint not null default 0 check (debit_ore >= 0),
  credit_ore bigint not null default 0 check (credit_ore >= 0),
  primary key (entry_id, line_number),
  check ((debit_ore > 0 and credit_ore = 0) or (credit_ore > 0 and debit_ore = 0))
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  object_path text not null,
  file_name text not null,
  sha256 text not null check (char_length(sha256) = 64),
  size_bytes bigint not null check (size_bytes >= 0),
  content_type text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, object_path)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid references public.app_users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_customers_company on public.customers(company_id);
create index if not exists idx_suppliers_company on public.suppliers(company_id);
create index if not exists idx_customer_invoices_company on public.customer_invoices(company_id);
create index if not exists idx_supplier_invoices_company on public.supplier_invoices(company_id);
create index if not exists idx_accounting_entries_company_date on public.accounting_entries(company_id, posting_date, series, sequence);
create index if not exists idx_documents_company on public.documents(company_id);
create index if not exists idx_audit_events_company_created on public.audit_events(company_id, created_at desc);

alter table public.companies enable row level security;
alter table public.app_users enable row level security;
alter table public.company_memberships enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.customer_invoices enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.accounting_entries enable row level security;
alter table public.accounting_entry_lines enable row level security;
alter table public.documents enable row level security;
alter table public.audit_events enable row level security;

-- No permissive browser policies are created here. The initial shared-UAT adapter
-- must access the database server-side and prove tenant isolation before runtime cutover.
