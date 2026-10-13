begin;

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
  next_run_at
)
values (
  'legacy-seo-run-worker',
  '/api/cron/legacy-seo-run-worker',
  'critical',
  15,
  true,
  300,
  60,
  300,
  280,
  now()
)
on conflict (task_key) do update
set route_path = excluded.route_path,
    workload_class = excluded.workload_class,
    priority = excluded.priority,
    enabled = excluded.enabled,
    normal_interval_seconds = excluded.normal_interval_seconds,
    busy_interval_seconds = excluded.busy_interval_seconds,
    recovery_interval_seconds = excluded.recovery_interval_seconds,
    timeout_seconds = excluded.timeout_seconds,
    next_run_at = least(public.ops_dispatch_tasks.next_run_at, now()),
    lease_owner = null,
    lease_until = null,
    updated_at = now();

commit;
