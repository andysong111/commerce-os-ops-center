begin;

-- Stage 8 depends on operational workers being able to make progress.
-- A maintenance drain was registered with priority 2 and a 60-second busy
-- cadence, which can reclaim every one-minute heartbeat before long-overdue
-- critical/operational tasks are considered. Maintenance stays enabled, but it
-- must remain behind business-critical and operational work.
update public.ops_dispatch_tasks
set priority = case task_key
      when 'legacy-shopling-image-repair' then 850
      when 'legacy-shopling-launch-backfill-dry' then 870
      when 'legacy-shopling-launch-backfill-apply' then 880
      else greatest(priority, 800)
    end,
    updated_at = now()
where workload_class = 'maintenance'
  and priority < 800;

alter table public.ops_dispatch_tasks
  drop constraint if exists ops_dispatch_tasks_maintenance_priority_guard;

alter table public.ops_dispatch_tasks
  add constraint ops_dispatch_tasks_maintenance_priority_guard
  check (workload_class <> 'maintenance' or priority >= 800);

comment on constraint ops_dispatch_tasks_maintenance_priority_guard
  on public.ops_dispatch_tasks is
  'Maintenance work may run only behind critical/operational/diagnostic priority bands so a busy maintenance drain cannot starve purchase-cycle evidence workers.';

commit;
