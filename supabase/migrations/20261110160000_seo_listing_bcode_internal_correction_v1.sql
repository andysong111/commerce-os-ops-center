begin;

create table if not exists public.seo_listing_lifecycle_isolations (
  owner_id uuid not null,
  launch_item_id text not null,
  active boolean not null default true,
  reason_code text not null,
  evidence_basis text not null,
  isolation_fingerprint text not null,
  correction_plan_fingerprint text not null,
  evidence jsonb not null default '{}'::jsonb,
  isolated_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, launch_item_id),
  constraint seo_listing_lifecycle_isolations_identity_length
    check (char_length(launch_item_id) between 1 and 180),
  constraint seo_listing_lifecycle_isolations_fingerprint_format
    check (
      isolation_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      and correction_plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    ),
  constraint seo_listing_lifecycle_isolations_release_state
    check ((active and released_at is null) or (not active and released_at is not null))
);

comment on table public.seo_listing_lifecycle_isolations is
  'Reversible internal exclusion markers for obsolete SEO lifecycle generations. Source lifecycle rows are never deleted or overwritten.';

create index if not exists seo_listing_lifecycle_isolations_active_idx
  on public.seo_listing_lifecycle_isolations (owner_id, launch_item_id)
  where active;

alter table public.seo_listing_lifecycle_isolations enable row level security;
revoke all on table public.seo_listing_lifecycle_isolations from public, anon, authenticated, service_role;
grant select, insert, update on table public.seo_listing_lifecycle_isolations to service_role;

