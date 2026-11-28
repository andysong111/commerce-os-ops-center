begin;

-- Active B-code decisions stay in the original batch. A second selection must
-- not open a second attempt or change a rejected product back to AI production.
create function public.find_ai_saurus_review_conflict(
  p_owner uuid, p_batch_id uuid, p_products jsonb
)
returns table (batch_id uuid, model text, stage text)
language sql
stable
security invoker
set search_path = ''
as $function$
  select b.id, coalesce(previous.item->>'model', previous.item->>'id'), previous.item->>'stage'
  from public.ai_saurus_detail_batches b
  cross join lateral jsonb_array_elements(b.payload->'products') previous(item)
  cross join lateral jsonb_array_elements(p_products) wanted(item)
  where b.owner_id = p_owner
    and (b.id is distinct from p_batch_id or previous.item->>'id' <> wanted.item->>'id')
    and (previous.item->>'stage' = 'rejected' or (previous.item->>'attempts') ~ '^[1-9][0-9]*$')
    and (
      previous.item->>'id' = wanted.item->>'id'
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(wanted.item->'bCodes', '[]'::jsonb)) code(value)
        where coalesce(previous.item->'bCodes', '[]'::jsonb) ? code.value
          or exists (
            select 1 from public.product_launch_options o
            where o.owner_id = p_owner and o.item_id = previous.item->>'id' and o.barcode = code.value
          )
      )
    )
  order by (previous.item->>'stage' = 'rejected') desc, b.updated_at desc, b.id
  limit 1;
$function$;

create function public.commit_ai_saurus_review_batch(
  p_owner uuid, p_batch_id uuid, p_expected_revision integer, p_payload jsonb, p_item_ids text[]
)
returns setof public.ai_saurus_detail_batches
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  wanted jsonb;
  previous_payload jsonb;
  collision record;
begin
  if p_owner is null or p_batch_id is null or p_expected_revision is null
    or cardinality(p_item_ids) is null or cardinality(p_item_ids) not between 1 and 20
    or (p_payload->>'id') is distinct from p_batch_id::text
    or (p_payload->>'revision') is distinct from (p_expected_revision + 1)::text then
    raise exception 'Invalid review batch commit' using errcode = '22023';
  end if;

  -- Serialize the owner-level cross-batch check with the batch compare-and-set.
  perform pg_advisory_xact_lock(hashtextextended('ops-saurus-review:' || p_owner::text, 0));
  select b.payload into previous_payload from public.ai_saurus_detail_batches b
  where b.owner_id = p_owner and b.id = p_batch_id and b.revision = p_expected_revision
  for update;
  if not found then return; end if;

  select jsonb_agg(p.item) into wanted
  from jsonb_array_elements(p_payload->'products') p(item)
  where p.item->>'id' = any(p_item_ids);
  if jsonb_array_length(wanted) is distinct from cardinality(p_item_ids) then
    raise exception 'Invalid review decision selection' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(wanted) next(item)
    left join lateral jsonb_array_elements(previous_payload->'products') prior(item)
      on prior.item->>'id' = next.item->>'id'
    where prior.item is null
      or (prior.item->>'stage' = 'rejected' and next.item->>'stage' is distinct from 'rejected')
      or coalesce((next.item->>'attempts')::integer, -1) not between
        (prior.item->>'attempts')::integer and least((prior.item->>'attempts')::integer + 1, 2)
  ) then
    raise exception '승인 거절된 상품이거나 재시도 횟수를 확인할 수 없습니다.' using errcode = 'PT409';
  end if;

  select * into collision from public.find_ai_saurus_review_conflict(p_owner, p_batch_id, wanted);
  if found then
    if collision.stage = 'rejected' then
      raise exception '이 B코드는 승인 거절되어 직접 제작 URL만 입력할 수 있습니다.' using errcode = 'PT409';
    end if;
    raise exception '이 B코드는 이전 작업 묶음에서 이미 제작을 시작했습니다.' using errcode = 'PT409';
  end if;

  return query
  update public.ai_saurus_detail_batches b
  set revision = p_expected_revision + 1, payload = p_payload,
      updated_at = (p_payload->>'updatedAt')::timestamptz
  where b.owner_id = p_owner and b.id = p_batch_id and b.revision = p_expected_revision
  returning b.*;
end;
$function$;

revoke all on function public.find_ai_saurus_review_conflict(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.commit_ai_saurus_review_batch(uuid, uuid, integer, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.find_ai_saurus_review_conflict(uuid, uuid, jsonb) to service_role;
grant execute on function public.commit_ai_saurus_review_batch(uuid, uuid, integer, jsonb, text[]) to service_role;

commit;
