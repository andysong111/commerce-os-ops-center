begin;

-- A previous release stored an item ID without the display B-code snapshot.
insert into public.product_launch_options (owner_id, item_id, barcode)
values ('10000000-0000-4000-8000-000000000000', 'primary-item', 'BDG6-2');

insert into public.ai_saurus_detail_batches (id, owner_id, selection_hash, revision, payload)
values
  ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000000', repeat('1',64),5,
   '{"id":"10000000-0000-4000-8000-000000000001","revision":5,"products":[{"id":"primary-item","model":"AAA496","attempts":1,"stage":"awaiting_review"}]}'),
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000000', repeat('2',64),0,
   '{"id":"10000000-0000-4000-8000-000000000002","revision":0,"products":[{"id":"alias-item","attempts":0,"stage":"draft"}]}'),
  ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000000', repeat('2',64),0,
   '{"id":"20000000-0000-4000-8000-000000000002","revision":0,"products":[{"id":"alias-item","attempts":0,"stage":"draft"}]}');

insert into public.product_launch_tracker_states values ('10000000-0000-4000-8000-000000000000', '2026-11-28T12:05:00Z');
insert into public.product_launch_workspaces values ('10000000-0000-4000-8000-000000000000', '2026-11-28T12:00:00Z', '2026-11-28T12:00:00Z', '{}');
insert into public.product_launch_items (owner_id, item_id, item_payload, summary_payload, updated_at)
values ('10000000-0000-4000-8000-000000000000', 'primary-item',
        '{"warehouseLocation":"BDG6-2","salePrice":15000,"detailPageAsset":{"resultId":"keep"}}',
        '{"detailPageAsset":null,"existingSummary":"keep"}', '2026-11-28T12:00:00Z'),
       ('10000000-0000-4000-8000-000000000000', 'alias-item',
        '{"detailPageAsset":{"mainImageUrl":"other"}}', '{}', '2026-11-28T12:00:00Z');

set local role service_role;
do $test$
declare
  owner_id uuid := '10000000-0000-4000-8000-000000000000';
  original_id uuid := '10000000-0000-4000-8000-000000000001';
  alias_id uuid := '10000000-0000-4000-8000-000000000002';
  other_owner uuid := '20000000-0000-4000-8000-000000000000';
  other_batch uuid := '20000000-0000-4000-8000-000000000002';
  candidate jsonb := '{"id":"alias-item","attempts":1,"stage":"running","bCodes":["BDG6-2"]}';
  original jsonb := '{"id":"primary-item","attempts":1,"stage":"rejected","model":"AAA496","bCodes":["BDG6-2"]}';
  conflict record;
  total integer;
begin
  if has_function_privilege('anon', 'public.commit_ai_saurus_review_batch(uuid,uuid,integer,jsonb,text[])', 'execute')
    or has_function_privilege('authenticated', 'public.find_ai_saurus_review_conflict(uuid,uuid,jsonb)', 'execute') then
    raise exception 'Review functions escaped the service role';
  end if;
  select * into conflict from public.find_ai_saurus_review_conflict(owner_id, alias_id, jsonb_build_array(candidate));
  if conflict.batch_id is distinct from original_id or conflict.stage is distinct from 'awaiting_review' then
    raise exception 'The prior B-code was not found through its normalized option row';
  end if;
  select count(*) into total from public.commit_ai_saurus_review_batch(owner_id, original_id, 5,
    jsonb_build_object('id',original_id,'revision',6,'updatedAt','2026-11-28T12:00:00Z','products',jsonb_build_array(original)),
    array['primary-item']);
  if total <> 1 then raise exception 'The original batch could not persist its rejection'; end if;

  begin
    perform public.commit_ai_saurus_review_batch(owner_id, alias_id, 0,
      jsonb_build_object('id',alias_id,'revision',1,'updatedAt','2026-11-28T12:00:00Z','products',jsonb_build_array(candidate)),
      array['alias-item']);
    raise exception 'The same rejected B-code was started in a different batch';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%승인 거절%' then raise; end if;
  end;

  begin
    perform public.commit_ai_saurus_review_batch(owner_id, original_id, 6,
      jsonb_build_object('id',original_id,'revision',7,'updatedAt','2026-11-28T12:00:00Z','products',
        jsonb_build_array(original || '{"stage":"running","attempts":2}'::jsonb)), array['primary-item']);
    raise exception 'The rejected B-code was started in its original batch';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%승인 거절%' then raise; end if;
  end;

  select count(*) into total from public.commit_ai_saurus_review_batch(other_owner, other_batch, 0,
    jsonb_build_object('id',other_batch,'revision',1,'updatedAt','2026-11-28T12:00:00Z','products',jsonb_build_array(candidate)),
    array['alias-item']);
  if total <> 1 then raise exception 'The unrelated owner was blocked'; end if;
  select count(*) into total from public.commit_ai_saurus_review_batch(other_owner, other_batch, 0,
    jsonb_build_object('id',other_batch,'revision',1,'updatedAt','2026-11-28T12:00:00Z','products',jsonb_build_array(candidate)),
    array['alias-item']);
  if total <> 0 then raise exception 'A stale revision wrote a second result'; end if;
  select count(*) into total from public.commit_ai_saurus_review_batch(other_owner, other_batch, 1,
    jsonb_build_object('id',other_batch,'revision',2,'updatedAt','2026-11-28T12:00:00Z','products',
      jsonb_build_array(candidate || '{"attempts":2}'::jsonb)), array['alias-item']);
  if total <> 1 then raise exception 'One retry should be permitted for a non-rejected item'; end if;
  begin
    perform public.commit_ai_saurus_review_batch(other_owner, other_batch, 2,
      jsonb_build_object('id',other_batch,'revision',3,'updatedAt','2026-11-28T12:00:00Z','products',
        jsonb_build_array(candidate || '{"attempts":3}'::jsonb)), array['alias-item']);
    raise exception 'A third start escaped the retry limit';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%재시도%' then raise; end if;
  end;
