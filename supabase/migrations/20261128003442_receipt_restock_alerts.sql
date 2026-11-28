create table public.receipt_restock_settings (
  owner_id uuid primary key,
  sender text not null check (sender ~ '^010[0-9]{8}$'),
  mode text not null check (mode in ('off','pilot','live')),
  opt_out text not null default '' check (opt_out='' or opt_out ~ '^080[0-9]{7}$')
);
alter table public.receipt_restock_settings enable row level security;
revoke all on public.receipt_restock_settings from public, anon, authenticated;
grant select,insert,update on public.receipt_restock_settings to service_role;

create table public.receipt_restock_alerts (
  id uuid primary key,
  owner_id uuid not null,
  barcode text not null check (barcode ~ '^B[A-Z]{1,2}[0-9]+-[0-9]+$'),
  phone text check (phone ~ '^010[0-9]{8}$'),
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  registration_hash text not null check (registration_hash ~ '^[a-f0-9]{64}$'),
  details jsonb not null,
  created_at timestamptz not null default now(),
  status text not null default 'WAITING' check (status in ('WAITING','READY','SENDING','REVIEW','SENT','CANCELED')),
  draft_id text,
  job_id text,
  next_check_at timestamptz not null default now(),
  attempt_id uuid,
  attempted_at timestamptz,
  sent_body text,
  sender text,
  evidence jsonb,
  delivery_key text unique,
  note text,
  finished_at timestamptz,
  check (status in ('SENT','CANCELED') or phone is not null),
  check (status not in ('SENDING','REVIEW','SENT') or attempt_id is not null)
);
alter table public.receipt_restock_alerts enable row level security;
revoke all on public.receipt_restock_alerts from public, anon, authenticated;
grant select,insert,update on public.receipt_restock_alerts to service_role;
create unique index restock_open_request on public.receipt_restock_alerts(owner_id,barcode,phone)
  where status in ('WAITING','READY','SENDING','REVIEW');
create unique index restock_single_submission on public.receipt_restock_alerts(owner_id) where status='SENDING';
create index restock_due on public.receipt_restock_alerts(owner_id,status,next_check_at);
create index restock_draft on public.receipt_restock_alerts(owner_id,draft_id);

-- The purchase workflow already persisted both receipts. Replay them here so
-- a PC outage cannot lose a notification or hold up receipt confirmation.
create function public.refresh_receipt_restock_alerts(p_owner uuid) returns void
language sql set search_path='' as $$
  with eligible as (
    select distinct on (a.id) a.id, receipt.result_snapshot->>'draftId' as draft, e.input_snapshot->>'jobId' as job
    from public.receipt_restock_alerts a
    join public.commerce_operation_runs receipt on receipt.operation_type='CHINA_ORDER_COMMITMENT_EVENT'
      and receipt.source='ops-center-internal-china-receipt' and receipt.status='SUCCEEDED'
      and receipt.result_snapshot->>'barcode'=a.barcode and receipt.input_snapshot->>'barcode'=a.barcode
      and receipt.result_snapshot->'accepted'='true'::jsonb
      and receipt.result_snapshot->'receivedNow' > '0'::jsonb and jsonb_typeof(receipt.result_snapshot->'receivedNow')='number'
      and receipt.input_snapshot->>'status' in ('RECEIVED','PARTIALLY_RECEIVED')
      and receipt.input_snapshot->'payload'->>'receiptId'=receipt.result_snapshot->>'receiptId'
      and receipt.input_snapshot->>'sourceRunId'=receipt.result_snapshot->>'draftId'
      and receipt.input_snapshot->'payload'->>'draftId'=receipt.result_snapshot->>'draftId'
    join public.commerce_operation_runs e on e.operation_type='SHOPLING_STOCK_STATUS_SYNC_EVENT'
      and e.source='COMMERCE_OS_INVENTORY_STOCK_CONTROL' and e.status='SUCCEEDED'
      and e.correlation_id='receipt-onsale:'||(receipt.result_snapshot->>'draftId')
      and e.input_snapshot->>'jobId'='receipt-onsale:'||(receipt.result_snapshot->>'receiptId')||':'||a.barcode
      and e.source_event_id=(e.input_snapshot->>'jobId')||':SUCCEEDED'
      and e.input_snapshot->>'barcode'=a.barcode and e.input_snapshot->>'outcome'='SUCCEEDED'
      and e.input_snapshot->>'desiredStatus'='ON_SALE'
      and e.input_snapshot->'evidence'->'stockPlanComplete'='true'::jsonb
      and coalesce(e.input_snapshot->'evidence'->>'marketFailureCount','0')='0'
      and e.started_at >= a.created_at
    join public.commerce_operation_runs s on s.source_event_id like (e.correlation_id||':dispatch:%')
      and s.operation_type=e.operation_type and s.source=e.source and s.correlation_id=e.correlation_id
      and s.status='SUCCEEDED' and s.input_snapshot->>'barcode'=a.barcode and s.input_snapshot->>'outcome'='STARTED'
      and s.input_snapshot->>'jobId'=e.input_snapshot->>'jobId'
      and s.input_snapshot->'evidence'->>'receiptId'=receipt.result_snapshot->>'receiptId'
      and s.input_snapshot->'evidence'->>'draftId'=receipt.result_snapshot->>'draftId'
    where a.owner_id=p_owner and a.status='WAITING'
    order by a.id,e.started_at,e.source_event_id
  )
  update public.receipt_restock_alerts a set status='READY',draft_id=e.draft,job_id=e.job,next_check_at=now(),note=null
  from eligible e where a.id=e.id and a.status='WAITING';
