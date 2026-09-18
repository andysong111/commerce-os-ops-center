begin;

-- Seven-day Shopling partitions are intentionally small and bounded. During an
-- active 360-day Stage 8 collection, a five-minute busy cadence would leave the
-- worker idle far longer than it spends reading data. Keep the normal hourly
-- cadence after completion, but allow one bounded burst per dispatcher minute
-- while the request is QUEUED/RUNNING.
do $$
declare
  touched integer;
begin
  update public.ops_dispatch_tasks
  set busy_interval_seconds = 60,
      next_run_at = least(next_run_at, now()),
      updated_at = now()
  where task_key = 'product-master-shopling-sales-events'
    and route_path = '/api/cron/product-master-shopling-sales-events'
    and workload_class = 'operational';

  get diagnostics touched = row_count;
  if touched <> 1 then
    raise exception 'STAGE8_SALES_EVENT_DISPATCH_TASK_MISMATCH:%', touched;
  end if;
end
$$;

commit;
