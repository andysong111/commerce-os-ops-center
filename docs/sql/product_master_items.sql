-- DRAFT ONLY: proposed Product Master schema for a future Supabase/Postgres PR.
-- This file is documentation and is not wired to a migration runner or database.
-- Review duplicate model numbers and the product/option data model before applying.

create table if not exists product_master_items (
  id text primary key,
  model_no text not null,
  model_name text not null,
  option_name text not null default '',
  barcode text,
  origin text not null default 'MADE IN CHINA',
  display_name text not null,
  memo text,
  product_name_ko text,
  product_name_cn text,
  label_text text,
  image_url text,
  hs_code text,
  category text,
  status text,
  main_image_url text,
  product_memo text,
  product_reference_unit_cost_cny numeric(14, 4),
  option_image_url text,
  reference_unit_cost_cny numeric(14, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint product_master_items_model_no_not_blank
    check (btrim(model_no) <> ''),
  constraint product_master_items_status_check
    check (status is null or status in ('active', 'inactive', 'discontinued'))
);

-- Enforces the proposed one-record-per-model-number rule case-insensitively.
-- Do not apply until existing repeated model numbers/options have been audited.
-- Keeping soft-deleted rows in this index prevents accidental identifier reuse.
create unique index if not exists product_master_items_model_no_unique
  on product_master_items (lower(btrim(model_no)));

-- Optional barcode lookup remains non-unique because barcode assignment and
-- option-sharing rules have not yet been finalized.
create index if not exists product_master_items_barcode_active_idx
  on product_master_items (barcode)
  where deleted_at is null and barcode is not null;

create index if not exists product_master_items_updated_at_active_idx
  on product_master_items (updated_at desc)
  where deleted_at is null;

-- Candidate support for findByText. The future adapter must preserve today's
-- exact-model-first and option-refinement ordering rather than relying only on
-- Postgres full-text rank.
create index if not exists product_master_items_search_active_idx
  on product_master_items using gin (
    to_tsvector(
      'simple',
      coalesce(model_no, '') || ' ' ||
      coalesce(model_name, '') || ' ' ||
      coalesce(option_name, '') || ' ' ||
      coalesce(display_name, '')
    )
  )
  where deleted_at is null;

-- Draft trigger helper. A future migration should place shared helpers in the
-- project's approved schema and naming convention.
create or replace function set_product_master_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_master_items_set_updated_at
  on product_master_items;

create trigger product_master_items_set_updated_at
before update on product_master_items
for each row
execute function set_product_master_items_updated_at();

comment on table product_master_items is
  'DRAFT schema for future Product Master Supabase/Postgres persistence; not connected by this PR.';
comment on column product_master_items.deleted_at is
  'Soft-delete timestamp; normal adapter reads and lookups must exclude non-null rows.';
