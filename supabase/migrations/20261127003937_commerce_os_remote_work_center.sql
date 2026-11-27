create table public.commerce_os_remote_work_center (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision uuid not null,
  queue jsonb not null check (jsonb_typeof(queue) = 'object')
);

alter table public.commerce_os_remote_work_center enable row level security;
revoke all on public.commerce_os_remote_work_center from public, anon, authenticated;
grant select, insert, update on public.commerce_os_remote_work_center to service_role;