$$;

create function public.next_receipt_restock_alert(p_owner uuid,p_pilot_phone text)
returns setof public.receipt_restock_alerts language sql set search_path='' as $$
  with candidate as (
    select id from public.receipt_restock_alerts
    where owner_id=p_owner and status in ('READY','SENDING','REVIEW') and next_check_at<=now()
      and (status='REVIEW' or status='SENDING' or p_pilot_phone is null or phone=p_pilot_phone)
    order by case when status='SENDING' then 0 else 1 end,next_check_at,created_at,id
    limit 1 for update skip locked
  )
  update public.receipt_restock_alerts a set next_check_at=now()+interval '2 minutes'
  from candidate c where a.id=c.id returning a.*;
$$;
revoke all on function public.refresh_receipt_restock_alerts(uuid),public.next_receipt_restock_alert(uuid,text) from public,anon,authenticated;
grant execute on function public.refresh_receipt_restock_alerts(uuid),public.next_receipt_restock_alert(uuid,text) to service_role;

create function public.receipt_restock_draft_members(p_owner uuid,p_draft text)
returns setof public.receipt_restock_alerts language sql stable set search_path='' as $$
  select a.* from public.receipt_restock_alerts a where a.owner_id=p_owner and
    (a.draft_id=p_draft or (a.status='WAITING' and exists (
      select 1 from public.commerce_operation_runs r where r.source='ops-center-internal-china-receipt'
      and r.operation_type='CHINA_ORDER_COMMITMENT_EVENT' and r.status='SUCCEEDED'
      and r.result_snapshot->>'draftId'=p_draft and r.result_snapshot->>'barcode'=a.barcode
      and r.result_snapshot->'accepted'='true'::jsonb and r.started_at>=a.created_at)));
$$;
create function public.receipt_restock_draft_counts(p_owner uuid,p_draft text)
returns table(state text,total bigint) language sql stable set search_path='' as $$
  select a.status,count(*) from public.receipt_restock_draft_members(p_owner,p_draft) a group by a.status;
$$;
create function public.receipt_restock_draft_page(p_owner uuid,p_draft text,p_offset integer)
returns jsonb language sql stable set search_path='' as $$
  with scoped as materialized (
    select id,barcode,last_four,status,created_at,draft_id,details,note from public.receipt_restock_draft_members(p_owner,p_draft)
  )
  select jsonb_build_object('total',(select count(*) from scoped),'items',
    coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id) from
      (select * from scoped order by created_at desc,id offset greatest(p_offset,0) limit 30) p),'[]'::jsonb));
$$;
revoke all on function public.receipt_restock_draft_members(uuid,text),public.receipt_restock_draft_counts(uuid,text),public.receipt_restock_draft_page(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.receipt_restock_draft_members(uuid,text),public.receipt_restock_draft_counts(uuid,text),public.receipt_restock_draft_page(uuid,text,integer) to service_role;

create function public.claim_receipt_restock_alert(p_owner uuid,p_id uuid,p_attempt uuid,p_sender text,
  p_mode text,p_body text,p_details jsonb,p_evidence jsonb)
returns boolean language plpgsql set search_path='' as $$
begin
  perform 1 from public.receipt_restock_settings where owner_id=p_owner and sender=p_sender
    and mode=p_mode and mode in ('pilot','live') for share;
  if not found then return false; end if;
  update public.receipt_restock_alerts set status='SENDING',sender=p_sender,attempt_id=p_attempt,
    attempted_at=now(),sent_body=p_body,evidence=p_evidence,next_check_at=now()+interval '2 minutes',note='HISTORY'
    where owner_id=p_owner and id=p_id and status='READY' and details=p_details and (p_mode='live' or phone=p_sender);
  return found;
exception when unique_violation then return false;
end;
$$;
revoke all on function public.claim_receipt_restock_alert(uuid,uuid,uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_receipt_restock_alert(uuid,uuid,uuid,text,text,text,jsonb,jsonb) to service_role;
