-- Fail closed before any legacy SEO Shopling re-registration can mutate state.
-- Every normalized option must have a real B-code and a completed Shopling option sync.

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

  if v_option_count = 0 then
    raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_NO_NORMALIZED_OPTIONS model=% item=%',
      new.model_number, new.launch_item_id
      using errcode = 'P0001';
  end if;

  if v_missing_bcodes > 0 then
    raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_MISSING_BCODE model=% missing=% option_count=%',
      new.model_number, v_missing_bcodes, v_option_count
      using errcode = 'P0001';
  end if;

  if v_invalid_bcodes > 0 then
    raise exception 'LEGACY_SEO_REGISTRATION_BLOCKED_INVALID_BCODE model=% invalid=% option_count=%',
      new.model_number, v_invalid_bcodes, v_option_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_legacy_seo_registration_bcodes
on public.legacy_seo_run_jobs;

create trigger trg_guard_legacy_seo_registration_bcodes
before update of registration_status
on public.legacy_seo_run_jobs
for each row
execute function public.guard_legacy_seo_registration_bcodes();

revoke all on function public.guard_legacy_seo_registration_bcodes() from public;
revoke all on function public.guard_legacy_seo_registration_bcodes() from anon;
revoke all on function public.guard_legacy_seo_registration_bcodes() from authenticated;
