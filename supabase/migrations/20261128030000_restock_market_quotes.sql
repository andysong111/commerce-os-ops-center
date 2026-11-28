create table public.receipt_restock_market_quotes (
  owner_id uuid not null,
  barcode text not null check (barcode ~ '^B[A-Z]{1,2}[0-9]+-[0-9]+$'),
  ticket uuid not null unique,
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  targets jsonb,
  result jsonb,
  primary key (owner_id, barcode)
);
alter table public.receipt_restock_market_quotes enable row level security;
revoke all on public.receipt_restock_market_quotes from public, anon, authenticated;
grant select, insert, update on public.receipt_restock_market_quotes to service_role;
create index receipt_restock_market_quotes_pending
  on public.receipt_restock_market_quotes (owner_id, requested_at) where finished_at is null;
