-- Reduce inventory stock-control read amplification by exposing only the latest
-- valid successful Tail snapshot for each reset event. The append-only source
-- ledger is preserved unchanged; this is a read-only projection used by runtime.
--
-- Runtime validity is intentionally applied BEFORE DISTINCT ON. Otherwise a newer
-- malformed snapshot could win the database projection and then be discarded by
-- tailSnapshotFrom(), hiding an older valid Tail snapshot that the legacy loader
-- would have retained.

create or replace function public.commerce_inventory_try_iso_timestamptz(value text)
returns timestamptz
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
begin
  -- Tail writers emit ISO-8601 with an explicit UTC/offset zone. Requiring a zone
  -- keeps this immutable parse independent of the database TimeZone setting.
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
  (
    btrim(
      normalize(
        (
          case
            when jsonb_typeof(result_snapshot->'snapshot') = 'object'
              and result_snapshot->'snapshot' <> '{}'::jsonb
              then result_snapshot->'snapshot'
            else result_snapshot
          end
        )->>'resetEventId',
        NFKC
      )
    )
  ),
  (
    public.commerce_inventory_try_iso_timestamptz(
      (
        case
          when jsonb_typeof(result_snapshot->'snapshot') = 'object'
            and result_snapshot->'snapshot' <> '{}'::jsonb
            then result_snapshot->'snapshot'
          else result_snapshot
        end
      )->>'analysisAsOf'
    )
  ) desc,
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
    btrim(normalize(snapshot_payload->>'resetEventId', NFKC)) as reset_event_id,
    upper(
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
    ) as normalized_barcode,
    public.commerce_inventory_try_iso_timestamptz(
      snapshot_payload->>'resetAt'
    ) as reset_at,
    public.commerce_inventory_try_iso_timestamptz(
      snapshot_payload->>'analysisAsOf'
    ) as analysis_at,
    source_event_id,
    result_snapshot,
    started_at,
    status
  from (
    select
      case
        when jsonb_typeof(result_snapshot->'snapshot') = 'object'
          and result_snapshot->'snapshot' <> '{}'::jsonb
          then result_snapshot->'snapshot'
        else result_snapshot
      end as snapshot_payload,
      source_event_id,
      result_snapshot,
      started_at,
      status
    from public.commerce_operation_runs
    where operation_type = 'INVENTORY_STOCK_SALES_TAIL_EVENT'
      and status = 'SUCCEEDED'
  ) as successful_tail_rows
) as validatable_tail_rows
where reset_event_id is not null
  and reset_event_id <> ''
  and normalized_barcode ~ '^B[A-Z]{1,2}[0-9]+-[0-9]+$'
  and reset_at is not null
  and analysis_at is not null
order by reset_event_id, analysis_at desc, started_at desc, source_event_id desc;

revoke all on public.commerce_inventory_latest_tail_snapshots
from public, anon, authenticated;
grant select on public.commerce_inventory_latest_tail_snapshots to service_role;

notify pgrst, 'reload schema';
