do $migration$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.product_launch_options o
  join public.product_launch_items i on i.owner_id = o.owner_id and i.item_id = o.item_id
  where (i.model_number, o.sale_option, o.barcode) in (
    ('AAA014', '하늘S', 'BDE5-1'),
    ('AAA022', '90ml 회색', 'BDE5-2'),
    ('AAA022', '90ml 하늘', 'BDE5-3'),
    ('AAA086', '상어', 'BDF2-1'),
    ('AAA103', '블랙', 'BDF2-2'),
    ('AAA103', '브라운', 'BDF2-3'),
    ('AAA103', '베이지', 'BDF3-1'),
    ('AAA275', '17x12x6.5', 'BDG5-1'),
    ('AAA275', '15x15x7', 'BDG5-2'),
    ('AAA278', '블랙', 'BDG5-3'),
    ('AAA278', '레드', 'BDG6-1')
  );
  if v_count <> 11 then
    raise exception 'OWNER_CONFIRMED_BCODE_STALE_OWNER_PRECONDITION_FAILED expected=11 actual=%', v_count;
  end if;

  with displaced(model_number, sale_option) as (
    values
      ('AAA014', '하늘S'),
      ('AAA022', '90ml 회색'),
      ('AAA022', '90ml 하늘'),
      ('AAA086', '상어'),
      ('AAA103', '블랙'),
      ('AAA103', '브라운'),
      ('AAA103', '베이지'),
      ('AAA275', '17x12x6.5'),
      ('AAA275', '15x15x7'),
      ('AAA278', '블랙'),
      ('AAA278', '레드')
  )
  update public.product_launch_options o
     set barcode = '',
         option_barcode_identity_key = 'OPTION:HOLD:LOCATION:20261029:' || o.owner_id::text || ':' || o.item_id || ':' || o.option_id,
         option_payload = coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
           'barcode', '',
           'stockState', '위치 확인 필요',
           'locationHold', jsonb_build_object(
             'source', 'owner_direct_physical_confirmation_20261029',
             'reason', '새 실물 위치 확인으로 과거 추정 위치 해제',
             'updatedAt', now()
           )
         ),
         updated_at = now()
    from public.product_launch_items i, displaced d
   where i.owner_id = o.owner_id
     and i.item_id = o.item_id
     and i.model_number = d.model_number
     and o.sale_option = d.sale_option;

  with mapping(model_number, sale_option, barcode) as (
    values
      ('AAA116', '블랙17mm', 'BCH4-1'),
      ('AAA116', '블랙20mm', 'BCH4-2'),
      ('AAA116', '블랙23mm', 'BCH4-3'),
      ('AAA116', '골드17mm', 'BCH3-1'),
      ('AAA116', '골드20mm', 'BCH3-2'),
      ('AAA116', '골드23mm', 'BCH3-3')
  )
  update public.product_launch_options o
     set barcode = m.barcode,
         option_payload = coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
           'barcode', m.barcode,
           'stockState', '확정',
           'locationConfirmation', jsonb_build_object(
             'source', 'owner_direct_physical_confirmation_20261026',
             'updatedAt', now()
           )
         ),
         updated_at = now()
    from public.product_launch_items i, mapping m
   where i.owner_id = o.owner_id
     and i.item_id = o.item_id
     and i.model_number = m.model_number
     and o.sale_option = m.sale_option;

  with mapping(model_number, sale_option, barcode) as (
    values
      ('AAA410', '브라운', 'BDG5-1'),
      ('AAA410', '화이트', 'BDG5-2'),
      ('AAA410', '핑크', 'BDG5-3'),
      ('AAA410', '그레이', 'BDG6-1'),
      ('AAA412', '화이트', 'BDF4-1'),
      ('AAA412', '베이지', 'BDF4-2'),
      ('AAA413', '브라운', 'BDE5-1'),
      ('AAA413', '베이지', 'BDE5-2'),
      ('AAA413', '화이트', 'BDE5-3')
  )
  update public.product_launch_options o
     set barcode = m.barcode,
         option_payload = coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
           'barcode', m.barcode,
           'stockState', '확정',
           'locationConfirmation', jsonb_build_object(
             'source', 'owner_direct_physical_confirmation_20261029',
             'updatedAt', now()
           )
         ),
         updated_at = now()
    from public.product_launch_items i, mapping m
   where i.owner_id = o.owner_id
     and i.item_id = o.item_id
     and i.model_number = m.model_number
     and o.sale_option = m.sale_option;

  select count(*) into v_count
  from public.product_launch_options o
  join public.product_launch_items i on i.owner_id = o.owner_id and i.item_id = o.item_id
  where (i.model_number, o.sale_option, o.barcode) in (
    ('AAA410', '브라운', 'BDG5-1'),
    ('AAA410', '화이트', 'BDG5-2'),
    ('AAA410', '핑크', 'BDG5-3'),
    ('AAA410', '그레이', 'BDG6-1'),
    ('AAA412', '화이트', 'BDF4-1'),
    ('AAA412', '베이지', 'BDF4-2'),
    ('AAA413', '브라운', 'BDE5-1'),
    ('AAA413', '베이지', 'BDE5-2'),
    ('AAA413', '화이트', 'BDE5-3')
  );
  if v_count <> 9 then
    raise exception 'OWNER_CONFIRMED_BCODE_TARGET_POSTCONDITION_FAILED expected=9 actual=%', v_count;
  end if;

  if exists (
    select 1
    from public.product_launch_items
    where model_number = 'AAA414'
      and (archived_at is null or coalesce(summary_payload->'seoExclusion'->>'excluded', 'false') <> 'true')
  ) then
    raise exception 'AAA414_DISCONTINUED_GUARD_FAILED';
  end if;
end;
$migration$;
