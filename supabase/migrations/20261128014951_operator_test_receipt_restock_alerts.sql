-- A null barcode is reserved for a manually requested operator SMS.
alter table public.receipt_restock_alerts alter column barcode drop not null;
alter table public.receipt_restock_alerts add constraint restock_operator_test_shape check (
  (barcode is not null and not (details ? 'operatorTest')) or
  (barcode is null and details='{"operatorTest":true}'::jsonb and sender is not null
    and sender ~ '^010[0-9]{8}$' and job_id is null and draft_id is null and status <> 'WAITING')
);
create unique index restock_one_open_operator_test on public.receipt_restock_alerts(owner_id)
where barcode is null and status in ('READY','SENDING','REVIEW');

create function public.request_receipt_restock_test(p_owner uuid,p_id uuid,p_sender text,p_phone text,p_hash text)
returns boolean language plpgsql set search_path='' as $$
begin
  perform 1 from public.receipt_restock_settings where owner_id=p_owner and mode='pilot' and sender=p_sender for share;
  if not found then return false; end if;
  insert into public.receipt_restock_alerts(id,owner_id,phone,last_four,sender,details,registration_hash,status,note)
    values(p_id,p_owner,p_phone,right(p_phone,4),p_sender,'{"operatorTest":true}',p_hash,'READY','WAIT')
    on conflict do nothing;
  return exists(select 1 from public.receipt_restock_alerts where id=p_id and owner_id=p_owner
    and barcode is null and registration_hash=p_hash);
end;
$$;
revoke all on function public.request_receipt_restock_test(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.request_receipt_restock_test(uuid,uuid,text,text,text) to service_role;

create function public.cancel_pending_receipt_restock_tests() returns trigger language plpgsql set search_path='' as $$
begin
  update public.receipt_restock_alerts set status='CANCELED',phone=null,note=null,finished_at=now()
  where owner_id=old.owner_id and barcode is null and status='READY';
  return new;
end;
$$;
revoke all on function public.cancel_pending_receipt_restock_tests() from public,anon,authenticated;
create trigger cancel_pending_operator_tests after update of mode,sender on public.receipt_restock_settings
for each row when (old.mode='pilot' and (new.mode<>old.mode or new.sender<>old.sender))
execute function public.cancel_pending_receipt_restock_tests();

create or replace function public.next_receipt_restock_alert(p_owner uuid,p_pilot_phone text)
returns setof public.receipt_restock_alerts language sql set search_path='' as $$
  with candidate as (
    select id from public.receipt_restock_alerts
    where owner_id=p_owner and status in ('READY','SENDING','REVIEW') and next_check_at<=now()
      and (status in ('REVIEW','SENDING') or
        (barcode is not null and (p_pilot_phone is null or phone=p_pilot_phone)) or
        (barcode is null and sender=p_pilot_phone))
    order by case when status='SENDING' then 0 when barcode is null then 1 else 2 end,next_check_at,created_at,id
    limit 1 for update skip locked
  )
  update public.receipt_restock_alerts a set next_check_at=now()+interval '2 minutes'
  from candidate c where a.id=c.id returning a.*;
$$;

create or replace function public.claim_receipt_restock_alert(p_owner uuid,p_id uuid,p_attempt uuid,p_sender text,
  p_mode text,p_body text,p_details jsonb,p_evidence jsonb)
returns boolean language plpgsql set search_path='' as $$
begin
  perform 1 from public.receipt_restock_settings where owner_id=p_owner and sender=p_sender
    and mode=p_mode and mode in ('pilot','live') for share;
  if not found then return false; end if;
  update public.receipt_restock_alerts set status='SENDING',sender=p_sender,attempt_id=p_attempt,
    attempted_at=now(),sent_body=p_body,evidence=p_evidence,next_check_at=now()+interval '2 minutes',note='HISTORY'
    where owner_id=p_owner and id=p_id and status='READY' and details=p_details and
    ((barcode is not null and (p_mode='live' or phone=p_sender)) or
     (barcode is null and p_mode='pilot' and sender=p_sender and p_evidence->'operatorTest'='true'::jsonb));
  return found;
exception when unique_violation then return false;
end;
$$;