end;
$test$;

select 'PASS B-code conflicts, permanent rejection, one retry, stale revision, owner isolation and function permissions' as proof;

do $test$
declare
  owner_id uuid := '10000000-0000-4000-8000-000000000000';
  old_revision timestamptz := '2026-11-28T12:00:00Z';
  current_revision timestamptz := '2026-11-28T12:05:00Z';
  fixture jsonb := '{"itemId":"primary-item","asset":{"mainImageUrl":"main","detailImageUrl":"detail","additionalImageUrls":["alt"],"html":"<img>"},"summaryAsset":{"mainImageUrl":"main","detailImageUrl":"detail","additionalImageUrls":["alt"]},"readiness":{"ready":true,"errorCount":0,"warningCount":0}}';
begin
  if has_function_privilege('authenticated', 'public.sync_product_launch_image_materials(uuid,timestamptz,timestamptz,jsonb,jsonb)', 'execute') then
    raise exception 'The image mirror escaped the service role';
  end if;
  if public.sync_product_launch_image_materials(owner_id, old_revision, old_revision, '{}', jsonb_build_array(fixture)) then
    raise exception 'A stale image mirror advanced the workspace';
  end if;
  begin
    perform public.sync_product_launch_image_materials(owner_id, old_revision, current_revision, '{}',
      jsonb_build_array(fixture, fixture || '{"itemId":"missing"}'));
    raise exception 'A missing product failed to roll back a partial mirror';
  exception when sqlstate 'PT409' then null;
  end;
  if exists (select 1 from public.product_launch_items where (item_payload->'detailPageAsset') ? 'html') then
    raise exception 'A partial image mirror altered an item';
  end if;
  if not public.sync_product_launch_image_materials(owner_id, old_revision, current_revision,
    '{"등록 준비":1}', jsonb_build_array(fixture)) then
    raise exception 'The valid B-code image mirror did not sync';
  end if;
  if not exists (select 1 from public.product_launch_items i where i.item_id = 'primary-item'
      and i.item_payload = '{"warehouseLocation":"BDG6-2","salePrice":15000,"detailPageAsset":{"resultId":"keep","mainImageUrl":"main","detailImageUrl":"detail","additionalImageUrls":["alt"],"html":"<img>"}}'
      and i.summary_payload->>'existingSummary' = 'keep'
      and i.summary_payload#>>'{detailPageAsset,mainImageUrl}' = 'main'
      and i.readiness_ready and i.readiness_error_count = 0
      and i.updated_at = current_revision)
    or not exists (select 1 from public.product_launch_items i where i.item_id = 'alias-item'
      and i.item_payload = '{"detailPageAsset":{"mainImageUrl":"other"}}')
    or not exists (select 1 from public.product_launch_options o where o.item_id = 'primary-item' and o.barcode = 'BDG6-2')
    or not exists (select 1 from public.product_launch_workspaces w where w.source_state_updated_at = current_revision
      and w.counts = '{"등록 준비":1}') then
    raise exception 'An image mirror altered non-image data or missed saved SEO materials';
  end if;
end;
$test$;

rollback;

select 'PASS image-only normalized mirror preserves B-code options, unrelated products and metadata, and rolls back stale writes' as proof;
