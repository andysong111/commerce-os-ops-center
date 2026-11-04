create table if not exists public.shopling_bcode_option_index (
  account_fingerprint text not null,
  barcode text not null,
  goods_key text not null,
  option_id text not null default '',
  partner_goods_code text not null default '',
  product_sale_status_observed text not null default '',
  option_status_observed text not null default '',
  option_quantity_observed text not null default '',
  source text not null,
  refresh_id uuid not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_fingerprint, barcode, goods_key, option_id),
  constraint shopling_bcode_option_index_barcode_check
    check (barcode ~ '^B[A-Z]{2}[0-9]+-[0-9]+$'),
  constraint shopling_bcode_option_index_goods_key_check
    check (goods_key ~ '^[0-9]+$')
);

create index if not exists shopling_bcode_option_index_lookup_idx
  on public.shopling_bcode_option_index (account_fingerprint, barcode, last_seen_at desc);

alter table public.shopling_bcode_option_index enable row level security;
revoke all on table public.shopling_bcode_option_index from public, anon, authenticated;
revoke all on table public.shopling_bcode_option_index from service_role;
grant select, insert, update, delete on table public.shopling_bcode_option_index to service_role;

comment on table public.shopling_bcode_option_index is
  'Read-derived Shopling B-code to goods-key candidates. Every mutation must independently revalidate the exact live B-code through the Shopling API.';
