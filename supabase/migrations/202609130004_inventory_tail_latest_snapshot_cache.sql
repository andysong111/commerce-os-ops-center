-- Replace the expensive latest-Tail projection with a cache-backed projection.
--
-- The append-only commerce_operation_runs ledger remains the source of truth.
-- This table stores only the latest valid successful Tail snapshot per reset event
-- so the 30-second stock-control poll does not re-parse the full Tail history.

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
from public, anon, authenticated;
grant select on public.commerce_inventory_latest_tail_snapshot_cache to service_role;

-- One-time convergence from the existing validated projection. This may scan the
-- historical Tail ledger once during rollout; steady-state reads will not.
with current_projection as (
  select
    reset_event_id,
    source_event_id,
    result_snapshot,
    started_at,
    status,
    case
      when jsonb_typeof(result_snapshot->'snapshot') = 'object'
        and result_snapshot->'snapshot' <> '{}'::jsonb
        then result_snapshot->'snapshot'
      else result_snapshot
    end as snapshot_payload
  from public.commerce_inventory_latest_tail_snapshots
)
insert into public.commerce_inventory_latest_tail_snapshot_cache (
  reset_event_id,
  source_event_id,
  result_snapshot,
  started_at,
  status,
  analysis_at,
  cached_at
)
select
  reset_event_id,
  source_event_id,
  result_snapshot,
  started_at,
  status,
  public.commerce_inventory_try_iso_timestamptz(snapshot_payload->>'analysisAsOf'),
  now()
from current_projection
where public.commerce_inventory_try_iso_timestamptz(snapshot_payload->>'analysisAsOf') is not null
on conflict (reset_event_id) do update
set
  source_event_id = excluded.source_event_id,
  result_snapshot = excluded.result_snapshot,
  started_at = excluded.started_at,
  status = excluded.status,
  analysis_at = excluded.analysis_at,
  cached_at = excluded.cached_at
where (
  excluded.analysis_at,
  excluded.started_at,
  excluded.source_event_id
) > (
  public.commerce_inventory_latest_tail_snapshot_cache.analysis_at,
  public.commerce_inventory_latest_tail_snapshot_cache.started_at,
  public.commerce_inventory_latest_tail_snapshot_cache.source_event_id
);

create or replace function public.commerce_inventory_cache_latest_tail_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  snapshot_payload jsonb;
  reset_event_id_norm text;
  barcode_norm text;
  reset_at_ts timestamptz;
  analysis_at_ts timestamptz;
begin
  if new.operation_type <> 'INVENTORY_STOCK_SALES_TAIL_EVENT'
    or new.status <> 'SUCCEEDED'
  then
    return new;
  end if;

  snapshot_payload := case
    when jsonb_typeof(new.result_snapshot->'snapshot') = 'object'
      and new.result_snapshot->'snapshot' <> '{}'::jsonb
      then new.result_snapshot->'snapshot'
    else new.result_snapshot
  end;

  reset_event_id_norm := btrim(normalize(snapshot_payload->>'resetEventId', NFKC));
  barcode_norm := upper(
    regexp_replace(
      translate(
        normalize(snapshot_payload->>'barcode', NFKC),
        '‐‑‒–—−',
        '------'
      ),
      '[[:space:]]+',
      '',
      'g'
    )
  );
  reset_at_ts := public.commerce_inventory_try_iso_timestamptz(
    snapshot_payload->>'resetAt'
  );
  analysis_at_ts := public.commerce_inventory_try_iso_timestamptz(
    snapshot_payload->>'analysisAsOf'
  );

  if reset_event_id_norm is null
    or reset_event_id_norm = ''
    or barcode_norm is null
    or barcode_norm !~ '^B[A-Z]{1,2}[0-9]+-[0-9]+$'
    or reset_at_ts is null
    or analysis_at_ts is null
  then
    return new;
  end if;

  insert into public.commerce_inventory_latest_tail_snapshot_cache (
    reset_event_id,
    source_event_id,
    result_snapshot,
    started_at,
    status,
    analysis_at,
    cached_at
  ) values (
    reset_event_id_norm,
    new.source_event_id,
    new.result_snapshot,
    new.started_at,
    new.status,
    analysis_at_ts,
    now()
  )
  on conflict (reset_event_id) do update
  set
    source_event_id = excluded.source_event_id,
    result_snapshot = excluded.result_snapshot,
    started_at = excluded.started_at,
    status = excluded.status,
    analysis_at = excluded.analysis_at,
    cached_at = excluded.cached_at
  where (
    excluded.analysis_at,
    excluded.started_at,
    excluded.source_event_id
  ) > (
    public.commerce_inventory_latest_tail_snapshot_cache.analysis_at,
    public.commerce_inventory_latest_tail_snapshot_cache.started_at,
    public.commerce_inventory_latest_tail_snapshot_cache.source_event_id
  );

  return new;
end;
$$;

revoke all on function public.commerce_inventory_cache_latest_tail_snapshot()
from public, anon, authenticated;

drop trigger if exists commerce_inventory_latest_tail_snapshot_cache_trigger
on public.commerce_operation_runs;

create trigger commerce_inventory_latest_tail_snapshot_cache_trigger
after insert on public.commerce_operation_runs
for each row
when (
  new.operation_type = 'INVENTORY_STOCK_SALES_TAIL_EVENT'
  and new.status = 'SUCCEEDED'
)
execute function public.commerce_inventory_cache_latest_tail_snapshot();

-- The old expression index existed only to accelerate the dynamic view. It is no
-- longer on the hot read path and would add avoidable work to each ledger insert.
drop index if exists public.commerce_operation_runs_tail_reset_analysis_ts_idx;

drop view public.commerce_inventory_latest_tail_snapshots;

create view public.commerce_inventory_latest_tail_snapshots
with (security_invoker = true)
as
select
  reset_event_id,
  source_event_id,
  result_snapshot,
  started_at,
  status
from public.commerce_inventory_latest_tail_snapshot_cache;

revoke all on public.commerce_inventory_latest_tail_snapshots
from public, anon, authenticated;
grant select on public.commerce_inventory_latest_tail_snapshots to service_role;

notify pgrst, 'reload schema';
