-- Read-derived cache refresh after seven serialized Shopling writes and seven
-- exact readbacks. Only the self-management/location code changed externally.
do $precondition$
declare
  v_source_count integer;
  v_target_count integer;
begin
  with expected(goods_key,option_id,old_b_code,new_b_code) as (values
    ('111890','27080966','BDE5-2','BDE8-2'),
    ('111890','27080967','BDE5-3','BDE8-3'),
    ('111891','22337825','BDE5-2','BDE8-2'),
    ('111891','22337826','BDE5-3','BDE8-3'),
    ('111892','22338808','BDE5-2','BDE8-2'),
    ('111892','22338809','BDE5-3','BDE8-3'),
    ('112204','22799088','BDE5-2','BDE8-2'),
    ('112204','22799089','BDE5-3','BDE8-3'),
    ('112352','22828300','BDE5-2','BDE8-2'),
    ('112352','22828301','BDE5-3','BDE8-3'),
    ('115242','24679628','BDE5-2','BDE8-2'),
    ('115242','24679629','BDE5-3','BDE8-3'),
    ('115410','24717819','BDE5-2','BDE8-2'),
    ('115410','24717818','BDE5-3','BDE8-3')
  )
  select count(*) into v_source_count
  from public.shopling_bcode_option_index i
  join expected e
    on e.goods_key=i.goods_key
   and e.option_id=i.option_id
   and e.old_b_code=i.barcode;
  if v_source_count<>14 then
    raise exception 'AAA022_SHOPLING_INDEX_SOURCE_PRECONDITION_FAILED expected=14 actual=%',v_source_count;
  end if;

  with expected(goods_key,option_id,new_b_code) as (values
    ('111890','27080966','BDE8-2'),('111890','27080967','BDE8-3'),
    ('111891','22337825','BDE8-2'),('111891','22337826','BDE8-3'),
    ('111892','22338808','BDE8-2'),('111892','22338809','BDE8-3'),
    ('112204','22799088','BDE8-2'),('112204','22799089','BDE8-3'),
    ('112352','22828300','BDE8-2'),('112352','22828301','BDE8-3'),
    ('115242','24679628','BDE8-2'),('115242','24679629','BDE8-3'),
    ('115410','24717819','BDE8-2'),('115410','24717818','BDE8-3')
  )
  select count(*) into v_target_count
  from public.shopling_bcode_option_index i
  join expected e
    on e.goods_key=i.goods_key
   and e.option_id=i.option_id
   and e.new_b_code=i.barcode;
  if v_target_count<>0 then
    raise exception 'AAA022_SHOPLING_INDEX_TARGET_ALREADY_EXISTS:%',v_target_count;
  end if;
end
$precondition$;

with expected(goods_key,option_id,old_b_code,new_b_code) as (values
  ('111890','27080966','BDE5-2','BDE8-2'),
  ('111890','27080967','BDE5-3','BDE8-3'),
  ('111891','22337825','BDE5-2','BDE8-2'),
  ('111891','22337826','BDE5-3','BDE8-3'),
  ('111892','22338808','BDE5-2','BDE8-2'),
  ('111892','22338809','BDE5-3','BDE8-3'),
  ('112204','22799088','BDE5-2','BDE8-2'),
  ('112204','22799089','BDE5-3','BDE8-3'),
  ('112352','22828300','BDE5-2','BDE8-2'),
  ('112352','22828301','BDE5-3','BDE8-3'),
  ('115242','24679628','BDE5-2','BDE8-2'),
  ('115242','24679629','BDE5-3','BDE8-3'),
  ('115410','24717819','BDE5-2','BDE8-2'),
  ('115410','24717818','BDE5-3','BDE8-3')
)
update public.shopling_bcode_option_index i
set barcode=e.new_b_code,
    source='OWNER_CONFIRMED_SHOPLING_READBACK',
    last_seen_at=now(),
    updated_at=now()
from expected e
where e.goods_key=i.goods_key
  and e.option_id=i.option_id
  and e.old_b_code=i.barcode;

do $postcondition$
declare
  v_correct_count integer;
  v_stale_count integer;
begin
  with expected(goods_key,option_id,new_b_code) as (values
    ('111890','27080966','BDE8-2'),('111890','27080967','BDE8-3'),
    ('111891','22337825','BDE8-2'),('111891','22337826','BDE8-3'),
    ('111892','22338808','BDE8-2'),('111892','22338809','BDE8-3'),
    ('112204','22799088','BDE8-2'),('112204','22799089','BDE8-3'),
    ('112352','22828300','BDE8-2'),('112352','22828301','BDE8-3'),
    ('115242','24679628','BDE8-2'),('115242','24679629','BDE8-3'),
    ('115410','24717819','BDE8-2'),('115410','24717818','BDE8-3')
  )
  select count(*) into v_correct_count
  from public.shopling_bcode_option_index i
  join expected e
    on e.goods_key=i.goods_key
   and e.option_id=i.option_id
   and e.new_b_code=i.barcode;

  select count(*) into v_stale_count
  from public.shopling_bcode_option_index
  where goods_key in ('111890','111891','111892','112204','112352','115242','115410')
    and barcode in ('BDE5-2','BDE5-3');

  if v_correct_count<>14 or v_stale_count<>0 then
    raise exception 'AAA022_SHOPLING_INDEX_POSTCONDITION_FAILED correct=% stale=%',
      v_correct_count,v_stale_count;
  end if;
end
$postcondition$;
