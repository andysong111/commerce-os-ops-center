create table if not exists public.commerce_os_picking_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  snapshot_id text not null,
  source text not null,
  status text not null,
  payload jsonb not null,
  completed jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_os_picking_snapshots_token_active_idx
  on public.commerce_os_picking_snapshots (token_hash, expires_at desc);

alter table public.commerce_os_picking_snapshots enable row level security;
revoke all on public.commerce_os_picking_snapshots from anon, authenticated;
grant select, insert, update, delete on public.commerce_os_picking_snapshots to service_role;

comment on table public.commerce_os_picking_snapshots is
  'Owner-private, token-hashed picking snapshots shared through Commerce OS server routes.';
