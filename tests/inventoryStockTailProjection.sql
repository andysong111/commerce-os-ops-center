begin;
-- Exercise writes as the actual server role, not only as a database owner.
grant insert, select on public.commerce_operation_runs to service_role;
set local role service_role;
insert into public.commerce_operation_runs (operation_type,status,source_event_id,result_snapshot,started_at)
values
('INVENTORY_STOCK_SALES_TAIL_EVENT','SUCCEEDED','fixture-valid-older-offset',
 '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T10:00:00+09:00","events":[]}}','2026-09-12T01:00:01Z'),
('INVENTORY_STOCK_SALES_TAIL_EVENT','SUCCEEDED','fixture-valid-newer-zulu',
 '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T02:00:00Z","events":[]}}','2026-09-12T02:00:01Z'),
('INVENTORY_STOCK_SALES_TAIL_EVENT','SUCCEEDED','fixture-invalid-newest-barcode',
 '{"snapshot":{"resetEventId":"fixture-reset","barcode":"invalid","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T03:00:00Z"}}','2026-09-12T03:00:01Z'),
('INVENTORY_STOCK_SALES_TAIL_EVENT','SUCCEEDED','fixture-invalid-newest-reset-at',
 '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"not-a-time","analysisAsOf":"2026-09-12T04:00:00Z"}}','2026-09-12T04:00:01Z'),
('INVENTORY_STOCK_SALES_TAIL_EVENT','SUCCEEDED','fixture-invalid-nested-authority',
 '{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T05:00:00Z","snapshot":{"resetEventId":"fixture-reset","barcode":"bad","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T05:00:00Z"}}','2026-09-12T05:00:01Z'),
-- Late arrivals and failed operations cannot displace a newer successful winner.
('INVENTORY_STOCK_SALES_TAIL_EVENT','SUCCEEDED','fixture-late-older',
 '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T01:00:00Z"}}','2026-09-12T06:00:01Z'),
('INVENTORY_STOCK_SALES_TAIL_EVENT','FAILED','fixture-failed-newer',
 '{"snapshot":{"resetEventId":"fixture-reset","barcode":"BAB3-1","resetAt":"2026-09-12T00:00:00Z","analysisAsOf":"2026-09-12T07:00:00Z"}}','2026-09-12T07:00:01Z');

do $$
begin
  if (select source_event_id from public.commerce_inventory_latest_tail_snapshots where reset_event_id='fixture-reset') is distinct from 'fixture-valid-newer-zulu' then
    raise exception 'TAIL_PROJECTION_WRONG_WINNER';
  end if;
  if (select count(*) from public.commerce_inventory_latest_tail_snapshot_cache where reset_event_id='fixture-reset') <> 1 then
    raise exception 'TAIL_CACHE_WINNER_COUNT_INVALID';
  end if;
  if (select count(*) from public.commerce_operation_runs where source_event_id like 'fixture-%') <> 7 then
    raise exception 'TAIL_SOURCE_LEDGER_CHANGED';
  end if;
end;
$$;
reset role;
do $$
declare
  plan json;
begin
  if to_regclass('public.commerce_operation_runs_tail_reset_analysis_ts_idx') is not null then
    raise exception 'TAIL_CACHE_STALE_EXPRESSION_INDEX_PRESENT';
  end if;
  if has_table_privilege('anon','public.commerce_inventory_latest_tail_snapshots','select')
    or has_table_privilege('authenticated','public.commerce_inventory_latest_tail_snapshot_cache','select')
    or has_table_privilege('anon','public.commerce_inventory_latest_tail_snapshot_cache','insert')
    or has_table_privilege('service_role','public.commerce_inventory_latest_tail_snapshot_cache','delete') then
    raise exception 'TAIL_CACHE_PRIVILEGE_REGRESSION';
  end if;
  if exists(select 1 from pg_proc where oid='public.commerce_inventory_cache_latest_tail_snapshot()'::regprocedure and prosecdef) then
    raise exception 'TAIL_CACHE_MUST_USE_INVOKER';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.commerce_inventory_latest_tail_snapshot_cache'::regclass) then
    raise exception 'TAIL_CACHE_RLS_DISABLED';
  end if;
  execute 'explain (format json) select source_event_id,result_snapshot,started_at,status from public.commerce_inventory_latest_tail_snapshots order by started_at limit 10000' into plan;
  if plan::text like '%"Relation Name": "commerce_operation_runs"%' then
    raise exception 'TAIL_READ_RESCANS_HISTORICAL_LEDGER';
  end if;
end;
$$;
rollback;
