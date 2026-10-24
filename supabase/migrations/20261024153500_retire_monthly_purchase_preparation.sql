begin;

update public.ops_dispatch_tasks
set enabled = false,
    lease_owner = null,
    lease_until = null,
    updated_at = now()
where task_key = 'monthly-purchase-preparation';

commit;
