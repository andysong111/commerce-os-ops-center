-- Commerce OS Sourcing Engine SaaS schema
-- Apply in Supabase SQL editor after project creation.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  korean_query text not null,
  competitor_url text,
  target_price_krw integer not null default 0,
  test_budget_krw integer not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.sourcing_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.sourcing_runs(id) on delete cascade,
  url text not null,
  image_url text,
  title_cn text,
  title_kr text,
  unit_price_cny numeric(12, 4) not null default 0,
  moq integer not null default 1,
  china_shipping_fee_cny numeric(12, 4) not null default 0,
  options_text text,
  shop_name text,
  risk_level text not null default 'LOW',
  score integer not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.recommendation_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid references public.sourcing_runs(id) on delete set null,
  decision text not null,
  primary_candidate_id uuid references public.sourcing_candidates(id) on delete set null,
  backup_candidate_ids uuid[] not null default '{}',
  korean_product_name text not null,
  short_description text,
  test_quantity integer not null default 0,
  target_price_krw integer not null default 0,
  estimated_total_test_cost_krw integer not null default 0,
  estimated_unit_cost_krw integer not null default 0,
  estimated_margin_rate numeric(8, 4) not null default 0,
  risk_level text not null default 'LOW',
  risk_notes jsonb not null default '[]'::jsonb,
  supplier_questions_cn jsonb not null default '[]'::jsonb,
  card_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sourcing_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  card_id uuid references public.recommendation_cards(id) on delete set null,
  human_order_decision text not null,
  sales_result text not null default 'UNKNOWN',
  reordered boolean not null default false,
  failure_reasons jsonb not null default '[]'::jsonb,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists public.sourcing_memory_stats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  segment_type text not null,
  segment_key text not null,
  total_tests integer not null default 0,
  success_count integer not null default 0,
  neutral_count integer not null default 0,
  fail_count integer not null default 0,
  success_rate numeric(8, 4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (organization_id, segment_type, segment_key)
);

create index if not exists idx_sourcing_runs_org_created on public.sourcing_runs (organization_id, created_at desc);
create index if not exists idx_sourcing_candidates_run on public.sourcing_candidates (run_id);
create index if not exists idx_recommendation_cards_org_created on public.recommendation_cards (organization_id, created_at desc);
create index if not exists idx_sourcing_feedback_org_created on public.sourcing_feedback (organization_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sourcing_runs enable row level security;
alter table public.sourcing_candidates enable row level security;
alter table public.recommendation_cards enable row level security;
alter table public.sourcing_feedback enable row level security;
alter table public.sourcing_memory_stats enable row level security;

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;

create policy "members can view organizations"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "users can create owned organizations"
  on public.organizations for insert
  with check (owner_user_id = auth.uid());

create policy "members can view organization members"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

create policy "owners can add themselves as member"
  on public.organization_members for insert
  with check (user_id = auth.uid());

create policy "members can view sourcing runs"
  on public.sourcing_runs for select
  using (public.is_org_member(organization_id));

create policy "members can create sourcing runs"
  on public.sourcing_runs for insert
  with check (public.is_org_member(organization_id) and created_by = auth.uid());

create policy "members can update sourcing runs"
  on public.sourcing_runs for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "members can view candidates"
  on public.sourcing_candidates for select
  using (public.is_org_member(organization_id));

create policy "members can write candidates"
  on public.sourcing_candidates for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "members can view cards"
  on public.recommendation_cards for select
  using (public.is_org_member(organization_id));

create policy "members can write cards"
  on public.recommendation_cards for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "members can view feedback"
  on public.sourcing_feedback for select
  using (public.is_org_member(organization_id));

create policy "members can write feedback"
  on public.sourcing_feedback for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "members can view memory stats"
  on public.sourcing_memory_stats for select
  using (public.is_org_member(organization_id));

create policy "members can write memory stats"
  on public.sourcing_memory_stats for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
