begin;

create table if not exists public.seo_listing_rotation_policies (
  owner_id uuid primary key,
  mode text not null default 'shadow' check (mode in ('shadow','canary','auto')),
  enabled boolean not null default false,
  exposure_days integer not null default 60 check (exposure_days between 7 and 365),
  cooldown_days integer not null default 90 check (cooldown_days between 0 and 365),
  max_attempts integer not null default 3 check (max_attempts = 3),
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.seo_listing_rotation_policies is
  'Owner-scoped SEO listing rotation policy. The initial release is fail-closed: disabled Shadow mode only.';

create table if not exists public.seo_market_account_capacities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  snapshot_id uuid not null,
  market_account_key text not null,
  market_code text not null default '',
  market_name text not null default '',
  account_label text not null default '',
  maximum_listing_count integer check (maximum_listing_count is null or maximum_listing_count >= 0),
  active_listing_count integer check (active_listing_count is null or active_listing_count >= 0),
  in_flight_count integer not null default 0 check (in_flight_count >= 0),
  safety_buffer integer not null default 0 check (safety_buffer >= 0),
  required_for_auto_batch boolean not null default true,
  observation_status text not null default 'unknown' check (observation_status in ('verified','unknown','error')),
  observed_at timestamptz,
  source text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_market_account_capacities_owner_account_unique
    unique (owner_id, market_account_key),
  constraint seo_market_account_capacities_key_length
    check (char_length(market_account_key) between 1 and 180)
);

comment on table public.seo_market_account_capacities is
  'Readback evidence for per-market listing limits. Unknown, stale, or invalid observations block every automatic batch that requires that market.';

create index if not exists seo_market_account_capacities_owner_idx
  on public.seo_market_account_capacities (owner_id, required_for_auto_batch desc, market_name, account_label);

create index if not exists seo_market_account_capacities_snapshot_idx
  on public.seo_market_account_capacities (owner_id, snapshot_id, observed_at desc);

