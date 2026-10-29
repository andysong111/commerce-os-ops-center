begin;

do $$
declare
  v_updated integer;
begin
  update public.ops_dispatch_tasks
  set
    enabled = true,
    next_run_at = now() + interval '1 day',
    last_error = '',
    consecutive_failures = 0,
    updated_at = now()
  where task_key = 'seo-listing-lifecycle-shadow-refresh'
    and route_path = '/api/cron/seo-listing-lifecycle-shadow-refresh'
    and workload_class = 'operational'
    and normal_interval_seconds = 86400
    and busy_interval_seconds = 86400
    and timeout_seconds = 300;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'SEO_LISTING_SHADOW_DAILY_REFRESH_TASK_MISMATCH';
  end if;
end;
$$;

commit;
