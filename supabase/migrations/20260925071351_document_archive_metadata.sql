-- Applied to Supabase UAT on 2026-09-25.
-- Preserve document archive metadata when moving the Documents UI off Node/SQLite.

alter table public.documents
  add column if not exists title text,
  add column if not exists category text not null default 'other'
    check (category in ('customer-invoice','supplier-invoice','receipt','bank','accounting','inventory','other')),
  add column if not exists note text not null default '';

update public.documents
set title=coalesce(nullif(title,''),file_name),
    category=case
      when source_type='customer-invoice' then 'customer-invoice'
      when source_type='supplier-invoice' then 'supplier-invoice'
      else category
    end
where title is null or title='' or category='other';

alter table public.documents alter column title set not null;

create index if not exists documents_company_category_idx
  on public.documents(company_id,category,created_at desc);
