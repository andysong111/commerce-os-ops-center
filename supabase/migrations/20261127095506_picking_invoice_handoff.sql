begin;

alter table public.commerce_os_picking_finishes add column invoice_task jsonb;
alter table public.commerce_os_picking_finishes drop constraint commerce_os_picking_finishes_dispatch_state_check;
alter table public.commerce_os_picking_finishes add check (dispatch_state in ('none','queued','claimed','closed','after_invoices'));

-- The existing finish RPC locks the snapshot and commits its inventory work.
-- The caller's original two lists and the PC inbox are part of that transaction.
create function public.finish_picking_with_invoices(
  p_hash text, p_snapshot text, p_version timestamptz, p_selections jsonb,
  p_operations jsonb, p_jobs jsonb, p_owner uuid, p_groups jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  outcome text;
  task jsonb;
  item jsonb;
  total integer;
  distinct_total integer;
  day date;
begin
  if p_owner is null or jsonb_typeof(p_groups) is distinct from 'object'
     or jsonb_typeof(p_groups->'invoiceNumbers') is distinct from 'array'
     or jsonb_typeof(p_groups->'inventoryShortageInvoiceNumbers') is distinct from 'array'
     or p_groups - 'invoiceNumbers' - 'inventoryShortageInvoiceNumbers' <> '{}'::jsonb then
    raise exception 'Invalid picking invoice groups';
  end if;
  select count(*), count(distinct v) into total,distinct_total
    from jsonb_array_elements((p_groups->'invoiceNumbers') || (p_groups->'inventoryShortageInvoiceNumbers')) e(v);
  if total not between 1 and 50 or distinct_total<>total or exists (
    select 1 from jsonb_array_elements((p_groups->'invoiceNumbers') || (p_groups->'inventoryShortageInvoiceNumbers')) e(v)
    where jsonb_typeof(v)<>'string' or (v #>> '{}') !~ '^[0-9]{12}$'
  ) then raise exception 'Invalid picking invoice numbers'; end if;

  outcome := public.finish_picking_inventory(p_hash,p_snapshot,p_version,p_selections,p_operations,p_jobs);
  if outcome not in ('saved','replay') then return outcome; end if;
  select invoice_task,pick_day into strict task,day from public.commerce_os_picking_finishes where snapshot_id=p_snapshot;
  if outcome='replay' then
    if task->>'ownerId'=p_owner::text and task @> p_groups
       and task->'invoiceNumbers'=p_groups->'invoiceNumbers'
       and task->'inventoryShortageInvoiceNumbers'=p_groups->'inventoryShortageInvoiceNumbers' then return 'replay'; end if;
    return 'conflict';
  end if;
  item := p_groups || jsonb_build_object('id',gen_random_uuid(),'snapshotId',p_snapshot,
    'expiresAt',(extract(epoch from ((day+1)::timestamp at time zone 'Asia/Seoul'))*1000)::bigint);
  update public.commerce_os_picking_finishes
    set invoice_task=item || jsonb_build_object('ownerId',p_owner,'status','waiting','code',null),
        dispatch_state=case when dispatch_state='queued' then 'after_invoices' else dispatch_state end
    where snapshot_id=p_snapshot;
  insert into public.commerce_os_remote_work_center as wc(owner_id,revision,queue)
    values(p_owner,gen_random_uuid(),jsonb_build_object('agent',null,'pending',null,'jobs','[]'::jsonb,'pickingInbox',jsonb_build_array(item)))
    on conflict(owner_id) do update set revision=excluded.revision,
      queue=jsonb_set(wc.queue,'{pickingInbox}',coalesce(wc.queue->'pickingInbox','[]'::jsonb)||jsonb_build_array(item));
  return 'saved';
end $$;
revoke all on function public.finish_picking_with_invoices(text,text,timestamptz,jsonb,jsonb,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_picking_with_invoices(text,text,timestamptz,jsonb,jsonb,jsonb,uuid,jsonb) to service_role;

-- Mirror the authenticated worker's original receipt before the rolling
-- mobile history can evict it. Other mobile/desktop commands are unrelated.
create function public.record_picking_invoice_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare job jsonb := new.queue#>'{jobs,0}';
begin
  update public.commerce_os_picking_finishes set invoice_task=invoice_task || jsonb_build_object('status',job->'status','code',job->'code'),
    dispatch_state=case when dispatch_state='after_invoices' and job->>'status' in ('completed','failed','needs_pc','expired','acknowledged')
                        then 'queued' else dispatch_state end
    where snapshot_id=job->>'pickingSnapshotId' and invoice_task->>'ownerId'=new.owner_id::text
      and invoice_task->>'id'=job->>'id' and (invoice_task->'status',invoice_task->'code') is distinct from (job->'status',job->'code');
  return null;
end $$;
revoke all on function public.record_picking_invoice_receipt() from public,anon,authenticated;
create trigger picking_invoice_receipt after update of queue on public.commerce_os_remote_work_center
for each row when (new.queue#>>'{jobs,0,pickingSnapshotId}' is not null and new.queue#>>'{jobs,0,actionId}'='post-packing-invoices'
  and (old.queue#>'{jobs,0}') is distinct from (new.queue#>'{jobs,0}'))
execute function public.record_picking_invoice_receipt();
commit;