create or replace function public.apply_seo_listing_bcode_internal_correction_v1(
  p_owner_id uuid,
  p_plan_fingerprint text,
  p_plan jsonb,
  p_applied_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt jsonb;
  v_isolation jsonb;
  v_repair jsonb;
  v_binding jsonb;
  v_goods_key text;
  v_before_launch_item_id text;
  v_before_profile text;
  v_after_launch_item_id text;
  v_after_profile text;
  v_current_launch_item_id text;
  v_current_profile text;
  v_receipt_count integer := 0;
  v_isolation_count integer := 0;
  v_repair_count integer := 0;
  v_binding_count integer := 0;
  v_distinct_binding_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_SERVICE_ROLE_REQUIRED';
  end if;
  if p_plan_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or p_plan->>'planFingerprint' is distinct from p_plan_fingerprint
    or p_plan->>'ownerId' is distinct from p_owner_id::text
    or p_plan->>'schemaVersion' is distinct from 'seo-listing-bcode-internal-correction-plan-v1'
    or coalesce((p_plan->>'readyToApply')::boolean, false) is not true
    or p_plan->>'applyScope' is distinct from 'INTERNAL_DB_ONLY'
  then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_PLAN_INVALID';
  end if;
  if jsonb_typeof(p_plan->'auditReceipts') is distinct from 'array'
    or jsonb_typeof(p_plan->'isolationMarkers') is distinct from 'array'
    or jsonb_typeof(p_plan->'marketLedgerRepairs') is distinct from 'array'
  then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_ARRAYS_REQUIRED';
  end if;

  v_receipt_count := jsonb_array_length(p_plan->'auditReceipts');
  v_isolation_count := jsonb_array_length(p_plan->'isolationMarkers');
  v_repair_count := jsonb_array_length(p_plan->'marketLedgerRepairs');
  if v_receipt_count < 1 or v_receipt_count > 200
    or v_isolation_count > 200
    or v_repair_count > 200
    or v_receipt_count is distinct from (p_plan->>'auditReceiptCount')::integer
    or v_isolation_count is distinct from (p_plan->>'isolationMarkerCount')::integer
    or v_repair_count is distinct from (p_plan->>'marketLedgerProductCount')::integer
  then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_COUNT_INVALID';
  end if;

  select count(*), count(distinct binding->>'goodsKey')
    into v_binding_count, v_distinct_binding_count
  from jsonb_array_elements(p_plan->'marketLedgerRepairs') repair
  cross join lateral jsonb_array_elements(repair->'bindings') binding;
  if v_binding_count is distinct from (p_plan->>'marketLedgerBindingCount')::integer
    or v_binding_count is distinct from v_distinct_binding_count
    or exists (
      select 1
      from jsonb_array_elements(p_plan->'marketLedgerRepairs') repair
      where jsonb_typeof(repair->'bindings') is distinct from 'array'
        or jsonb_array_length(repair->'bindings') <> 6
    )
  then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_BINDINGS_INVALID';
  end if;

  for v_receipt in select value from jsonb_array_elements(p_plan->'auditReceipts') loop
    if v_receipt->>'ownerId' is distinct from p_owner_id::text
      or coalesce(v_receipt->>'launchItemId', '') = ''
      or coalesce(v_receipt->>'fingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
    then
      raise exception 'SEO_BCODE_INTERNAL_CORRECTION_RECEIPT_INVALID';
    end if;
    insert into public.commerce_operation_runs (
      operation_type, status, source, source_event_id, correlation_id,
      actor_type, actor_id, input_snapshot, result_snapshot,
      started_at, finished_at, updated_at
    ) values (
      'SEO_LISTING_BCODE_AUDIT_RECEIPT_V1', 'SUCCEEDED',
      'SEO_LISTING_LIFECYCLE',
      'seo-listing-bcode-receipt:' || (v_receipt->>'fingerprint'),
      p_owner_id::text, 'OPS_OPERATOR', p_owner_id::text,
      v_receipt,
      jsonb_build_object(
        'persisted', true,
        'receiptFingerprint', v_receipt->>'fingerprint',
        'correctionPlanFingerprint', p_plan_fingerprint
      ),
      p_applied_at, p_applied_at, p_applied_at
    ) on conflict (source_event_id) do nothing;

    if not exists (
      select 1 from public.commerce_operation_runs
      where source_event_id = 'seo-listing-bcode-receipt:' || (v_receipt->>'fingerprint')
        and operation_type = 'SEO_LISTING_BCODE_AUDIT_RECEIPT_V1'
        and correlation_id = p_owner_id::text
        and input_snapshot->>'fingerprint' = v_receipt->>'fingerprint'
        and status = 'SUCCEEDED'
    ) then
      raise exception 'SEO_BCODE_INTERNAL_CORRECTION_RECEIPT_CONFLICT';
    end if;
  end loop;

  for v_isolation in select value from jsonb_array_elements(p_plan->'isolationMarkers') loop
    if v_isolation->>'ownerId' is distinct from p_owner_id::text
      or coalesce(v_isolation->>'launchItemId', '') = ''
      or v_isolation->>'action' is distinct from 'ACTIVATE_INTERNAL_ISOLATION'
      or coalesce(v_isolation->>'fingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
      or not exists (
        select 1 from public.seo_listing_lifecycle_records
        where owner_id = p_owner_id
          and launch_item_id = v_isolation->>'launchItemId'
      )
      or exists (
        select 1 from public.seo_listing_lifecycle_isolations
        where owner_id = p_owner_id
          and launch_item_id = v_isolation->>'launchItemId'
          and active
          and correction_plan_fingerprint <> p_plan_fingerprint
      )
    then
      raise exception 'SEO_BCODE_INTERNAL_CORRECTION_ISOLATION_INVALID';
    end if;

    insert into public.seo_listing_lifecycle_isolations (
      owner_id, launch_item_id, active, reason_code, evidence_basis,
      isolation_fingerprint, correction_plan_fingerprint, evidence,
      isolated_at, released_at, updated_at
    ) values (
      p_owner_id, v_isolation->>'launchItemId', true,
      v_isolation->>'reason', v_isolation->>'evidenceBasis',
      v_isolation->>'fingerprint', p_plan_fingerprint, v_isolation,
      p_applied_at, null, p_applied_at
    ) on conflict (owner_id, launch_item_id) do update set
      active = true,
      reason_code = excluded.reason_code,
      evidence_basis = excluded.evidence_basis,
      isolation_fingerprint = excluded.isolation_fingerprint,
      correction_plan_fingerprint = excluded.correction_plan_fingerprint,
      evidence = excluded.evidence,
      isolated_at = excluded.isolated_at,
      released_at = null,
      updated_at = excluded.updated_at;
  end loop;

  for v_repair in select value from jsonb_array_elements(p_plan->'marketLedgerRepairs') loop
    if v_repair->>'ownerId' is distinct from p_owner_id::text
      or coalesce(v_repair->>'launchItemId', '') = ''
      or v_repair->>'action' is distinct from 'REPAIR_INTERNAL_MARKET_LEDGER_IDENTITY'
      or coalesce(v_repair->>'fingerprint', '') !~ '^sha256:[0-9a-f]{64}$'
    then
      raise exception 'SEO_BCODE_INTERNAL_CORRECTION_REPAIR_INVALID';
    end if;

    for v_binding in select value from jsonb_array_elements(v_repair->'bindings') loop
      v_goods_key := v_binding->>'goodsKey';
      v_before_launch_item_id := coalesce(v_binding->>'existingLedgerLaunchItemId', '');
      v_before_profile := coalesce(v_binding->>'existingLedgerProfile', '');
      v_after_launch_item_id := v_binding->>'intendedLedgerLaunchItemId';
      v_after_profile := v_binding->>'intendedLedgerProfile';
      if coalesce(v_goods_key, '') !~ '^\d+$'
        or v_after_launch_item_id is distinct from v_repair->>'launchItemId'
        or coalesce(v_after_profile, '') = ''
        or coalesce((v_binding->>'ledgerPresent')::boolean, false) is not true
      then
        raise exception 'SEO_BCODE_INTERNAL_CORRECTION_BINDING_INVALID';
      end if;

      select launch_item_id, profile
        into v_current_launch_item_id, v_current_profile
      from public.shopling_market_pipeline_ledger
      where owner_id = p_owner_id and goods_key = v_goods_key
      for update;
      if not found then
        raise exception 'SEO_BCODE_INTERNAL_CORRECTION_LEDGER_MISSING:%', v_goods_key;
      end if;
      if v_current_launch_item_id = v_after_launch_item_id
        and v_current_profile = v_after_profile
      then
        continue;
      end if;
      if v_current_launch_item_id is distinct from v_before_launch_item_id
        or v_current_profile is distinct from v_before_profile
      then
        raise exception 'SEO_BCODE_INTERNAL_CORRECTION_LEDGER_DRIFT:%', v_goods_key;
      end if;
      update public.shopling_market_pipeline_ledger
      set launch_item_id = v_after_launch_item_id,
          profile = v_after_profile,
          updated_at = p_applied_at
      where owner_id = p_owner_id and goods_key = v_goods_key;
    end loop;
  end loop;

  insert into public.commerce_operation_runs (
    operation_type, status, source, source_event_id, correlation_id,
    actor_type, actor_id, input_snapshot, result_snapshot,
    started_at, finished_at, updated_at
  ) values (
    'SEO_LISTING_BCODE_INTERNAL_CORRECTION_V1', 'SUCCEEDED',
    'SEO_LISTING_LIFECYCLE',
    'seo-listing-bcode-correction:' || p_plan_fingerprint,
    p_owner_id::text, 'OPS_OPERATOR', p_owner_id::text,
    p_plan,
    jsonb_build_object(
      'planFingerprint', p_plan_fingerprint,
      'auditReceiptCount', v_receipt_count,
      'isolationMarkerCount', v_isolation_count,
      'marketLedgerProductCount', v_repair_count,
      'marketLedgerBindingCount', v_binding_count,
      'externalMarketWrite', false
    ),
    p_applied_at, p_applied_at, p_applied_at
  ) on conflict (source_event_id) do nothing;

  if not exists (
    select 1 from public.commerce_operation_runs
    where source_event_id = 'seo-listing-bcode-correction:' || p_plan_fingerprint
      and operation_type = 'SEO_LISTING_BCODE_INTERNAL_CORRECTION_V1'
      and correlation_id = p_owner_id::text
      and input_snapshot->>'planFingerprint' = p_plan_fingerprint
      and status = 'SUCCEEDED'
  ) then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_RUN_CONFLICT';
  end if;

  return jsonb_build_object(
    'ok', true,
    'planFingerprint', p_plan_fingerprint,
    'auditReceiptCount', v_receipt_count,
    'isolationMarkerCount', v_isolation_count,
    'marketLedgerProductCount', v_repair_count,
    'marketLedgerBindingCount', v_binding_count,
    'externalMarketWrite', false
  );
end;
$$;

create or replace function public.rollback_seo_listing_bcode_internal_correction_v1(
  p_owner_id uuid,
  p_plan_fingerprint text,
  p_rolled_back_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan jsonb;
  v_repair jsonb;
  v_binding jsonb;
  v_goods_key text;
  v_before_launch_item_id text;
  v_before_profile text;
  v_after_launch_item_id text;
  v_after_profile text;
  v_current_launch_item_id text;
  v_current_profile text;
  v_released_count integer := 0;
  v_restored_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_SERVICE_ROLE_REQUIRED';
  end if;
  select input_snapshot into v_plan
  from public.commerce_operation_runs
  where source_event_id = 'seo-listing-bcode-correction:' || p_plan_fingerprint
    and operation_type = 'SEO_LISTING_BCODE_INTERNAL_CORRECTION_V1'
    and correlation_id = p_owner_id::text
    and status = 'SUCCEEDED'
  limit 1;
  if not found or v_plan->>'planFingerprint' is distinct from p_plan_fingerprint then
    raise exception 'SEO_BCODE_INTERNAL_CORRECTION_RUN_NOT_FOUND';
  end if;

  for v_repair in select value from jsonb_array_elements(v_plan->'marketLedgerRepairs') loop
    for v_binding in select value from jsonb_array_elements(v_repair->'bindings') loop
      v_goods_key := v_binding->>'goodsKey';
      v_before_launch_item_id := coalesce(v_binding->>'existingLedgerLaunchItemId', '');
      v_before_profile := coalesce(v_binding->>'existingLedgerProfile', '');
      v_after_launch_item_id := v_binding->>'intendedLedgerLaunchItemId';
      v_after_profile := v_binding->>'intendedLedgerProfile';
      select launch_item_id, profile
        into v_current_launch_item_id, v_current_profile
      from public.shopling_market_pipeline_ledger
      where owner_id = p_owner_id and goods_key = v_goods_key
      for update;
      if not found then
        raise exception 'SEO_BCODE_INTERNAL_CORRECTION_ROLLBACK_LEDGER_MISSING:%', v_goods_key;
      end if;
      if v_current_launch_item_id = v_before_launch_item_id
        and v_current_profile = v_before_profile
      then
        continue;
      end if;
      if v_current_launch_item_id is distinct from v_after_launch_item_id
        or v_current_profile is distinct from v_after_profile
      then
        raise exception 'SEO_BCODE_INTERNAL_CORRECTION_ROLLBACK_DRIFT:%', v_goods_key;
      end if;
      update public.shopling_market_pipeline_ledger
      set launch_item_id = v_before_launch_item_id,
          profile = v_before_profile,
          updated_at = p_rolled_back_at
      where owner_id = p_owner_id and goods_key = v_goods_key;
      v_restored_count := v_restored_count + 1;
    end loop;
  end loop;

  update public.seo_listing_lifecycle_isolations
  set active = false,
      released_at = p_rolled_back_at,
      updated_at = p_rolled_back_at
  where owner_id = p_owner_id
    and correction_plan_fingerprint = p_plan_fingerprint
    and active;
  get diagnostics v_released_count = row_count;

  insert into public.commerce_operation_runs (
    operation_type, status, source, source_event_id, correlation_id,
    actor_type, actor_id, input_snapshot, result_snapshot,
    started_at, finished_at, updated_at
  ) values (
    'SEO_LISTING_BCODE_INTERNAL_CORRECTION_ROLLBACK_V1', 'SUCCEEDED',
    'SEO_LISTING_LIFECYCLE',
    'seo-listing-bcode-correction-rollback:' || p_plan_fingerprint,
    p_owner_id::text, 'OPS_OPERATOR', p_owner_id::text,
    jsonb_build_object('planFingerprint', p_plan_fingerprint),
    jsonb_build_object(
      'planFingerprint', p_plan_fingerprint,
      'releasedIsolationMarkerCount', v_released_count,
      'restoredMarketLedgerBindingCount', v_restored_count,
      'auditReceiptsRetained', true,
      'externalMarketWrite', false
    ),
    p_rolled_back_at, p_rolled_back_at, p_rolled_back_at
  ) on conflict (source_event_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'planFingerprint', p_plan_fingerprint,
    'releasedIsolationMarkerCount', v_released_count,
    'restoredMarketLedgerBindingCount', v_restored_count,
    'auditReceiptsRetained', true,
    'externalMarketWrite', false
  );
end;
$$;

revoke all on function public.apply_seo_listing_bcode_internal_correction_v1(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.rollback_seo_listing_bcode_internal_correction_v1(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_seo_listing_bcode_internal_correction_v1(uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.rollback_seo_listing_bcode_internal_correction_v1(uuid, text, timestamptz) to service_role;

commit;
