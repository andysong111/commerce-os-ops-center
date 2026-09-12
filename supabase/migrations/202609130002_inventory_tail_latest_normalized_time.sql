-- Production correction for the initial latest-Tail projection rollout.
-- Fresh databases already receive the normalized definition in 202609130001;
-- this migration is intentionally idempotent so environments that applied the
-- first rollout before review converge to the same final definition.

create or replace function public.commerce_inventory_try_iso_timestamptz(value text)
returns timestamptz
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
begin
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return null;
  end if;
  begin
    return value::timestamptz;
  exception when others then
    return null;
  end;
end;
$$;

revoke all on function public.commerce_inventory_try_iso_timestamptz(text)
from public, anon, authenticated;
grant execute on function public.commerce_inventory_try_iso_timestamptz(text)
to service_role;

create index if not exists commerce_operation_runs_tail_reset_analysis_ts_idx
on public.commerce_operation_runs (
  (coalesce(result_snapshot->'snapshot'->>'resetEventId', result_snapshot->>'resetEventId')),
  (public.commerce_inventory_try_iso_timestamptz(
    coalesce(result_snapshot->'snapshot'->>'analysisAsOf', result_snapshot->>'analysisAsOf')
  )) desc,
  started_at desc,
  source_event_id desc
)
where operation_type = 'INVENTORY_STOCK_SALES_TAIL_EVENT'
  and status = 'SUCCEEDED'
  and public.commerce_inventory_try_iso_timestamptz(
    coalesce(result_snapshot->'snapshot'->>'analysisAsOf', result_snapshot->>'analysisAsOf')
  ) is not null;

drop index if exists public.commerce_operation_runs_tail_reset_analysis_idx;

create or replace view public.commerce_inventory_latest_tail_snapshots as
select distinct on (reset_event_id)
  reset_event_id,
  source_event_id,
  result_snapshot,
  started_at,
  status
from (
  select
    coalesce(result_snapshot->'snapshot'->>'resetEventId', result_snapshot->>'resetEventId') as reset_event_id,
    public.commerce_inventory_try_iso_timestamptz(
      coalesce(result_snapshot->'snapshot'->>'analysisAsOf', result_snapshot->>'analysisAsOf')
    ) as analysis_at,
    source_event_id,
    result_snapshot,
    started_at,
    status
  from public.commerce_operation_runs
  where operation_type = 'INVENTORY_STOCK_SALES_TAIL_EVENT'
    and status = 'SUCCEEDED'
) as tail_rows
where reset_event_id is not null
  and reset_event_id <> ''
  and analysis_at is not null
order by reset_event_id, analysis_at desc, started_at desc, source_event_id desc;

revoke all on public.commerce_inventory_latest_tail_snapshots
from public, anon, authenticated;
grant select on public.commerce_inventory_latest_tail_snapshots to service_role;

notify pgrst, 'reload schema';
