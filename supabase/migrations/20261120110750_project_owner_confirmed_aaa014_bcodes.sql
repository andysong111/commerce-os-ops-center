do $precondition$
declare v_count integer;
begin
  select count(*) into v_count
  from public.product_launch_options o
  join public.product_launch_items i on i.owner_id=o.owner_id and i.item_id=o.item_id
  where upper(i.model_number)='AAA014'
    and (o.option_barcode_no,o.sale_option,coalesce(o.barcode,'')) in (
      ('000000000872','퍼플M','BDE4-3'),
      ('000000000873','하늘S','')
    );
  if v_count<>2 then raise exception 'AAA014_PROJECTION_PRECONDITION_FAILED expected=2 actual=%',v_count; end if;

  select count(*) into v_count
  from public.option_barcode_registry
  where (option_barcode_no,identity_key,primary_b_code) in (
    ('000000000855','B:BCG4-2','BCG4-2'),
    ('000000000854','B:BCG4-3','BCG4-3')
  ) and not exists(
    select 1 from public.product_launch_options o
    where o.option_barcode_no=option_barcode_registry.option_barcode_no
  );
  if v_count<>2 then raise exception 'AAA014_ORPHAN_REGISTRY_PRECONDITION_FAILED expected=2 actual=%',v_count; end if;
end
$precondition$;

do $project$
begin
  perform public.release_option_bcode_projection(
    'owner-confirmed-20261120:release-orphan:000000000855',
    '000000000855','BCG4-2','owner_identity_reconciliation_20261120',now()
  );
  perform public.release_option_bcode_projection(
    'owner-confirmed-20261120:release-orphan:000000000854',
    '000000000854','BCG4-3','owner_identity_reconciliation_20261120',now()
  );
  perform public.apply_option_bcode_projection(
    'owner-confirmed-20261120:AAA014:000000000872',
    '000000000872','BCG4-2','owner_direct_physical_confirmation_20261120',now()
  );
  perform public.apply_option_bcode_projection(
    'owner-confirmed-20261120:AAA014:000000000873',
    '000000000873','BCG4-3','owner_direct_physical_confirmation_20261120',now()
  );
end
$project$;

do $postcondition$
declare v_count integer;
begin
  select count(*) into v_count
  from public.product_launch_options o
  join public.product_launch_items i on i.owner_id=o.owner_id and i.item_id=o.item_id
  where upper(i.model_number)='AAA014'
    and (o.option_barcode_no,o.sale_option,o.barcode,o.option_barcode_identity_key) in (
      ('000000000872','퍼플M','BCG4-2','B:BCG4-2'),
      ('000000000873','하늘S','BCG4-3','B:BCG4-3')
    );
  if v_count<>2 then raise exception 'AAA014_PROJECTION_POSTCONDITION_FAILED expected=2 actual=%',v_count; end if;

  select count(*) into v_count
  from public.option_bcode_projection_ledger
  where (option_barcode_no,b_code) in (
    ('000000000872','BCG4-2'),('000000000873','BCG4-3')
  );
  if v_count<>2 then raise exception 'AAA014_LEDGER_POSTCONDITION_FAILED expected=2 actual=%',v_count; end if;

  select count(*) into v_count
  from public.option_barcode_registry
  where (option_barcode_no,identity_key,identity_kind,coalesce(primary_b_code,'')) in (
    ('000000000855','OPTION:BARCODE:000000000855','OPTION',''),
    ('000000000854','OPTION:BARCODE:000000000854','OPTION','')
  );
  if v_count<>2 then raise exception 'AAA014_ORPHAN_REGISTRY_RELEASE_FAILED expected=2 actual=%',v_count; end if;
end
$postcondition$;
