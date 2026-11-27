begin;

create table public.commerce_os_picking_finishes (
  snapshot_id text primary key,
  pick_day date not null,
  selections jsonb not null,
  jobs jsonb not null,
  dispatch_state text not null check (dispatch_state in ('none','queued','claimed','closed')),
  claimed_at timestamptz,
  finished_at timestamptz not null default now()
);
alter table public.commerce_os_picking_finishes enable row level security;
revoke all on public.commerce_os_picking_finishes from public, anon, authenticated;
grant select, insert, update on public.commerce_os_picking_finishes to service_role;

-- The snapshot, checked quantities, inventory ledger and dispatch ticket must
-- agree at the instant the operator commits, even if a new list arrives.
create function public.finish_picking_inventory(
  p_hash text, p_snapshot text, p_version timestamptz, p_selections jsonb,
  p_operations jsonb, p_jobs jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  picking public.commerce_os_picking_snapshots%rowtype;
  prior public.commerce_os_picking_finishes%rowtype;
begin
  select * into picking from public.commerce_os_picking_snapshots
    where token_hash=p_hash and snapshot_id=p_snapshot and expires_at>now() for update;
  if not found then return 'stale'; end if;
  select * into prior from public.commerce_os_picking_finishes where snapshot_id=p_snapshot;
  if found then
    if prior.selections=p_selections then return 'replay'; end if;
    return 'conflict';
  end if;
  if picking.updated_at<>p_version or picking.snapshot_date<>(now() at time zone 'Asia/Seoul')::date
    then return 'stale'; end if;
  insert into public.commerce_operation_runs
    (operation_type,status,source,source_event_id,correlation_id,actor_type,input_snapshot,result_snapshot,started_at,finished_at,updated_at)
    select o."operationType",'SUCCEEDED','COMMERCE_OS_INVENTORY_STOCK_CONTROL',o."sourceEventId",o."correlationId",
      'OPS_OPERATOR',o.snapshot,jsonb_build_object('accepted',true,'snapshot',o.snapshot),
      (o.snapshot->>'occurredAt')::timestamptz,now(),now()
    from jsonb_to_recordset(p_operations) as o("operationType" text,"sourceEventId" text,"correlationId" text,snapshot jsonb);
  insert into public.commerce_os_picking_finishes(snapshot_id,pick_day,selections,jobs,dispatch_state)
    values(p_snapshot,picking.snapshot_date,p_selections,p_jobs,case when jsonb_array_length(p_jobs)>0 then 'queued' else 'none' end);
  update public.commerce_os_picking_snapshots set
    payload=payload || jsonb_build_object('inventoryFinished',true), updated_at=clock_timestamp()
    where id=picking.id;
  return 'saved';
end $$;
revoke all on function public.finish_picking_inventory(text,text,timestamptz,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_picking_inventory(text,text,timestamptz,jsonb,jsonb,jsonb) to service_role;

-- Only the winning desktop receives the immutable command. A lost claim is
-- reconciled against Shopling receipts, never automatically issued again.
create function public.claim_picking_stockout() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare ticket public.commerce_os_picking_finishes%rowtype;
begin
  perform pg_advisory_xact_lock(193608587,1);
  select * into ticket from public.commerce_os_picking_finishes where dispatch_state='claimed'
    and pick_day=(now() at time zone 'Asia/Seoul')::date limit 1 for update;
  if found then
    if ticket.claimed_at > now()-interval '3 minutes' then return null; end if;
    -- A tab may have closed between winning a claim and recording STARTED.
    -- The unique per-job STARTED row also fences two late desktop responses.
  else
    select * into ticket from public.commerce_os_picking_finishes
      where dispatch_state='queued' and pick_day=(now() at time zone 'Asia/Seoul')::date
      order by finished_at,snapshot_id limit 1 for update;
    if not found then return null; end if;
  end if;
  update public.commerce_os_picking_finishes set dispatch_state='claimed', claimed_at=now() where snapshot_id=ticket.snapshot_id;
  if exists(select 1 from jsonb_array_elements(ticket.jobs) j join public.commerce_operation_runs r
      on r.correlation_id='shopling-stock:'||(j->>'barcode') and r.operation_type='SHOPLING_STOCK_STATUS_SYNC_EVENT'
      and r.input_snapshot->>'jobId'=j->>'jobId') then return null; end if;
  return jsonb_build_object('snapshotId',ticket.snapshot_id,'jobs',ticket.jobs,'selections',ticket.selections);
end $$;
revoke all on function public.claim_picking_stockout() from public,anon,authenticated;
grant execute on function public.claim_picking_stockout() to service_role;
commit;
