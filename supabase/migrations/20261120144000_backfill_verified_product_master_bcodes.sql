begin;

create temp table verified_product_master_bcodes_20261120(
  option_barcode_no text primary key,
  b_code text not null unique
) on commit drop;

insert into verified_product_master_bcodes_20261120(option_barcode_no,b_code)
values
  ('000000000074','BBA2-3'),
  ('000000000110','BBC1-1'),
  ('000000000131','BBD4-2'),
  ('000000000623','BEF6-1'),
  ('000000000625','BEF6-3'),
  ('000000000704','BAA3-1'),
  ('000000000705','BAA3-2'),
  ('000000000706','BAA3-3'),
  ('000000000707','BAA4-1'),
  ('000000000708','BAA4-3'),
  ('000000000709','BAA4-2'),
  ('000000000711','BAE4-1'),
  ('000000000713','BBC1-2'),
  ('000000000714','BBC1-3'),
  ('000000000715','BBC3-3'),
  ('000000000716','BBC4-1'),
  ('000000000717','BBD8-1'),
  ('000000000718','BBD8-2'),
  ('000000000719','BCB8-3'),
  ('000000000722','BDB8-2'),
  ('000000000932','BDG1-1'),
  ('000000000933','BDG1-2'),
  ('000000001076','BBE5-1'),
  ('000000001077','BBE5-2'),
  ('000000001078','BBE5-3');

do $guard$
declare
  r record;
begin
  if exists(
    select 1
    from verified_product_master_bcodes_20261120 wanted
    join public.option_bcode_projection_ledger existing
      on existing.b_code=wanted.b_code
     and existing.option_barcode_no<>wanted.option_barcode_no
  ) then
    raise exception 'VERIFIED_BCODE_BACKFILL_CONFLICT';
  end if;

  for r in
    select * from verified_product_master_bcodes_20261120 order by option_barcode_no
  loop
    perform public.apply_option_bcode_projection(
      'canonical-backfill-20261120:'||r.option_barcode_no,
      r.option_barcode_no,
      r.b_code,
      'product_master_verified_backfill',
      now()
    );
  end loop;
end
$guard$;

do $postcondition$
declare
  v_count integer;
begin
  select count(*) into v_count
  from verified_product_master_bcodes_20261120 wanted
  join public.option_bcode_projection_ledger actual
    on actual.option_barcode_no=wanted.option_barcode_no
   and actual.b_code=wanted.b_code;
  if v_count<>25 then
    raise exception 'VERIFIED_BCODE_BACKFILL_POSTCONDITION_FAILED expected=25 actual=%',v_count;
  end if;

  if exists(
    select 1 from public.product_launch_options
    where option_barcode_no='000000000131' and barcode<>'BBD4-2'
  ) then
    raise exception 'AAA383_OPS_PROJECTION_FAILED';
  end if;
end
$postcondition$;

commit;
