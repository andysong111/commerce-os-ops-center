create table if not exists public.seo_shopling_product_db_capacities (
  owner_id uuid primary key,
  snapshot_id uuid not null,
  maximum_product_code_count integer,
  used_product_code_count integer,
  observation_status text not null default 'unknown',
  observed_at timestamptz not null,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seo_shopling_product_db_capacities_status_check
    check (observation_status in ('verified', 'unknown', 'error')),
  constraint seo_shopling_product_db_capacities_maximum_check
    check (maximum_product_code_count is null or maximum_product_code_count > 0),
  constraint seo_shopling_product_db_capacities_used_check
    check (used_product_code_count is null or used_product_code_count >= 0),
  constraint seo_shopling_product_db_capacities_verified_counts_check
    check (
      observation_status <> 'verified'
      or (
        maximum_product_code_count is not null
        and used_product_code_count is not null
      )
    )
);

comment on table public.seo_shopling_product_db_capacities is
  'Latest owner-scoped Shopling product DB quota readback. Deletions never create capacity until a newer verified Shopling readback lowers used_product_code_count.';

alter table public.seo_shopling_product_db_capacities enable row level security;
revoke all on table public.seo_shopling_product_db_capacities
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.seo_shopling_product_db_capacities
  to service_role;

create or replace function public.ingest_seo_shopling_product_db_capacity(
  p_owner_id uuid,
  p_snapshot_id uuid,
  p_observed_at timestamptz,
  p_source text,
  p_maximum_product_code_count integer,
  p_used_product_code_count integer,
  p_evidence jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  affected integer := 0;
begin
  if p_owner_id is null or p_snapshot_id is null then
    raise exception 'shopling_product_db_identity_required';
  end if;
  if p_source <> 'shopling-plan-dom-v1' then
    raise exception 'shopling_product_db_source_invalid';
  end if;
  if p_maximum_product_code_count is null
     or p_maximum_product_code_count <= 0
     or p_used_product_code_count is null
     or p_used_product_code_count < 0 then
    raise exception 'shopling_product_db_counts_invalid';
  end if;
  if p_observed_at > clock_timestamp() + interval '5 minutes'
     or p_observed_at < clock_timestamp() - interval '24 hours' then
    raise exception 'shopling_product_db_observed_at_invalid';
  end if;

  insert into public.seo_shopling_product_db_capacities (
    owner_id,
    snapshot_id,
    maximum_product_code_count,
    used_product_code_count,
    observation_status,
    observed_at,
    source,
    evidence,
    updated_at
  ) values (
    p_owner_id,
    p_snapshot_id,
    p_maximum_product_code_count,
    p_used_product_code_count,
    'verified',
    p_observed_at,
    p_source,
    coalesce(p_evidence, '{}'::jsonb),
    clock_timestamp()
  )
  on conflict (owner_id) do update set
    snapshot_id = excluded.snapshot_id,
    maximum_product_code_count = excluded.maximum_product_code_count,
    used_product_code_count = excluded.used_product_code_count,
    observation_status = excluded.observation_status,
    observed_at = excluded.observed_at,
    source = excluded.source,
    evidence = excluded.evidence,
    updated_at = clock_timestamp()
  where excluded.observed_at >= public.seo_shopling_product_db_capacities.observed_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.ingest_seo_shopling_product_db_capacity(
  uuid, uuid, timestamptz, text, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_seo_shopling_product_db_capacity(
  uuid, uuid, timestamptz, text, integer, integer, jsonb
) to service_role;
