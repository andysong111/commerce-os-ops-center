-- Atomic replacement for normalized Product Launch options.
-- Prevents DELETE-then-INSERT partial loss if a later insert fails.

create or replace function public.replace_product_launch_options_atomic(
  p_owner_id uuid,
  p_item_id text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_count integer := 0;
  v_distinct_id_count integer := 0;
  v_blank_id_count integer := 0;
  v_inserted_count integer := 0;
begin
  if p_owner_id is null then
    raise exception 'LEGACY_SEO_OPTION_REPLACE_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(btrim(p_item_id), '') = '' then
    raise exception 'LEGACY_SEO_OPTION_REPLACE_ITEM_REQUIRED' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'LEGACY_SEO_OPTION_REPLACE_ROWS_ARRAY_REQUIRED' using errcode = '22023';
  end if;

  select
    count(*),
    count(distinct nullif(btrim(row_data->>'option_id'), '')),
    count(*) filter (where coalesce(btrim(row_data->>'option_id'), '') = '')
  into v_row_count, v_distinct_id_count, v_blank_id_count
  from jsonb_array_elements(p_rows) as row_data;

  if v_blank_id_count > 0 then
    raise exception 'LEGACY_SEO_OPTION_REPLACE_OPTION_ID_REQUIRED' using errcode = '23502';
  end if;
  if v_distinct_id_count <> v_row_count then
    raise exception 'LEGACY_SEO_OPTION_REPLACE_DUPLICATE_OPTION_ID' using errcode = '23505';
  end if;

  -- The delete and insert below run in the same Postgres transaction. Any insert
  -- failure rolls the delete back automatically, preserving the previous rows.
  delete from public.product_launch_options
  where owner_id = p_owner_id
    and item_id = p_item_id;

  if v_row_count > 0 then
    insert into public.product_launch_options (
      owner_id,
      item_id,
      option_id,
      option_index,
      option_name,
      sale_option,
      china_option,
      barcode,
      base_sale_price_krw,
      unit_cost_krw,
      source_order_item_id,
      option_payload,
      updated_at,
      option_barcode_no,
      option_barcode_identity_key
    )
    select
      p_owner_id,
      p_item_id,
      x.option_id,
      coalesce(x.option_index, 0),
      coalesce(x.option_name, '옵션'),
      coalesce(x.sale_option, ''),
      coalesce(x.china_option, ''),
      coalesce(x.barcode, ''),
      greatest(0, coalesce(x.base_sale_price_krw, 0)),
      greatest(0, coalesce(x.unit_cost_krw, 0)),
      x.source_order_item_id,
      coalesce(x.option_payload, '{}'::jsonb),
      coalesce(x.updated_at, now()),
      coalesce(x.option_barcode_no, ''),
      coalesce(x.option_barcode_identity_key, '')
    from jsonb_to_recordset(p_rows) as x(
      option_id text,
      option_index integer,
      option_name text,
      sale_option text,
      china_option text,
      barcode text,
      base_sale_price_krw bigint,
      unit_cost_krw bigint,
      source_order_item_id text,
      option_payload jsonb,
      updated_at timestamptz,
      option_barcode_no text,
      option_barcode_identity_key text
    );

    get diagnostics v_inserted_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'itemId', p_item_id,
    'insertedCount', v_inserted_count
  );
end;
$$;

revoke all on function public.replace_product_launch_options_atomic(uuid, text, jsonb) from public;
revoke all on function public.replace_product_launch_options_atomic(uuid, text, jsonb) from anon;
revoke all on function public.replace_product_launch_options_atomic(uuid, text, jsonb) from authenticated;
grant execute on function public.replace_product_launch_options_atomic(uuid, text, jsonb) to service_role;
