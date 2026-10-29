create or replace function public.resolve_option_barcode_nos(p_requests jsonb)
returns table(identity_key text, option_barcode_no text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req jsonb;
  v_identity text;
  v_kind text;
  v_bcode text;
  v_composition jsonb;
  v_previous_identity text;
  v_existing_no text;
  v_previous_no text;
  v_previous_kind text;
  v_no text;
begin
  if jsonb_typeof(p_requests) <> 'array' then
    raise exception 'p_requests must be a JSON array';
  end if;

  for req in select value from jsonb_array_elements(p_requests)
  loop
    v_identity := btrim(coalesce(req->>'identityKey', ''));
    v_kind := upper(btrim(coalesce(req->>'identityKind', 'B_CODE')));
    v_bcode := upper(regexp_replace(coalesce(req->>'primaryBCode', ''), '\s+', '', 'g'));
    v_composition := coalesce(req->'composition', '[]'::jsonb);
    v_previous_identity := btrim(coalesce(req->>'previousIdentityKey', ''));
    v_existing_no := btrim(coalesce(req->>'existingOptionBarcodeNo', ''));
    v_previous_no := null;
    v_previous_kind := null;
    v_no := null;

    if v_identity = '' or v_kind not in ('B_CODE','OPTION','SET') then
      raise exception 'invalid option barcode identity';
    end if;

    select r.option_barcode_no
      into v_no
      from public.option_barcode_registry as r
     where r.identity_key = v_identity;

    if v_no is not null and v_existing_no <> '' and v_no <> v_existing_no then
      raise exception 'OPTION_BARCODE_IDENTITY_CONFLICT target=% target_no=% existing_no=%',
        v_identity, v_no, v_existing_no;
    end if;

    if v_no is null and v_previous_identity <> '' and v_previous_identity <> v_identity then
      select r.option_barcode_no, upper(r.identity_kind)
        into v_previous_no, v_previous_kind
        from public.option_barcode_registry as r
       where r.identity_key = v_previous_identity;

      if v_previous_no is not null then
        if v_existing_no <> '' and v_previous_no <> v_existing_no then
          raise exception 'OPTION_BARCODE_PREVIOUS_IDENTITY_CONFLICT previous=% previous_no=% existing_no=%',
            v_previous_identity, v_previous_no, v_existing_no;
        end if;

        if (v_previous_kind = 'OPTION' and v_kind = 'B_CODE')
           or (v_previous_kind = 'B_CODE' and v_kind in ('B_CODE','OPTION')) then
          update public.option_barcode_registry as r
             set identity_key = v_identity,
                 identity_kind = v_kind,
                 primary_b_code = v_bcode,
                 composition = v_composition,
                 updated_at = now()
           where r.identity_key = v_previous_identity;
          v_no := v_previous_no;
        end if;
      end if;
    end if;

    if v_no is null then
      v_no := lpad(nextval('public.option_barcode_no_seq')::text, 12, '0');
      insert into public.option_barcode_registry (
        identity_key, option_barcode_no, identity_kind, primary_b_code, composition
      ) values (
        v_identity, v_no, v_kind, v_bcode, v_composition
      )
      on conflict on constraint option_barcode_registry_pkey do nothing;

      select r.option_barcode_no
        into v_no
        from public.option_barcode_registry as r
       where r.identity_key = v_identity;
    end if;

    identity_key := v_identity;
    option_barcode_no := v_no;
    return next;
  end loop;
end;
$function$;

create or replace function public.sync_product_launch_option_barcode_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_bcode text;
  v_explicit_identity text;
  v_previous_identity text;
  v_identity text;
  v_kind text;
  v_existing_no text;
  v_no text;
begin
  new.option_payload := coalesce(new.option_payload, '{}'::jsonb);
  v_bcode := upper(regexp_replace(
    case
      when tg_op = 'UPDATE' then coalesce(new.barcode, '')
      else coalesce(nullif(new.barcode, ''), new.option_payload->>'barcode', '')
    end,
    '\s+',
    '',
    'g'
  ));
  v_explicit_identity := coalesce(
    nullif(new.option_barcode_identity_key, ''),
    nullif(new.option_payload->>'optionBarcodeIdentityKey', ''),
    ''
  );
  v_previous_identity := case
    when tg_op = 'UPDATE' then coalesce(
      nullif(old.option_barcode_identity_key, ''),
      nullif(old.option_payload->>'optionBarcodeIdentityKey', ''),
      ''
    )
    else ''
  end;
  v_existing_no := case
    when tg_op = 'UPDATE' then coalesce(
      nullif(old.option_barcode_no, ''),
      nullif(old.option_payload->>'optionBarcodeNo', ''),
      ''
    )
    else coalesce(
      nullif(new.option_barcode_no, ''),
      nullif(new.option_payload->>'optionBarcodeNo', ''),
      ''
    )
  end;

  if v_explicit_identity like 'SET:%' then
    v_identity := v_explicit_identity;
    v_kind := 'SET';
  elsif v_bcode <> '' then
    v_identity := 'B:' || v_bcode;
    v_kind := 'B_CODE';
  else
    v_identity := 'OPTION:' || new.owner_id::text || ':' || new.item_id || ':' || new.option_id;
    v_kind := 'OPTION';
  end if;

  select r.option_barcode_no
    into v_no
  from public.resolve_option_barcode_nos(
    jsonb_build_array(
      jsonb_build_object(
        'identityKey', v_identity,
        'identityKind', v_kind,
        'primaryBCode', v_bcode,
        'composition', coalesce(new.option_payload->'setComposition', '[]'::jsonb),
        'previousIdentityKey', v_previous_identity,
        'existingOptionBarcodeNo', v_existing_no
      )
    )
  ) r
  limit 1;

  if v_no is null or v_no !~ '^[0-9]{12}$' then
    raise exception 'OPTION_BARCODE_AUTO_ISSUE_FAILED identity=%', v_identity;
  end if;

  new.barcode := v_bcode;
  new.option_barcode_no := v_no;
  new.option_barcode_identity_key := v_identity;
  new.option_payload := new.option_payload || jsonb_build_object(
    'barcode', v_bcode,
    'optionBarcodeNo', v_no,
    'optionBarcodeIdentityKey', v_identity,
    'optionBarcodeIdentityKind', v_kind
  );
  return new;
end;
$function$;

create or replace function public.refresh_product_launch_item_option_barcodes()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_item text;
  v_labels text[];
  v_barcodes text[];
  v_nos text[];
  v_order_options jsonb;
  v_option_locations jsonb;
  v_option_count integer;
  v_missing_count integer;
  v_first_missing text;
  v_representative text;
  v_readiness jsonb;
  v_item_payload jsonb;
begin
  v_owner := coalesce(new.owner_id, old.owner_id);
  v_item := coalesce(new.item_id, old.item_id);

  select
    coalesce(array_agg(coalesce(nullif(o.sale_option, ''), nullif(o.option_name, ''), '옵션 ' || (o.option_index + 1)::text) order by o.option_index), '{}'::text[]),
    coalesce(array_agg(o.barcode order by o.option_index) filter (where btrim(o.barcode) <> ''), '{}'::text[]),
    coalesce(array_agg(o.option_barcode_no order by o.option_index) filter (where btrim(o.option_barcode_no) <> ''), '{}'::text[]),
    coalesce(jsonb_agg(
      coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
        'id', o.option_id,
        'optionName', o.option_name,
        'saleOption', o.sale_option,
        'chinaOption', o.china_option,
        'barcode', o.barcode,
        'optionBarcodeNo', o.option_barcode_no,
        'optionBarcodeIdentityKey', o.option_barcode_identity_key,
        'optionBarcodeIdentityKind', case when o.option_barcode_identity_key like 'B:%' then 'B_CODE' when o.option_barcode_identity_key like 'SET:%' then 'SET' else 'OPTION' end
      ) order by o.option_index
    ), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', o.option_id,
      'index', o.option_index,
      'label', coalesce(nullif(o.sale_option, ''), nullif(o.option_name, ''), '옵션 ' || (o.option_index + 1)::text),
      'barcode', o.barcode
    ) order by o.option_index), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where btrim(o.barcode) = '')::integer
  into v_labels, v_barcodes, v_nos, v_order_options, v_option_locations, v_option_count, v_missing_count
  from public.product_launch_options o
  where o.owner_id = v_owner and o.item_id = v_item;

  select coalesce(nullif(o.sale_option, ''), nullif(o.option_name, ''), '옵션 ' || (o.option_index + 1)::text)
    into v_first_missing
  from public.product_launch_options o
  where o.owner_id = v_owner and o.item_id = v_item and btrim(o.barcode) = ''
  order by o.option_index
  limit 1;

  select o.barcode
    into v_representative
  from public.product_launch_options o
  where o.owner_id = v_owner and o.item_id = v_item and btrim(o.barcode) <> ''
  order by o.option_index
  limit 1;

  select coalesce(i.summary_payload->'readiness', '{}'::jsonb)
    into v_readiness
  from public.product_launch_items i
  where i.owner_id = v_owner and i.item_id = v_item;

  if v_missing_count > 0 then
    v_readiness := jsonb_build_object(
      'ready', false,
      'errorCount', v_missing_count,
      'firstError', coalesce(v_first_missing, '옵션') || ' B코드가 없습니다.',
      'warningCount', coalesce((v_readiness->>'warningCount')::integer, 0)
    );
  elsif coalesce(v_readiness->>'firstError', '') like '%B코드가 없습니다.%' then
    v_readiness := jsonb_build_object(
      'ready', true,
      'errorCount', 0,
      'firstError', '',
      'warningCount', coalesce((v_readiness->>'warningCount')::integer, 0)
    );
  end if;

  update public.product_launch_items i
     set barcode = coalesce(v_representative, ''),
         warehouse_location = coalesce(v_representative, ''),
         option_labels = v_labels,
         option_barcodes = v_barcodes,
         option_barcode_nos = v_nos,
         item_payload = coalesce(i.item_payload, '{}'::jsonb) || jsonb_build_object(
           'barcode', coalesce(v_representative, ''),
           'warehouseLocation', coalesce(v_representative, ''),
           'optionLabels', to_jsonb(v_labels),
           'optionBarcodeNos', to_jsonb(v_nos),
           'orderOptions', v_order_options,
           'updatedAt', now(),
           'updatedBy', 'Commerce OS · B코드 위치 동기화'
         ),
         summary_payload = coalesce(i.summary_payload, '{}'::jsonb) || jsonb_build_object(
           'barcode', coalesce(v_representative, ''),
           'warehouseLocation', coalesce(v_representative, ''),
           'optionLabels', to_jsonb(v_labels),
           'optionCount', v_option_count,
           'orderOptions', v_order_options,
           'optionLocations', v_option_locations,
           'readiness', v_readiness,
           'updatedAt', now(),
           'updatedBy', 'Commerce OS · B코드 위치 동기화'
         ),
         updated_at = now()
   where i.owner_id = v_owner and i.item_id = v_item
   returning i.item_payload into v_item_payload;

  update public.product_launch_tracker_states s
     set state_payload = jsonb_set(
           s.state_payload,
           '{items}',
           coalesce((
             select jsonb_agg(case when item.value->>'id' = v_item then v_item_payload else item.value end order by item.ordinality)
             from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb)) with ordinality as item(value, ordinality)
           ), '[]'::jsonb),
           true
         ),
         updated_at = now()
   where s.owner_id = v_owner
     and exists (
       select 1
       from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb)) item
       where item->>'id' = v_item
     );

  return coalesce(new, old);
end;
$function$;
