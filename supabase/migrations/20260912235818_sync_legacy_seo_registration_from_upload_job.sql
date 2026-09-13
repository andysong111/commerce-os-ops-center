create or replace function public.sync_legacy_seo_registration_from_upload_job()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_registration_status text;
  v_error text := '';
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
  end if;

  v_registration_status := case new.status
    when 'running' then 'running'
    when 'success' then 'success'
    when 'failed' then 'failed'
    when 'partial_failure' then 'failed'
    else null
  end;

  if v_registration_status is null then
    return new;
  end if;

  if v_registration_status = 'failed' then
    v_error := coalesce(
      nullif(new.error_message, ''),
      nullif(new.result->>'error_message', ''),
      'Shopling 등록 ' || new.status
    );
  end if;

  update public.legacy_seo_run_jobs
  set
    registration_status = v_registration_status,
    registration_payload = coalesce(registration_payload, '{}'::jsonb)
      || jsonb_build_object(
        'uploadJobStatus', new.status,
        'lastJobObservedAt', now(),
        'error', v_error
      ),
    updated_at = now()
  where registration_job_id = new.id::text
    and registration_status is distinct from v_registration_status;

  return new;
end;
$$;

drop trigger if exists sync_legacy_seo_registration_from_upload_job_trg
  on public.product_launch_upload_jobs;

create trigger sync_legacy_seo_registration_from_upload_job_trg
after insert or update on public.product_launch_upload_jobs
for each row
execute function public.sync_legacy_seo_registration_from_upload_job();

update public.legacy_seo_run_jobs as l
set
  registration_status = case u.status
    when 'running' then 'running'
    when 'success' then 'success'
    when 'failed' then 'failed'
    when 'partial_failure' then 'failed'
    else l.registration_status
  end,
  registration_payload = coalesce(l.registration_payload, '{}'::jsonb)
    || jsonb_build_object(
      'uploadJobStatus', u.status,
      'lastJobObservedAt', now(),
      'error', case
        when u.status in ('failed', 'partial_failure') then coalesce(
          nullif(u.error_message, ''),
          nullif(u.result->>'error_message', ''),
          'Shopling 등록 ' || u.status
        )
        else ''
      end
    ),
  updated_at = now()
from public.product_launch_upload_jobs as u
where l.registration_job_id = u.id::text
  and u.status in ('running', 'success', 'failed', 'partial_failure')
  and l.registration_status is distinct from case u.status
    when 'running' then 'running'
    when 'success' then 'success'
    when 'failed' then 'failed'
    when 'partial_failure' then 'failed'
    else l.registration_status
  end;
