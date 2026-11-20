do $precondition$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.product_launch_options o
  join public.product_launch_items i
    on i.owner_id=o.owner_id and i.item_id=o.item_id
  where upper(i.model_number)='AAA022'
    and (o.option_barcode_no,o.sale_option,coalesce(o.barcode,'')) in (
      ('000000000874','90ml 회색',''),
      ('000000000875','90ml 하늘',''),
      ('000000000876','90ml 진청','BDE6-1'),
      ('000000000877','90ml 연두','BDE6-2'),
      ('000000000878','90ml 황토','BDE6-3')
    );
  if v_count<>5 then
    raise exception 'AAA022_PROJECTION_PRECONDITION_FAILED expected=5 actual=%',v_count;
  end if;

  if exists(
    select 1 from public.option_barcode_registry
    where primary_b_code in ('BDE8-2','BDE8-3')
       or identity_key in ('B:BDE8-2','B:BDE8-3')
  ) then
    raise exception 'AAA022_PROJECTION_TARGET_ALREADY_CLAIMED';
  end if;
end
$precondition$;

do $project$
begin
  perform public.apply_option_bcode_projection(
    'owner-confirmed-20261120:AAA022:000000000874',
    '000000000874','BDE8-2','owner_direct_physical_confirmation_20261120',now()
  );
  perform public.apply_option_bcode_projection(
    'owner-confirmed-20261120:AAA022:000000000875',
    '000000000875','BDE8-3','owner_direct_physical_confirmation_20261120',now()
  );
end
$project$;

do $postcondition$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.product_launch_options o
  join public.product_launch_items i
    on i.owner_id=o.owner_id and i.item_id=o.item_id
  where upper(i.model_number)='AAA022'
    and (o.option_barcode_no,o.sale_option,o.barcode,o.option_barcode_identity_key) in (
      ('000000000874','90ml 회색','BDE8-2','B:BDE8-2'),
      ('000000000875','90ml 하늘','BDE8-3','B:BDE8-3'),
      ('000000000876','90ml 진청','BDE6-1','B:BDE6-1'),
      ('000000000877','90ml 연두','BDE6-2','B:BDE6-2'),
      ('000000000878','90ml 황토','BDE6-3','B:BDE6-3')
    );
  if v_count<>5 then
    raise exception 'AAA022_PROJECTION_POSTCONDITION_FAILED expected=5 actual=%',v_count;
  end if;

  select count(*) into v_count
  from public.option_bcode_projection_ledger
  where (option_barcode_no,b_code) in (
    ('000000000874','BDE8-2'),
    ('000000000875','BDE8-3'),
    ('000000000876','BDE6-1'),
    ('000000000877','BDE6-2'),
    ('000000000878','BDE6-3')
  );
  if v_count<>5 then
    raise exception 'AAA022_LEDGER_POSTCONDITION_FAILED expected=5 actual=%',v_count;
  end if;
end
$postcondition$;
