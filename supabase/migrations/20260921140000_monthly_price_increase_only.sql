-- Additive, service-role-only job state. No inventory, receipt or price backfill.
create table if not exists public.commerce_monthly_price_runs (
  id uuid primary key default gen_random_uuid(),
  cycle_month text not null check (cycle_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  policy_version text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (cycle_month, policy_version, source_hash)
);
create table if not exists public.commerce_monthly_price_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.commerce_monthly_price_runs(id),
  goods_key text not null,
  state text not null default 'QUEUED' check (state in ('QUEUED','PREPARED','WRITING','VERIFY_PENDING','VERIFIED','RESENDING','TRANSMITTED','HELD','BLOCKED','UNCERTAIN')),
  candidate jsonb not null,
  plan jsonb,
  write_index integer not null default 0 check (write_index >= 0),
  claim_token uuid,
  claim_until timestamptz,
  error_code text,
  transmission jsonb,
  updated_at timestamptz not null default now(),
  unique (run_id, goods_key)
);
create table if not exists public.commerce_monthly_price_goods_locks (
  goods_key text primary key,
  item_id uuid not null references public.commerce_monthly_price_items(id)
);
create table if not exists public.commerce_monthly_price_audit (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.commerce_monthly_price_items(id),
  event text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists commerce_monthly_price_runs_month_idx on public.commerce_monthly_price_runs(cycle_month, created_at desc);
create index if not exists commerce_monthly_price_items_run_idx on public.commerce_monthly_price_items(run_id);
create index if not exists commerce_monthly_price_audit_item_idx on public.commerce_monthly_price_audit(item_id, id);
alter table public.commerce_monthly_price_runs enable row level security;
alter table public.commerce_monthly_price_items enable row level security;
alter table public.commerce_monthly_price_goods_locks enable row level security;
alter table public.commerce_monthly_price_audit enable row level security;
revoke all on public.commerce_monthly_price_runs, public.commerce_monthly_price_items, public.commerce_monthly_price_goods_locks, public.commerce_monthly_price_audit from public, anon, authenticated;
grant all on public.commerce_monthly_price_runs, public.commerce_monthly_price_items, public.commerce_monthly_price_goods_locks, public.commerce_monthly_price_audit to service_role;
revoke all on sequence public.commerce_monthly_price_audit_id_seq from public, anon, authenticated;
grant usage, select on sequence public.commerce_monthly_price_audit_id_seq to service_role;

create or replace function public.claim_monthly_price_item(p_item_id uuid)
returns setof public.commerce_monthly_price_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item public.commerce_monthly_price_items; v_lock uuid;
begin
  select * into v_item from public.commerce_monthly_price_items where id = p_item_id for update;
  if not found then raise exception 'MONTHLY_PRICE_ITEM_NOT_FOUND'; end if;
  if v_item.claim_until > now() then raise exception 'MONTHLY_PRICE_ITEM_BUSY'; end if;
  insert into public.commerce_monthly_price_goods_locks(goods_key, item_id) values (v_item.goods_key, v_item.id)
  on conflict(goods_key) do update set item_id = excluded.item_id
    where commerce_monthly_price_goods_locks.item_id = excluded.item_id
    or exists (select 1 from public.commerce_monthly_price_items old_item
               where old_item.id = commerce_monthly_price_goods_locks.item_id
                 and old_item.state in ('HELD','BLOCKED','TRANSMITTED'))
  returning item_id into v_lock;
  if v_lock is distinct from v_item.id then raise exception 'MONTHLY_PRICE_GOODSKEY_BUSY'; end if;
  return query update public.commerce_monthly_price_items set claim_token=gen_random_uuid(), claim_until=now()+interval '90 seconds', updated_at=now()
    where id=p_item_id returning *;
end;
$$;
revoke all on function public.claim_monthly_price_item(uuid) from public, anon, authenticated;
grant execute on function public.claim_monthly_price_item(uuid) to service_role;
