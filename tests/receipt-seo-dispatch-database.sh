#!/usr/bin/env bash
set -euo pipefail
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/202609020002_shopling_market_auto_orchestrations.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261014191618_seo_listing_rotation_shadow_v1.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261128020000_receipt_seo_dispatch_guard.sql
psql -X -v ON_ERROR_STOP=1 <<'SQL'
create function public.test_receipt_claim(owner uuid, run text, token text, mode text, slots int) returns void language sql as $$
insert into public.shopling_market_auto_orchestrations(owner_id,batch_id,run_ids,token_hash,state,result)
values(owner,'batch',jsonb_build_array(run),token,'market_ready',jsonb_build_object('mode',mode,
  'receiptBudget',jsonb_build_object('marketLimit',slots,'marketObservedAt',now()-interval '1 hour',
    'productLimit',0,'productObservedAt',now()-interval '1 hour')));
$$;
SQL
owner=00000000-0000-4000-8000-000000000001
# Disjoint products compete for the last market slot on different connections.
PGAPPNAME=receipt_seo_first psql -X -v ON_ERROR_STOP=1 -c "begin; select test_receipt_claim('$owner','run-a','a','market_only',1); select pg_sleep(1.5); commit;" &
first=$!
for _ in {1..80}; do
  [[ $(psql -XAtc "select count(*) from pg_stat_activity where application_name='receipt_seo_first' and wait_event='PgSleep'") == 1 ]] && break
  sleep 0.05
done
set +e
second_output=$(psql -X -v ON_ERROR_STOP=1 -c "select test_receipt_claim('$owner','run-b','b','market_only',1);" 2>&1)
second=$?
set -e
wait "$first"
test "$second" -ne 0
[[ "$second_output" == *"자리를 사용했습니다"* ]]
if psql -X -v ON_ERROR_STOP=1 -c "insert into shopling_market_auto_orchestrations(owner_id,run_ids,token_hash,state,result) values('$owner','[\"ordinary-run\"]','ordinary','market_ready','{\"mode\":\"market_only\"}');"; then exit 1; fi
if psql -X -v ON_ERROR_STOP=1 -c "select test_receipt_claim('$owner','run-a','another','market_only',5);"; then exit 1; fi
if psql -X -v ON_ERROR_STOP=1 -c "select test_receipt_claim('$owner','run-c','new','full_pipeline',5);"; then exit 1; fi
psql -X -v ON_ERROR_STOP=1 -c "update shopling_market_auto_orchestrations set state='completed',completed_at=now() where token_hash='a';"
if psql -X -v ON_ERROR_STOP=1 -c "select test_receipt_claim('$owner','run-b','b','market_only',1);"; then exit 1; fi
psql -X -v ON_ERROR_STOP=1 -c "select test_receipt_claim('00000000-0000-4000-8000-000000000002','run-a','different-owner','market_only',1);"
test "$(psql -XAtc 'select count(*) from shopling_market_auto_orchestrations')" = 2
echo "PASS original handoff deduplication and last-slot concurrency"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  owner uuid := '00000000-0000-4000-8000-000000000001';
  run_id text := 'seo-run-receipt-'||repeat('a',64);
  proof jsonb;
begin
  insert into seo_listing_lifecycle_records(owner_id,market_account_key,launch_item_id,state,current_run_id,goods_key,attempt_count,next_eligible_at,evidence)
    select owner,profile,'card','COOLDOWN','old',n::text,1,now()-interval '1 day',
      jsonb_build_object('previousListingDeleted',true,'previousListingDeleteReadbackVerifiedAt',now()-interval '91 days')
    from unnest(array['도매1','도매2','도매3','도매4','소매1','소매2']) with ordinality as t(profile,n);
  select jsonb_agg(jsonb_build_object('owner_id',owner,'launch_item_id','card','current_run_id',run_id,'market_account_key',market_account_key,
    'goods_key',(goods_key::int+10000)::text,'state','LIVE','exposure_verified',true,'requires_review',false,'live_started_at',now(),
    'last_verified_live_at',now(),'sales_count_during_attempt',0,'evidence',jsonb_build_object('shoplingSaleStatus','B','salesEvidenceFresh',true)))
    into proof from seo_listing_lifecycle_records where owner_id=owner;
  if advance_receipt_seo_rotation(owner,'card','old',run_id,proof - 0) <> 0
    or advance_receipt_seo_rotation(owner,'card','old',run_id,jsonb_set(proof,'{0,goods_key}','"1"')) <> 0
    or advance_receipt_seo_rotation(owner,'card','old',run_id,jsonb_set(proof,'{0,requires_review}','true')) <> 0 then raise exception 'Incomplete or reused listings must be held'; end if;
  if advance_receipt_seo_rotation(owner,'card','old',run_id,proof) <> 6 then raise exception 'Six verified successors required'; end if;
  if advance_receipt_seo_rotation(owner,'card','old',run_id,proof) <> 0 then raise exception 'Retry duplicated rotation'; end if;
  if (select count(*) from seo_listing_lifecycle_records where owner_id=owner and current_run_id=run_id and attempt_count=2) <> 6
     or (select count(*) from seo_listing_lifecycle_events where owner_id=owner and evidence->'previous'->>'current_run_id'='old') <> 6 then raise exception 'Attempt history lost'; end if;
end $$;
SQL
