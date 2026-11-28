-- Only the operator's selected test receipt can enable automatic customer messages.
alter table public.receipt_restock_settings add column activate_after_test uuid
  references public.receipt_restock_alerts(id);

create function public.schedule_restock_activation(p_owner uuid,p_test uuid) returns boolean
language plpgsql set search_path='' as $$
declare r public.receipt_restock_alerts;
begin
  select * into r from public.receipt_restock_alerts
    where id=p_test and owner_id=p_owner and barcode is null for update;
  if not found or r.status not in ('READY','SENDING','REVIEW','SENT') then return false;end if;
  if r.status='SENT' then
    if r.evidence->>'operatorTest' is distinct from 'true'
      or r.evidence->>'pilot' is distinct from 'true'
      or coalesce(r.evidence->>'shoplingHistoryNo','') !~ '^[0-9]+$' then return false;end if;
    update public.receipt_restock_settings set mode='live',activate_after_test=null
      where owner_id=p_owner and mode='pilot' and sender=r.sender;
  else
    update public.receipt_restock_settings set activate_after_test=p_test
      where owner_id=p_owner and mode='pilot' and sender=r.sender;
  end if;
  return found;
end;
$$;
revoke all on function public.schedule_restock_activation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.schedule_restock_activation(uuid,uuid) to service_role;

create function public.finish_restock_activation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='SENT' and new.evidence->>'operatorTest'='true' and new.evidence->>'pilot'='true'
    and coalesce(new.evidence->>'shoplingHistoryNo','') ~ '^[0-9]+$' then
    update public.receipt_restock_settings set mode='live',activate_after_test=null
      where owner_id=new.owner_id and sender=new.sender and mode='pilot' and activate_after_test=new.id;
  elsif new.status='CANCELED' then
    update public.receipt_restock_settings set activate_after_test=null
      where owner_id=new.owner_id and activate_after_test=new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.finish_restock_activation() from public,anon,authenticated;
create trigger finish_restock_activation after update of status on public.receipt_restock_alerts
for each row when (new.barcode is null and old.status<>new.status and new.status in ('SENT','CANCELED'))
execute function public.finish_restock_activation();

create function public.reset_restock_activation() returns trigger language plpgsql set search_path='' as $$
begin new.activate_after_test=null;return new;end;
$$;
revoke all on function public.reset_restock_activation() from public,anon,authenticated;
create trigger reset_restock_activation before update of mode,sender on public.receipt_restock_settings
for each row when (old.mode<>new.mode or old.sender<>new.sender) execute function public.reset_restock_activation();
