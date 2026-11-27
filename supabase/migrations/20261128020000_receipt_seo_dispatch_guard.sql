-- Eligibility is read before the original Shopling handoff. Serialize the final
-- insert so simultaneous browser sessions cannot both consume the same proof.
create or replace function public.guard_receipt_seo_dispatch()
returns trigger language plpgsql set search_path = '' as $$
declare
  budget jsonb := new.result -> 'receiptBudget';
  ids text[];
  market_reserved int;
  product_reserved int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seo-dispatch:' || new.owner_id::text, 0));
  select array_agg(id) into ids from jsonb_array_elements_text(new.run_ids) as t(id);
  if exists (
    select 1 from public.shopling_market_auto_orchestrations o
    where o.owner_id = new.owner_id and o.state in ('waiting_upload','uploading','market_ready','market_claimed','market_running')
      and o.run_ids ?| ids
  ) then
    raise exception '같은 상품의 마켓전송 작업이 이미 진행 중입니다.';
  end if;
  -- A simultaneous ordinary batch must respect a receipt batch that already took the last slot.
  if budget is null then
    select o.result->'receiptBudget' into budget from public.shopling_market_auto_orchestrations o
    where o.owner_id=new.owner_id and o.result ? 'receiptBudget'
      and o.state in ('waiting_upload','uploading','market_ready','market_claimed','market_running')
      and (o.result->'receiptBudget'->>'marketObservedAt')::timestamptz >= now() - interval '24 hours'
    order by o.created_at desc limit 1;
  end if;
  if budget is not null then
    if jsonb_typeof(budget) <> 'object' or not (budget ?& array['marketObservedAt','marketLimit','productObservedAt','productLimit'])
       or coalesce((budget->>'marketObservedAt')::timestamptz, '-infinity') < now() - interval '24 hours'
       or (coalesce(new.result->>'mode','full_pipeline') <> 'market_only' and coalesce((budget->>'productObservedAt')::timestamptz, '-infinity') < now() - interval '24 hours') then
      raise exception '현재 마켓 등록 자리 확인이 필요합니다.';
    end if;
    select
      coalesce(sum(jsonb_array_length(o.run_ids)) filter (where o.state in ('waiting_upload','uploading','market_ready','market_claimed','market_running')
         or coalesce(o.completed_at, o.created_at) >= (budget->>'marketObservedAt')::timestamptz), 0),
      coalesce(sum(jsonb_array_length(o.run_ids)) filter (where coalesce(o.result->>'mode','full_pipeline') <> 'market_only'
        and (o.state in ('waiting_upload','uploading','market_ready','market_claimed','market_running')
         or coalesce(o.completed_at,o.created_at) >= (budget->>'productObservedAt')::timestamptz)), 0)
    into market_reserved, product_reserved from public.shopling_market_auto_orchestrations o where o.owner_id = new.owner_id;
    if market_reserved + cardinality(ids) > coalesce((budget->>'marketLimit')::int,0)
       or (coalesce(new.result->>'mode','full_pipeline') <> 'market_only' and product_reserved + cardinality(ids) > coalesce((budget->>'productLimit')::int,0)) then
      raise exception '다른 등록 작업이 자리를 사용했습니다. 최신 마켓 한도를 확인하세요.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_receipt_seo_dispatch() from public, anon, authenticated;
create trigger guard_receipt_seo_dispatch before insert on public.shopling_market_auto_orchestrations
for each row execute function public.guard_receipt_seo_dispatch();

-- Advance all six existing identities only after the new listing has independently read back.
-- A replay sees the new current_run_id and does not add another attempt or audit event.
create or replace function public.advance_receipt_seo_rotation(
  p_owner uuid, p_item text, p_previous text, p_run text, p_proof jsonb
) returns int language plpgsql set search_path = '' as $$
declare
  old_row public.seo_listing_lifecycle_records%rowtype;
  proof jsonb;
  old_keys text[];
  changed integer := 0;
