-- Optional Commerce OS Local Agent observability tables.
-- Run this only after production schema approval. The local agent works with
-- local JSON files when these tables are absent.

create table if not exists public.commerce_os_local_agent_heartbeats (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  observed_at timestamptz not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.commerce_os_local_agent_diagnostics (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  diagnostic_id text not null unique,
  observed_at timestamptz not null,
  goods_key text,
  url text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists commerce_os_local_agent_heartbeats_agent_observed_idx
  on public.commerce_os_local_agent_heartbeats (agent_id, observed_at desc);

create index if not exists commerce_os_local_agent_diagnostics_agent_observed_idx
  on public.commerce_os_local_agent_diagnostics (agent_id, observed_at desc);

alter table public.commerce_os_local_agent_heartbeats enable row level security;
alter table public.commerce_os_local_agent_diagnostics enable row level security;

revoke all on public.commerce_os_local_agent_heartbeats from anon, authenticated;
revoke all on public.commerce_os_local_agent_diagnostics from anon, authenticated;

grant select, insert on public.commerce_os_local_agent_heartbeats to service_role;
grant select, insert on public.commerce_os_local_agent_diagnostics to service_role;

comment on table public.commerce_os_local_agent_heartbeats is
  'Optional owner-private heartbeat sink for the Windows Commerce OS Local Agent.';

comment on table public.commerce_os_local_agent_diagnostics is
  'Optional owner-private diagnostic sink for read-only Shopling/A21 failure packages.';
