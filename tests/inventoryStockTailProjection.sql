begin;

-- Offset ordering must be chronological, not lexical. The first row is 01:00Z,
-- the second is 02:00Z and therefore must win even though its raw string differs.
insert into public.commerce_operation_runs (
  operation_type,
  status,
  source_event_id,
  result_snapshot,
  started_at
) values
(
  'INVENTORY_STOCK_SALES_TAIL_EVENT',
  'SUCCEEDED',
  'fixture-valid-older-offset',
  '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00.000Z","analysisAsOf":"2026-09-12T10:00:00+09:00","coverageStartAt":"2026-09-12T00:00:00.000Z","coverageEndAt":"2026-09-12T10:00:00+09:00","events":[]}}'::jsonb,
  '2026-09-12T01:00:01Z'::timestamptz
),
(
  'INVENTORY_STOCK_SALES_TAIL_EVENT',
  'SUCCEEDED',
  'fixture-valid-newer-zulu',
  '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00.000Z","analysisAsOf":"2026-09-12T02:00:00Z","coverageStartAt":"2026-09-12T00:00:00.000Z","coverageEndAt":"2026-09-12T02:00:00Z","events":[]}}'::jsonb,
  '2026-09-12T02:00:01Z'::timestamptz
),
-- A newer malformed snapshot must be filtered BEFORE winner replacement. If it
-- reaches the cache first, it must not suppress the valid predecessor.
(
  'INVENTORY_STOCK_SALES_TAIL_EVENT',
  'SUCCEEDED',
  'fixture-invalid-newest-barcode',
  '{"snapshot":{"resetEventId":"fixture-reset","barcode":"not-a-b-code","resetAt":"2026-09-12T00:00:00.000Z","analysisAsOf":"2026-09-12T03:00:00Z","events":[]}}'::jsonb,
  '2026-09-12T03:00:01Z'::timestamptz
),
(
  'INVENTORY_STOCK_SALES_TAIL_EVENT',
  'SUCCEEDED',
  'fixture-invalid-newest-reset-at',
  '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"not-a-time","analysisAsOf":"2026-09-12T04:00:00Z","events":[]}}'::jsonb,
  '2026-09-12T04:00:01Z'::timestamptz
),
-- A non-empty nested snapshot is the runtime authority. A valid root fallback
-- must not rescue an invalid nested snapshot.
(
  'INVENTORY_STOCK_SALES_TAIL_EVENT',
  'SUCCEEDED',
  'fixture-invalid-nested-authority',
  '{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T05:00:00Z","snapshot":{"resetEventId":"fixture-reset","barcode":"bad","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T05:00:00Z"}}'::jsonb,
  '2026-09-12T05:00:01Z'::timestamptz
);

do $$
declare
  chosen_source text;
  cached_source text;
  winner_count integer;
  cache_count integer;
  stale_index regclass;
begin
  select source_event_id
    into chosen_source
  from public.commerce_inventory_latest_tail_snapshots
  where reset_event_id = 'fixture-reset';

  select count(*)
    into winner_count
  from public.commerce_inventory_latest_tail_snapshots
  where reset_event_id = 'fixture-reset';

  select source_event_id, count(*) over ()
    into cached_source, cache_count
  from public.commerce_inventory_latest_tail_snapshot_cache
  where reset_event_id = 'fixture-reset';

  select to_regclass('public.commerce_operation_runs_tail_reset_analysis_ts_idx')
    into stale_index;

  if chosen_source is distinct from 'fixture-valid-newer-zulu' then
    raise exception
      'TAIL_PROJECTION_WRONG_WINNER: expected fixture-valid-newer-zulu, got %',
      coalesce(chosen_source, '<null>');
  end if;

  if winner_count <> 1 then
    raise exception
      'TAIL_PROJECTION_WINNER_COUNT_INVALID: expected 1, got %',
      winner_count;
  end if;

  if cached_source is distinct from 'fixture-valid-newer-zulu' or cache_count <> 1 then
    raise exception
      'TAIL_CACHE_WRONG_WINNER: expected one fixture-valid-newer-zulu row, got source=% count=%',
      coalesce(cached_source, '<null>'),
      coalesce(cache_count, 0);
  end if;

  if stale_index is not null then
    raise exception
      'TAIL_CACHE_STALE_EXPRESSION_INDEX_PRESENT: %',
      stale_index;
  end if;
end;
$$;

rollback;
