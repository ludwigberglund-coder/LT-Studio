-- Shared customer and customer-invoice core.
-- Direct Data API access is intentionally read-only for authenticated users.
-- Financial writes will go through validated server/Edge Function flows in a later stage.

create table public.customers (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  customer_number text not null,
  name text not null,
  org_number text,
  email text,
  address_json jsonb not null default '{}'::jsonb,
  customer_type text not null default 'business'
    check (customer_type in ('business','consumer','public-body')),
  reminder_fee_agreed boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, customer_number),
  unique (company_id, id)
);

create table public.invoices (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  customer_id text not null,
  invoice_number text not null,
  ocr text,
  invoice_date date not null,
  posting_date date not null,
  due_date date not null,
  total_ore bigint not null,
  remaining_ore bigint not null,
  vat_ore bigint not null default 0,
  status text not null,
  payment_method text,
  payment_account text,
  invoice_account text not null default '1510',
  batch_number text,
  journal_number text,
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-fA-F]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_number),
  unique (company_id, id),
  constraint invoices_customer_same_company_fkey
    foreign key (company_id, customer_id)
    references public.customers(company_id, id)
    on delete restrict
);

create table public.invoice_transactions (
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  invoice_id text not null,
  transaction_type text not null,
  payment_method text,
  payment_date date,
  posting_date date,
  batch_number text,
  journal_number text,
  amount_ore bigint,
  approved boolean not null default true,
  account text,
  bank_reference text,
  created_at timestamptz not null default now(),
  unique (company_id, bank_reference),
  constraint invoice_transactions_invoice_same_company_fkey
    foreign key (company_id, invoice_id)
    references public.invoices(company_id, id)
    on delete cascade
);

create index idx_customers_company_archived
  on public.customers(company_id, archived_at, customer_number);

create index idx_invoices_company_due
  on public.invoices(company_id, due_date);

create index idx_invoices_company_customer
  on public.invoices(company_id, customer_id, invoice_date);

create index idx_invoice_transactions_company_invoice
  on public.invoice_transactions(company_id, invoice_id, created_at);

alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_transactions enable row level security;

revoke all on table public.customers from anon;
revoke all on table public.invoices from anon;
revoke all on table public.invoice_transactions from anon;

revoke all on table public.customers from authenticated;
revoke all on table public.invoices from authenticated;
revoke all on table public.invoice_transactions from authenticated;

grant select on table public.customers to authenticated;
grant select on table public.invoices to authenticated;
grant select on table public.invoice_transactions to authenticated;

create policy "members can read company customers"
on public.customers
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.company_memberships m
    where m.company_id = customers.company_id
      and m.auth_user_id = (select auth.uid())
  )
);

create policy "members can read company invoices"
on public.invoices
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.company_memberships m
    where m.company_id = invoices.company_id
      and m.auth_user_id = (select auth.uid())
  )
);

create policy "members can read company invoice transactions"
on public.invoice_transactions
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.company_memberships m
    where m.company_id = invoice_transactions.company_id
      and m.auth_user_id = (select auth.uid())
  )
);
