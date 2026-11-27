-- Run only in a disposable database with the two base tables and the migration.
begin;
alter role service_role bypassrls;
grant select, insert, update on public.commerce_operation_runs to service_role;
set local role service_role;
do $$
declare
  h text := repeat('a',64);
  ver timestamptz := now();
  ops jsonb := jsonb_build_array(jsonb_build_object('operationType','STOCK_TEST','sourceEventId','picking-test-count',
    'correlationId','inventory-stock:BAF5-1','snapshot',jsonb_build_object('baselineQuantity',0,'occurredAt',now())));
  edits jsonb := '[{"barcode":"BAD5-2","soldOut":true,"quantity":null},{"barcode":"BAF5-1","soldOut":false,"quantity":0}]';
  jobs jsonb := '[{"barcode":"BAD5-2","jobId":"test-sold-out"}]';
  claimed jsonb;
begin
  assert not has_function_privilege('anon','public.claim_picking_stockout()','EXECUTE');
  assert not has_function_privilege('authenticated','public.finish_picking_inventory(text,text,timestamptz,jsonb,jsonb,jsonb)','EXECUTE');
  insert into public.commerce_os_picking_snapshots(snapshot_date,token_hash,snapshot_id,source,status,payload,expires_at,updated_at)
    values((now() at time zone 'Asia/Seoul')::date,h,'pick-test','fixture','ready','{}',now()+interval '1 hour',ver);
  assert public.finish_picking_inventory(h,'old',ver,edits,ops,jobs)='stale';
  assert public.finish_picking_inventory(h,'pick-test',ver-interval '1 second',edits,ops,jobs)='stale';
  begin
    perform public.finish_picking_inventory(h,'pick-test',ver,edits,ops||ops,jobs);
    raise exception 'duplicate source id accepted';
  exception when unique_violation then null;
  end;
  assert not exists(select from public.commerce_operation_runs where source_event_id='picking-test-count');
  assert not exists(select from public.commerce_os_picking_finishes);
  assert public.finish_picking_inventory(h,'pick-test',ver,edits,ops,jobs)='saved';
  assert public.finish_picking_inventory(h,'pick-test',ver,edits,ops,jobs)='replay';
  assert public.finish_picking_inventory(h,'pick-test',ver,'[]',ops,jobs)='conflict';
  assert (select count(*)=1 and min((input_snapshot->>'baselineQuantity')::int)=0 from public.commerce_operation_runs where source_event_id='picking-test-count');
  assert (select payload->>'inventoryFinished'='true' from public.commerce_os_picking_snapshots where token_hash=h);
  claimed := public.claim_picking_stockout();
  assert claimed->'jobs'=jobs and claimed->'selections'=edits;
  assert public.claim_picking_stockout() is null;
  update public.commerce_os_picking_finishes set claimed_at=now()-interval '4 minutes';
  assert public.claim_picking_stockout()->'jobs'=jobs, 'safe recovery before STARTED';
  update public.commerce_os_picking_finishes set claimed_at=now()-interval '4 minutes';
  insert into public.commerce_operation_runs(operation_type,status,source,source_event_id,correlation_id,input_snapshot)
    values('SHOPLING_STOCK_STATUS_SYNC_EVENT','SUCCEEDED','fixture','receipt','shopling-stock:BAD5-2','{"jobId":"test-sold-out","outcome":"STARTED"}');
  assert public.claim_picking_stockout() is null, 'an existing transmission receipt must block another launch';
end $$;
rollback;
