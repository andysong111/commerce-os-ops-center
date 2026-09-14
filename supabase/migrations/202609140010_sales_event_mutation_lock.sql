-- Candidate refresh and canonical publication must never race.
-- This is operational coordination only: no sales/order/inventory data changes.
begin;
create table if not exists public.ops_sales_event_mutation_lock (
  singleton boolean primary key default true check (singleton),
  owner_token uuid,
  leased_until timestamptz not null default '-infinity'::timestamptz
);
alter table public.ops_sales_event_mutation_lock enable row level security;
revoke all on public.ops_sales_event_mutation_lock from public, anon, authenticated;

create or replace function public.claim_sales_event_mutation_lock(p_token uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare acquired boolean := false;
begin
  if p_token is null then return false; end if;
  insert into public.ops_sales_event_mutation_lock as existing (singleton, owner_token, leased_until)
    values (true, p_token, clock_timestamp() + interval '10 minutes')
  on conflict (singleton) do update
    set owner_token = excluded.owner_token, leased_until = excluded.leased_until
    where existing.leased_until <= clock_timestamp()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;
create or replace function public.release_sales_event_mutation_lock(p_token uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare released boolean := false;
begin
  update public.ops_sales_event_mutation_lock
    set owner_token = null, leased_until = '-infinity'::timestamptz
    where singleton and owner_token = p_token
    returning true into released;
  return coalesce(released, false);
end;
$$;
revoke all on function public.claim_sales_event_mutation_lock(uuid) from public, anon, authenticated;
revoke all on function public.release_sales_event_mutation_lock(uuid) from public, anon, authenticated;
grant execute on function public.claim_sales_event_mutation_lock(uuid) to service_role;
grant execute on function public.release_sales_event_mutation_lock(uuid) to service_role;
commit;
