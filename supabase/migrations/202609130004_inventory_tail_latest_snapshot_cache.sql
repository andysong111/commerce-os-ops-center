-- The append-only ledger remains authoritative. Reads visit one cached row per
-- reset, not every historical JSON snapshot. Install capture BEFORE backfill so
-- concurrent Tail inserts cannot fall into a rollout gap.
create table if not exists public.commerce_inventory_latest_tail_snapshot_cache (
  reset_event_id text primary key,
  source_event_id text not null,
  result_snapshot jsonb not null,
  started_at timestamptz not null,
  status text not null check (status = 'SUCCEEDED'),
  analysis_at timestamptz not null,
  cached_at timestamptz not null default now()
);
alter table public.commerce_inventory_latest_tail_snapshot_cache enable row level security;
revoke all on public.commerce_inventory_latest_tail_snapshot_cache
from public, anon, authenticated, service_role;
-- Only the trusted server role may maintain this derived read model. No DELETE,
-- public policy, SECURITY DEFINER function, or client-side secret is introduced.
grant select, insert, update on public.commerce_inventory_latest_tail_snapshot_cache to service_role;
drop policy if exists inventory_tail_cache_server_only on public.commerce_inventory_latest_tail_snapshot_cache;
create policy inventory_tail_cache_server_only
on public.commerce_inventory_latest_tail_snapshot_cache
for all to service_role using (true) with check (true);

create or replace function public.commerce_inventory_cache_latest_tail_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  payload jsonb;
  reset_id text;
  code text;
  reset_ts timestamptz;
  analysis_ts timestamptz;
begin
  if new.operation_type <> 'INVENTORY_STOCK_SALES_TAIL_EVENT'
    or new.status <> 'SUCCEEDED' then return new; end if;
  payload := case
    when jsonb_typeof(new.result_snapshot->'snapshot') = 'object'
      and new.result_snapshot->'snapshot' <> '{}'::jsonb
      then new.result_snapshot->'snapshot'
    else new.result_snapshot end;
  reset_id := btrim(normalize(payload->>'resetEventId', NFKC));
  code := upper(regexp_replace(translate(normalize(payload->>'barcode', NFKC),
    '‐‑‒–—−', '------'), '[[:space:]]+', '', 'g'));
  reset_ts := public.commerce_inventory_try_iso_timestamptz(payload->>'resetAt');
  analysis_ts := public.commerce_inventory_try_iso_timestamptz(payload->>'analysisAsOf');
  if reset_id is null or reset_id = '' or code is null
    or code !~ '^B[A-Z]{1,2}[0-9]+-[0-9]+$'
    or reset_ts is null or analysis_ts is null then return new; end if;

  insert into public.commerce_inventory_latest_tail_snapshot_cache as existing (
    reset_event_id, source_event_id, result_snapshot, started_at, status, analysis_at, cached_at
  ) values (reset_id, new.source_event_id, new.result_snapshot, new.started_at,
    new.status, analysis_ts, now())
  on conflict (reset_event_id) do update set
    source_event_id = excluded.source_event_id,
    result_snapshot = excluded.result_snapshot,
    started_at = excluded.started_at,
    status = excluded.status,
    analysis_at = excluded.analysis_at,
    cached_at = excluded.cached_at
  where (excluded.analysis_at, excluded.started_at, excluded.source_event_id)
    > (existing.analysis_at, existing.started_at, existing.source_event_id);
  return new;
end;
$$;
revoke all on function public.commerce_inventory_cache_latest_tail_snapshot()
from public, anon, authenticated, service_role;
grant execute on function public.commerce_inventory_cache_latest_tail_snapshot() to service_role;

create or replace trigger commerce_inventory_latest_tail_snapshot_cache_trigger
after insert on public.commerce_operation_runs
for each row
when (new.operation_type = 'INVENTORY_STOCK_SALES_TAIL_EVENT' and new.status = 'SUCCEEDED')
execute function public.commerce_inventory_cache_latest_tail_snapshot();

-- Backfill once. Tuple comparison cannot overwrite a newer concurrent capture.
with current_projection as (
  select reset_event_id, source_event_id, result_snapshot, started_at, status,
    case when jsonb_typeof(result_snapshot->'snapshot') = 'object'
      and result_snapshot->'snapshot' <> '{}'::jsonb then result_snapshot->'snapshot'
      else result_snapshot end as payload
  from public.commerce_inventory_latest_tail_snapshots
)
insert into public.commerce_inventory_latest_tail_snapshot_cache as existing (
  reset_event_id, source_event_id, result_snapshot, started_at, status, analysis_at, cached_at
)
select reset_event_id, source_event_id, result_snapshot, started_at, status,
  public.commerce_inventory_try_iso_timestamptz(payload->>'analysisAsOf'), now()
from current_projection
where public.commerce_inventory_try_iso_timestamptz(payload->>'analysisAsOf') is not null
on conflict (reset_event_id) do update set
  source_event_id = excluded.source_event_id,
  result_snapshot = excluded.result_snapshot,
  started_at = excluded.started_at,
  status = excluded.status,
  analysis_at = excluded.analysis_at,
  cached_at = excluded.cached_at
where (excluded.analysis_at, excluded.started_at, excluded.source_event_id)
  > (existing.analysis_at, existing.started_at, existing.source_event_id);

create or replace view public.commerce_inventory_latest_tail_snapshots
with (security_invoker = true) as
select reset_event_id, source_event_id, result_snapshot, started_at, status
from public.commerce_inventory_latest_tail_snapshot_cache;
revoke all on public.commerce_inventory_latest_tail_snapshots
from public, anon, authenticated, service_role;
grant select on public.commerce_inventory_latest_tail_snapshots to service_role;

-- No historical Tail JSON/time expression is needed in the polling hot path.
drop index if exists public.commerce_operation_runs_tail_reset_analysis_ts_idx;
notify pgrst, 'reload schema';
