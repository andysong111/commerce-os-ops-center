-- Reduce inventory stock-control read amplification by exposing only the latest
-- successful Tail snapshot for each reset event. The append-only source ledger is
-- preserved unchanged; this is a read-only projection used by the runtime.

create index if not exists commerce_operation_runs_tail_reset_started_idx
on public.commerce_operation_runs (
  (
    coalesce(
      result_snapshot->'snapshot'->>'resetEventId',
      result_snapshot->>'resetEventId'
    )
  ),
  started_at desc,
  source_event_id desc
)
where operation_type = 'INVENTORY_STOCK_SALES_TAIL_EVENT'
  and status = 'SUCCEEDED';

create or replace view public.commerce_inventory_latest_tail_snapshots as
select distinct on (reset_event_id)
  reset_event_id,
  source_event_id,
  result_snapshot,
  started_at,
  status
from (
  select
    coalesce(
      result_snapshot->'snapshot'->>'resetEventId',
      result_snapshot->>'resetEventId'
    ) as reset_event_id,
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
order by reset_event_id, started_at desc, source_event_id desc;

revoke all on public.commerce_inventory_latest_tail_snapshots
from public, anon, authenticated;
grant select on public.commerce_inventory_latest_tail_snapshots to service_role;

notify pgrst, 'reload schema';
