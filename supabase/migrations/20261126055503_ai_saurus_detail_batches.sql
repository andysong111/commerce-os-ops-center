begin;

create table public.ai_saurus_detail_batches (
  id uuid primary key,
  owner_id uuid not null,
  selection_hash text not null check (selection_hash ~ '^[0-9a-f]{64}$'),
  revision integer not null default 0 check (revision >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, selection_hash)
);

create index ai_saurus_detail_batches_owner_updated_idx
  on public.ai_saurus_detail_batches (owner_id, updated_at desc);

alter table public.ai_saurus_detail_batches enable row level security;
revoke all on table public.ai_saurus_detail_batches from public, anon, authenticated;
grant select, insert, update on table public.ai_saurus_detail_batches to service_role;

commit;
