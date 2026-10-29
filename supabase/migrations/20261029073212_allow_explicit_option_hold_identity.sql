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
  elsif v_explicit_identity like 'OPTION:%' then
    v_identity := v_explicit_identity;
    v_kind := 'OPTION';
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
