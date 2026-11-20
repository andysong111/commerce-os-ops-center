-- The live Shopling product 115236 was independently read after the owner-confirmed
-- AAA014 correction. Keep this read-derived cache aligned with that receipt without
-- changing any product, option, sale, stock, or canonical option-barcode field.
do $precondition$
declare
  v_source_count integer;
  v_target_count integer;
begin
  select count(*)
    into v_source_count
    from public.shopling_bcode_option_index
   where goods_key = '115236'
     and option_id = '24679638'
     and barcode = 'BCG4-3';

  if v_source_count <> 1 then
    raise exception 'AAA014_SHOPLING_INDEX_SOURCE_PRECONDITION_FAILED:%', v_source_count;
  end if;

  select count(*)
    into v_target_count
    from public.shopling_bcode_option_index
   where goods_key = '115236'
     and option_id = '24679638'
     and barcode = 'BCG4-2';

  if v_target_count <> 0 then
    raise exception 'AAA014_SHOPLING_INDEX_TARGET_ALREADY_EXISTS:%', v_target_count;
  end if;
end
$precondition$;

update public.shopling_bcode_option_index
   set barcode = 'BCG4-2',
       source = 'OWNER_CONFIRMED_SHOPLING_READBACK',
       last_seen_at = now(),
       updated_at = now()
 where goods_key = '115236'
   and option_id = '24679638'
   and barcode = 'BCG4-3';

do $postcondition$
declare
  v_correct_count integer;
  v_stale_count integer;
begin
  select count(*)
    into v_correct_count
    from public.shopling_bcode_option_index
   where goods_key = '115236'
     and (
       (option_id = '24679638' and barcode = 'BCG4-2')
       or (option_id = '24679639' and barcode = 'BCG4-3')
     );

  select count(*)
    into v_stale_count
    from public.shopling_bcode_option_index
   where goods_key = '115236'
     and option_id = '24679638'
     and barcode = 'BCG4-3';

  if v_correct_count <> 2 or v_stale_count <> 0 then
    raise exception
      'AAA014_SHOPLING_INDEX_POSTCONDITION_FAILED:correct=%,stale=%',
      v_correct_count,
      v_stale_count;
  end if;
end
$postcondition$;
