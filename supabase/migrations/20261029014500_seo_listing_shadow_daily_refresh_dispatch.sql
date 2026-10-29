begin;

-- Deploy and verify the read-only Shopling/sales evidence refresh before enabling
-- its once-daily dispatcher schedule. This task only writes internal shadow rows.
insert into public.ops_dispatch_tasks (
  task_key,
  route_path,
  workload_class,
  priority,
  enabled,
  normal_interval_seconds,
  busy_interval_seconds,
  recovery_interval_seconds,
  timeout_seconds,
  next_run_at,
  updated_at
) values (
  'seo-listing-lifecycle-shadow-refresh',
  '/api/cron/seo-listing-lifecycle-shadow-refresh',
  'operational',
  118,
  false,
  86400,
  86400,
  21600,
  300,
  now(),
  now()
)
on conflict (task_key) do update set
  route_path = excluded.route_path,
  workload_class = excluded.workload_class,
  priority = excluded.priority,
  enabled = false,
  normal_interval_seconds = excluded.normal_interval_seconds,
  busy_interval_seconds = excluded.busy_interval_seconds,
  recovery_interval_seconds = excluded.recovery_interval_seconds,
  timeout_seconds = excluded.timeout_seconds,
  updated_at = now();

commit;
