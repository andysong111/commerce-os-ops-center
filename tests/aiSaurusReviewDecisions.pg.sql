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

rollback;

select 'PASS B-code conflicts, permanent rejection, one retry, stale revision, owner isolation and function permissions';
