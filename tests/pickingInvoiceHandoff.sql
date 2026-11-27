-- Disposable database, isolated from operational invoice and inventory data.
begin;
alter role service_role bypassrls;
grant select,insert,update on public.commerce_operation_runs to service_role;
insert into auth.users values ('10000000-0000-4000-9000-000000000001');
set local role service_role;
do $$
declare
  owner uuid := '10000000-0000-4000-9000-000000000001';
  h text := repeat('a',64);
  ver timestamptz := now();
  groups jsonb := '{"invoiceNumbers":["012345678901"],"inventoryShortageInvoiceNumbers":["112345678901"]}';
  jobs jsonb := '[{"barcode":"BAD5-2","jobId":"fixture-stockout"}]';
  ticket jsonb;
  q jsonb;
  j jsonb;
  revision_before uuid;
begin
  assert not has_function_privilege('anon','public.finish_picking_with_invoices(text,text,timestamptz,jsonb,jsonb,jsonb,uuid,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.finish_picking_with_invoices(text,text,timestamptz,jsonb,jsonb,jsonb,uuid,jsonb)','execute');
  insert into public.commerce_os_picking_snapshots(snapshot_date,token_hash,snapshot_id,source,status,payload,expires_at,updated_at)
    values((now() at time zone 'Asia/Seoul')::date,h,'pick','fixture','ready','{}',now()+interval '1 hour',ver);
  begin
    perform public.finish_picking_with_invoices(h,'pick',ver,'[]','[]',jobs,owner,groups||'{"inventoryShortageInvoiceNumbers":["012345678901"]}');
    raise exception 'overlap accepted';
  exception when others then assert sqlerrm='Invalid picking invoice numbers'; end;
  begin
    perform public.finish_picking_with_invoices(h,'pick',ver,'[]','[]',jobs,gen_random_uuid(),groups);
    raise exception 'missing owner accepted';
  exception when foreign_key_violation then null; end;
  assert not exists(select 1 from public.commerce_os_picking_finishes);
  assert public.finish_picking_with_invoices(h,'pick',ver,'[]','[]',jobs,owner,groups)='saved';
  assert public.finish_picking_with_invoices(h,'pick',ver,'[]','[]',jobs,owner,groups)='replay';
  assert public.finish_picking_with_invoices(h,'pick',ver,'[]','[]',jobs,owner,groups||'{"invoiceNumbers":[]}')='conflict';
  assert public.claim_picking_stockout() is null, 'stock popup must wait for task 4';
  select queue,revision into q,revision_before from public.commerce_os_remote_work_center where owner_id=owner;
  ticket:=q#>'{pickingInbox,0}';
  assert jsonb_array_length(q->'pickingInbox')=1 and ticket @> groups;
  assert (ticket->>'expiresAt')::bigint > extract(epoch from now())*1000;
  j:=jsonb_build_object('id',ticket->'id','pickingSnapshotId','pick','actionId','post-packing-invoices','status','running','code',null);
  update public.commerce_os_remote_work_center set revision=gen_random_uuid(),queue=q||jsonb_build_object('pickingInbox','[]'::jsonb,'jobs',jsonb_build_array(j))
    where owner_id=owner and revision=revision_before;
  assert (select invoice_task->>'status'='running' from public.commerce_os_picking_finishes where snapshot_id='pick');
  update public.commerce_os_remote_work_center set queue=jsonb_set(queue,'{jobs,0,status}','"completed"') where owner_id=owner and revision=revision_before;
  assert not found, 'stale queue writers must not publish an old result';
  update public.commerce_os_remote_work_center set queue=jsonb_set(queue,'{jobs,0,status}','"ambiguous"') where owner_id=owner;
  assert public.claim_picking_stockout() is null;
  update public.commerce_os_remote_work_center set queue=jsonb_set(queue,'{jobs,0,status}','"acknowledged"') where owner_id=owner;
  assert public.claim_picking_stockout()->>'snapshotId'='pick';
  update public.commerce_os_remote_work_center set queue=jsonb_set(queue,'{jobs}','[]') where owner_id=owner;
  assert (select invoice_task->>'status'='acknowledged' and invoice_task @> groups from public.commerce_os_picking_finishes where snapshot_id='pick');
end $$;
rollback;