begin
  if p_run !~ '^seo-run-receipt-[a-f0-9]{64}$' or nullif(p_previous,'') is null
     or p_run = p_previous or jsonb_typeof(p_proof) is distinct from 'array' then return 0; end if;
  if jsonb_array_length(p_proof) <> 6 then return 0; end if;
  if (select count(distinct r->>'market_account_key') from jsonb_array_elements(p_proof) r) <> 6
     or (select count(distinct r->>'goods_key') from jsonb_array_elements(p_proof) r) <> 6
     or exists (select 1 from jsonb_array_elements(p_proof) r where
       not coalesce((r->>'owner_id')::uuid = p_owner and r->>'launch_item_id' = p_item and r->>'current_run_id' = p_run
         and r->>'market_account_key' in ('도매1','도매2','도매3','도매4','소매1','소매2')
         and r->>'goods_key' ~ '^[0-9]+$' and r->>'state' in ('LIVE','PROTECTED')
         and r->'exposure_verified' = 'true'::jsonb and r->'requires_review' = 'false'::jsonb
         and (r->>'live_started_at')::timestamptz is not null
         and (r->>'last_verified_live_at')::timestamptz >= now() - interval '1 day'
         and (r->>'last_verified_live_at')::timestamptz <= now() + interval '5 minutes'
         and r->'evidence'->>'shoplingSaleStatus' = 'B' and r->'evidence'->'salesEvidenceFresh' = 'true'::jsonb,false)
     ) then return 0; end if;
  perform id from public.seo_listing_lifecycle_records where owner_id=p_owner and launch_item_id=p_item order by id for update;
  select array_agg(goods_key) into old_keys from public.seo_listing_lifecycle_records where owner_id=p_owner and launch_item_id=p_item;
  if coalesce(cardinality(old_keys),0) <> 6 or exists (
    select 1 from public.seo_listing_lifecycle_records l where l.owner_id=p_owner and l.launch_item_id=p_item
      and not coalesce(l.state='COOLDOWN' and l.current_run_id=p_previous and l.attempt_count between 1 and 2
        and not l.requires_review and l.sales_count_during_attempt=0 and l.next_eligible_at <= now()
        and l.evidence->'previousListingDeleted'='true'::jsonb
        and (l.evidence->>'previousListingDeleteReadbackVerifiedAt')::timestamptz <= now() + interval '5 minutes'
        and exists(select 1 from jsonb_array_elements(p_proof) r where r->>'market_account_key'=l.market_account_key),false)
  ) or exists (select 1 from jsonb_array_elements(p_proof) r where r->>'goods_key'=any(old_keys)) then return 0; end if;
  for old_row in select * from public.seo_listing_lifecycle_records where owner_id=p_owner and launch_item_id=p_item loop
    select r into strict proof from jsonb_array_elements(p_proof) r where r->>'market_account_key'=old_row.market_account_key;
    update public.seo_listing_lifecycle_records set state=proof->>'state', current_run_id=p_run,
      goods_key=proof->>'goods_key', market_listing_id='', attempt_count=old_row.attempt_count+1,
      live_started_at=(proof->>'live_started_at')::timestamptz, last_verified_live_at=(proof->>'last_verified_live_at')::timestamptz,
      sales_count_during_attempt=(proof->>'sales_count_during_attempt')::int, next_eligible_at=null, exposure_verified=true,
      requires_review=false, review_reason=null, evidence=proof->'evidence', evaluated_at=now(), updated_at=now() where id=old_row.id;
    insert into public.seo_listing_lifecycle_events(owner_id,lifecycle_record_id,previous_state,new_state,action,attempt_count,reason_code,evidence,rule_version,evaluated_at)
      values(p_owner,old_row.id,old_row.state,proof->>'state','RELIST',old_row.attempt_count+1,'RECEIPT_RELIST_READBACK_VERIFIED',
        jsonb_build_object('previous',to_jsonb(old_row),'newRunId',p_run,'newGoodsKey',proof->>'goods_key','readback',proof->'evidence'),old_row.rule_version,now());
    changed := changed + 1;
  end loop;
  return changed;
end $$;
revoke all on function public.advance_receipt_seo_rotation(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.advance_receipt_seo_rotation(uuid,text,text,text,jsonb) to service_role;