create or replace function public.ingest_seo_market_account_capacities(
  p_owner_id uuid,
  p_snapshot_id uuid,
  p_observed_at timestamptz,
  p_source text,
  p_observations jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if p_owner_id is null or p_snapshot_id is null or p_observed_at is null then
    raise exception 'capacity_readback_identity_required';
  end if;
  if p_source is distinct from 'shopling-market-capacity-readback-v1' then
    raise exception 'capacity_readback_source_invalid';
  end if;
  if p_observed_at < clock_timestamp() - interval '24 hours'
     or p_observed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'capacity_readback_time_invalid';
  end if;
  if p_observations is null
     or jsonb_typeof(p_observations) is distinct from 'array' then
    raise exception 'capacity_readback_requires_market_account_array';
  end if;
  if jsonb_array_length(p_observations) <> 29 then
    raise exception 'capacity_readback_requires_all_market_accounts';
  end if;

  insert into public.seo_market_account_capacities (
    owner_id,
    snapshot_id,
    market_account_key,
    market_code,
    market_name,
    account_label,
    maximum_listing_count,
    active_listing_count,
    in_flight_count,
    observation_status,
    observed_at,
    source,
    evidence,
    updated_at
  )
  select
    p_owner_id,
    p_snapshot_id,
    row.market_account_key,
    row.market_code,
    row.market_name,
    row.account_label,
    row.maximum_listing_count,
    row.active_listing_count,
    row.in_flight_count,
    row.observation_status,
    p_observed_at,
    left(coalesce(p_source, ''), 120),
    jsonb_build_object(
      'snapshotId', p_snapshot_id,
      'collectorMessage', left(coalesce(row.collector_message, ''), 300)
    ),
    now()
  from jsonb_to_recordset(p_observations) as row(
    market_account_key text,
    market_code text,
    market_name text,
    account_label text,
    maximum_listing_count integer,
    active_listing_count integer,
    in_flight_count integer,
    observation_status text,
    collector_message text
  )
  on conflict (owner_id, market_account_key) do update set
    snapshot_id = excluded.snapshot_id,
    market_code = excluded.market_code,
    market_name = excluded.market_name,
    account_label = excluded.account_label,
    maximum_listing_count = excluded.maximum_listing_count,
    active_listing_count = excluded.active_listing_count,
    in_flight_count = excluded.in_flight_count,
    observation_status = excluded.observation_status,
    observed_at = excluded.observed_at,
    source = excluded.source,
    evidence = excluded.evidence,
    updated_at = now()
  where public.seo_market_account_capacities.observed_at is null
     or excluded.observed_at >= public.seo_market_account_capacities.observed_at;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.ingest_seo_market_account_capacities(uuid, uuid, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_seo_market_account_capacities(uuid, uuid, timestamptz, text, jsonb)
  to service_role;

create table if not exists public.seo_listing_lifecycle_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  market_account_key text not null,
  launch_item_id text not null,
  model_number text not null default '',
  product_name text not null default '',
  state text not null default 'READY' check (state in ('READY','LIVE','COOLDOWN','PROTECTED','RETIRE_CANDIDATE','EXCEPTION')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  current_run_id text not null default '',
  goods_key text not null default '',
  market_listing_id text not null default '',
  live_started_at timestamptz,
  last_verified_live_at timestamptz,
  sales_count_during_attempt integer not null default 0 check (sales_count_during_attempt >= 0),
  next_eligible_at timestamptz,
  exposure_verified boolean not null default false,
  requires_review boolean not null default false,
  review_reason text,
  evidence jsonb not null default '{}'::jsonb,
  rule_version text not null default 'seo-listing-rotation-v1-shadow',
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_listing_lifecycle_records_identity_unique
    unique (owner_id, market_account_key, launch_item_id),
  constraint seo_listing_lifecycle_records_identity_length
    check (
      char_length(market_account_key) between 1 and 180
      and char_length(launch_item_id) between 1 and 180
    )
);

comment on table public.seo_listing_lifecycle_records is
  'Per-product, per-market listing lifecycle ledger. attempt_count increases only after verified LIVE readback; technical failures never consume an attempt.';
comment on column public.seo_listing_lifecycle_records.goods_key is
  'Shopling listing identity only. A listing removal never deletes the canonical Product Master product.';

create index if not exists seo_listing_lifecycle_records_owner_state_idx
  on public.seo_listing_lifecycle_records (owner_id, state, evaluated_at desc);
create index if not exists seo_listing_lifecycle_records_next_eligible_idx
  on public.seo_listing_lifecycle_records (owner_id, next_eligible_at)
  where state = 'COOLDOWN' and next_eligible_at is not null;
create index if not exists seo_listing_lifecycle_records_goods_key_idx
  on public.seo_listing_lifecycle_records (owner_id, goods_key)
  where goods_key <> '';

create table if not exists public.seo_listing_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  lifecycle_record_id uuid not null references public.seo_listing_lifecycle_records(id),
  previous_state text,
  new_state text not null check (new_state in ('READY','LIVE','COOLDOWN','PROTECTED','RETIRE_CANDIDATE','EXCEPTION')),
  action text not null check (action in ('NONE','REGISTER','SOLD_OUT_AND_DELETE','RELIST','KEEP','REVIEW')),
  attempt_count integer not null check (attempt_count between 0 and 3),
  reason_code text not null,
  shadow_mode boolean not null default true,
  evidence jsonb not null default '{}'::jsonb,
  rule_version text not null default 'seo-listing-rotation-v1-shadow',
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.seo_listing_lifecycle_events is
  'Append-only evidence for SEO listing lifecycle decisions and readback-safe transition audits.';

create index if not exists seo_listing_lifecycle_events_record_idx
  on public.seo_listing_lifecycle_events (lifecycle_record_id, evaluated_at desc);
create index if not exists seo_listing_lifecycle_events_owner_action_idx
  on public.seo_listing_lifecycle_events (owner_id, action, evaluated_at desc);

create table if not exists public.seo_listing_rotation_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  lifecycle_record_id uuid references public.seo_listing_lifecycle_records(id),
  market_account_key text not null,
  launch_item_id text not null,
  run_id text not null default '',
  goods_key text not null default '',
  action_type text not null check (action_type in ('REGISTER','SOLD_OUT','DELETE','RELIST','RETIRE_REVIEW')),
  status text not null default 'shadow' check (status in ('shadow','pending','claimed','succeeded','failed','confirm_needed','cancelled')),
  shadow_mode boolean not null default true,
  dedupe_key text not null unique,
  scheduled_for timestamptz not null default now(),
  claimed_at timestamptz,
  executed_at timestamptz,
  readback_verified_at timestamptz,
  reason_code text not null,
  evidence jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.seo_listing_rotation_actions is
  'Shadow-first action queue. No executor may claim a shadow row; uncertain writes must move to confirm_needed and must never be blindly retried.';

create index if not exists seo_listing_rotation_actions_owner_status_idx
  on public.seo_listing_rotation_actions (owner_id, status, scheduled_for, created_at);
create index if not exists seo_listing_rotation_actions_record_idx
  on public.seo_listing_rotation_actions (lifecycle_record_id, created_at desc);

alter table public.seo_listing_rotation_policies enable row level security;
alter table public.seo_market_account_capacities enable row level security;
alter table public.seo_listing_lifecycle_records enable row level security;
alter table public.seo_listing_lifecycle_events enable row level security;
alter table public.seo_listing_rotation_actions enable row level security;

revoke all on table public.seo_listing_rotation_policies from public, anon, authenticated;
revoke all on table public.seo_market_account_capacities from public, anon, authenticated;
revoke all on table public.seo_listing_lifecycle_records from public, anon, authenticated;
revoke all on table public.seo_listing_lifecycle_events from public, anon, authenticated;
revoke all on table public.seo_listing_rotation_actions from public, anon, authenticated;

grant select, insert, update, delete on table public.seo_listing_rotation_policies to service_role;
grant select, insert, update, delete on table public.seo_market_account_capacities to service_role;
grant select, insert, update, delete on table public.seo_listing_lifecycle_records to service_role;
grant select, insert on table public.seo_listing_lifecycle_events to service_role;
grant select, insert, update on table public.seo_listing_rotation_actions to service_role;

commit;
