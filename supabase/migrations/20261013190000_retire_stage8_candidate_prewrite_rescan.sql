begin;

-- Monthly purchase preparation now promotes a clean deterministic candidate
-- through a one-row canary and verified full readback. Keep the historical
-- 360-day parity pages for on-demand diagnostics, but stop scheduling the
-- duplicate full-history rescan on every monthly cycle.
update public.ops_dispatch_tasks
set enabled = false,
    lease_owner = null,
    lease_until = null,
    updated_at = now()
where task_key = 'stage8-candidate-prewrite-evidence';

commit;
