-- Allow zero-normalized-option legacy rows to use the existing historical option
-- recovery path, but fail closed on the final Shopling upload payload.

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

  -- If normalized options exist they must already be complete. If none exist,
  -- registration may continue into the established historical successful-upload
  -- recovery path; the final payload trigger below validates that recovered data.
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

create or replace function public.guard_legacy_seo_upload_payload_bcodes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_legacy boolean := false;
  v_channel_count integer := 0;
  v_empty_channels integer := 0;
  v_option_count integer := 0;
  v_bad_bcodes integer := 0;
begin
  select exists (
    select 1
    from public.legacy_seo_run_jobs r
    where r.owner_id = new.owner_id
      and r.launch_item_id = new.launch_item_id
      and r.registration_status = 'submitting'
      and r.archived_at is null
  ) into v_is_legacy;

  if not v_is_legacy then
    return new;
  end if;

  if jsonb_typeof(new.payload->'channels') <> 'array' then
    raise exception 'LEGACY_SEO_UPLOAD_BLOCKED_CHANNELS_MISSING item=%', new.launch_item_id
      using errcode = 'P0001';
  end if;

  select
    count(*),
    count(*) filter (
      where jsonb_typeof(channel_row->'options') <> 'array'
         or jsonb_array_length(coalesce(channel_row->'options', '[]'::jsonb)) = 0
    )
  into v_channel_count, v_empty_channels
  from jsonb_array_elements(new.payload->'channels') as channel_row;

  if v_channel_count = 0 or v_empty_channels > 0 then
    raise exception 'LEGACY_SEO_UPLOAD_BLOCKED_OPTIONS_MISSING item=% channels=% empty_channels=%',
      new.launch_item_id, v_channel_count, v_empty_channels
      using errcode = 'P0001';
  end if;

  select
    count(*),
    count(*) filter (
      where coalesce(btrim(option_row->>'barcode'), '') = ''
         or upper(btrim(option_row->>'barcode')) !~ '^[A-Z]{3}[0-9]+-[0-9]+$'
    )
  into v_option_count, v_bad_bcodes
  from jsonb_array_elements(new.payload->'channels') as channel_row
  cross join lateral jsonb_array_elements(channel_row->'options') as option_row;

  if v_option_count = 0 or v_bad_bcodes > 0 then
    raise exception 'LEGACY_SEO_UPLOAD_BLOCKED_BCODE_INVALID item=% bad=% option_rows=%',
      new.launch_item_id, v_bad_bcodes, v_option_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_legacy_seo_upload_payload_bcodes
on public.product_launch_upload_jobs;

create trigger trg_guard_legacy_seo_upload_payload_bcodes
before insert
on public.product_launch_upload_jobs
for each row
execute function public.guard_legacy_seo_upload_payload_bcodes();

revoke all on function public.guard_legacy_seo_upload_payload_bcodes() from public;
revoke all on function public.guard_legacy_seo_upload_payload_bcodes() from anon;
revoke all on function public.guard_legacy_seo_upload_payload_bcodes() from authenticated;
