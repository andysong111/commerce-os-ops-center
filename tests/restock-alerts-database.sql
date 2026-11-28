begin;
do $$
declare
  owner uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  receipt uuid:=gen_random_uuid(); draft text:='fast-purchase-draft:12345678901234567890';
  correlation text:='receipt-onsale:'||draft; code text:='BCE6-1'; job text:='receipt-onsale:'||receipt||':'||code;
  snapshot jsonb; attempt uuid:=gen_random_uuid(); found_id uuid;
begin
  if has_table_privilege('anon','receipt_restock_alerts','SELECT') or has_table_privilege('authenticated','receipt_restock_alerts','SELECT') or
    has_function_privilege('authenticated','public.next_receipt_restock_alert(uuid,text)','execute') then raise exception 'customer data exposed'; end if;
  insert into receipt_restock_alerts(id,owner_id,barcode,phone,last_four,registration_hash,details,created_at) values
    (a,owner,code,'01000001111','1111',repeat('a',64),'{}', now()-interval '2 days'),
    (other,owner,code,'01000002222','2222',repeat('b',64),'{}',now()+interval '1 minute');
  begin
    insert into receipt_restock_alerts(id,owner_id,barcode,phone,last_four,registration_hash,details) values(gen_random_uuid(),owner,code,'01000001111','1111',repeat('c',64),'{}');
    raise exception 'duplicate accepted';
  exception when unique_violation then null; end;
  insert into commerce_operation_runs(operation_type,status,source,source_event_id,correlation_id,input_snapshot,result_snapshot)
  values('CHINA_ORDER_COMMITMENT_EVENT','SUCCEEDED','ops-center-internal-china-receipt','restock-test:receipt',draft,
    jsonb_build_object('barcode',code,'sourceRunId',draft,'status','PARTIALLY_RECEIVED','payload',jsonb_build_object('receiptId',receipt,'draftId',draft)),
    jsonb_build_object('barcode',code,'receivedNow',2,'accepted',true,'receiptId',receipt,'draftId',draft));
  perform refresh_receipt_restock_alerts(owner);
  if (select status from receipt_restock_alerts where id=a)<>'WAITING' then raise exception 'receipt alone unlocked'; end if;
  insert into commerce_operation_runs(operation_type,status,source,source_event_id,correlation_id,input_snapshot)
  values('SHOPLING_STOCK_STATUS_SYNC_EVENT','SUCCEEDED','COMMERCE_OS_INVENTORY_STOCK_CONTROL',correlation||':dispatch:0',correlation,
    jsonb_build_object('jobId',job,'barcode',code,'outcome','STARTED','evidence',jsonb_build_object('receiptId',receipt,'draftId',draft)));
  snapshot:=jsonb_build_object('jobId',job,'barcode',code,'desiredStatus','ON_SALE','outcome','SUCCEEDED','evidence',jsonb_build_object('stockPlanComplete',true,'marketFailureCount',1));
  insert into commerce_operation_runs(operation_type,status,source,source_event_id,correlation_id,input_snapshot)
  values('SHOPLING_STOCK_STATUS_SYNC_EVENT','SUCCEEDED','COMMERCE_OS_INVENTORY_STOCK_CONTROL',job||':SUCCEEDED',correlation,snapshot);
  perform refresh_receipt_restock_alerts(owner);
  if (select status from receipt_restock_alerts where id=a)<>'WAITING' then raise exception 'market failure unlocked'; end if;
  update commerce_operation_runs set input_snapshot=jsonb_set(snapshot,'{evidence,marketFailureCount}','0') where source_event_id=job||':SUCCEEDED';
  perform refresh_receipt_restock_alerts(owner); perform refresh_receipt_restock_alerts(owner);
  if (select status from receipt_restock_alerts where id=a)<>'READY' or (select status from receipt_restock_alerts where id=other)<>'WAITING'
    or (select total from receipt_restock_draft_counts(owner,draft) where state='READY')<>1 then raise exception 'wrong order scope'; end if;
  if exists(select * from next_receipt_restock_alert(owner,'01000002222')) then raise exception 'wrong pilot recipient'; end if;
  select id into found_id from next_receipt_restock_alert(owner,'01000001111');
  if found_id is distinct from a or exists(select * from next_receipt_restock_alert(owner,null)) then raise exception 'lease not exclusive';end if;
  insert into receipt_restock_settings(owner_id,sender,mode) values(owner,'01000001111','pilot');
  if claim_receipt_restock_alert(owner,a,attempt,'01000001111','live','test','{}','{}') or
     claim_receipt_restock_alert(owner,a,attempt,'01000001111','pilot','test','{"old":true}','{}') then raise exception 'mode or edit race'; end if;
  if not claim_receipt_restock_alert(owner,a,attempt,'01000001111','pilot','test','{}','{}') or
     claim_receipt_restock_alert(owner,a,gen_random_uuid(),'01000001111','pilot','test','{}','{}') then raise exception 'repeat claim'; end if;
  update receipt_restock_alerts set status='REVIEW',next_check_at=now() where id=a;
  if (select status from next_receipt_restock_alert(owner,'')) is distinct from 'REVIEW' or
     claim_receipt_restock_alert(owner,a,attempt,'01000001111','pilot','test','{}','{}') then raise exception 'ambiguous submission rearmed'; end if;
  update receipt_restock_alerts set status='SENT',phone=null,sent_body=null,delivery_key='confirmed-test' where id=a;
  perform refresh_receipt_restock_alerts(owner);
  if exists(select * from next_receipt_restock_alert(owner,null)) then raise exception 'future or completed request dispatched';end if;
end $$;
rollback;
