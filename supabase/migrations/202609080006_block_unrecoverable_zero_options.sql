-- Zero normalized options may proceed only when a previous successful Shopling
-- upload exists for the same launch item; otherwise the established recovery
-- function cannot possibly reconstruct options, so block before state mutation.

create or replace function public.guard_legacy_seo_registration_bcodes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_option_count integer := 0;
  v_missing_bcodes integer := 0;
  v_invalid_bcodes integer := 0;
  v_sync_source text := '';
  v_synced_at text := '';
  v_has_success_history boolean := false;
begin
  if new.registration_status <> 'submitting'
     or old.registration_status is not distinct from new.registration_status then
    return new;
  end if;

  select
    coalesce(i.item_payload->'shoplingOptionSync'->>'source', ''),
    coalesce(i.item_payload->'shoplingOptionSync'->>'syncedAt', '')
  into v_sync_source, v_synced_at
  from public.product_launch_items i
  where i.owner_id = new.owner_id
    and i.item_id = new.launch_item_id
    and i.archived_at is null
  limit 1;

  if coalesce(v_synced_at, '') = ''
     or coalesce(v_sync_source, '') <> 'shopling_live_grouped_option_sync' then
    raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_OPTION_SYNC_NOT_READY model=% item=%',
      new.model_number, new.launch_item_id
      using errcode = 'P0001';
  end if;

  select
    count(*),
    count(*) filter (where coalesce(btrim(o.barcode), '') = ''),
    count(*) filter (
      where coalesce(btrim(o.barcode), '') <> ''
        and upper(btrim(o.barcode)) !~ '^[A-Z]{3}[0-9]+-[0-9]+$'
    )
  into v_option_count, v_missing_bcodes, v_invalid_bcodes
  from public.product_launch_options o
  where o.owner_id = new.owner_id
    and o.item_id = new.launch_item_id;

  if v_option_count = 0 then
    select exists (
      select 1
      from public.product_launch_upload_jobs j
      where j.owner_id = new.owner_id
        and j.launch_item_id = new.launch_item_id
        and j.status = 'success'
    ) into v_has_success_history;

    if not v_has_success_history then
      raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_NO_OPTIONS_OR_HISTORY model=% item=%',
        new.model_number, new.launch_item_id
        using errcode = 'P0001';
    end if;
  end if;

  if v_option_count > 0 and v_missing_bcodes > 0 then
    raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_MISSING_BCODE model=% missing=% option_count=%',
      new.model_number, v_missing_bcodes, v_option_count
      using errcode = 'P0001';
  end if;

  if v_option_count > 0 and v_invalid_bcodes > 0 then
    raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_INVALID_BCODE model=% invalid=% option_count=%',
      new.model_number, v_invalid_bcodes, v_option_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
