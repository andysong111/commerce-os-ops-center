-- Keep durable SEO checkpoints small after scoring has already materialized
-- the full candidate rows at the top level. Discovery candidates, source tags,
-- and SearchAd rows are only needed to produce those scored rows; retaining
-- thousands of them again makes every checkpoint PATCH multi-megabyte.

create or replace function public.compact_seo_run_checkpoint_payload()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if jsonb_typeof(new.checkpoint_payload -> 'candidates') = 'array'
     and jsonb_array_length(new.checkpoint_payload -> 'candidates') > 0
     and jsonb_typeof(new.checkpoint_payload -> 'discovery') = 'object' then
    new.checkpoint_payload := jsonb_set(
      jsonb_set(
        jsonb_set(
          new.checkpoint_payload,
          '{discovery,searchAdStats}',
          '[]'::jsonb,
          true
        ),
        '{discovery,sourceTagsByKeyword}',
        '{}'::jsonb,
        true
      ),
      '{discovery,candidates}',
      '[]'::jsonb,
      true
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists seo_run_jobs_compact_checkpoint_payload
  on public.seo_run_jobs;
create trigger seo_run_jobs_compact_checkpoint_payload
before insert or update of checkpoint_payload
on public.seo_run_jobs
for each row
execute function public.compact_seo_run_checkpoint_payload();

-- Compact only unfinished hot rows immediately. FINAL result payloads and all
-- business evidence remain untouched.
update public.seo_run_jobs
set checkpoint_payload = jsonb_set(
      jsonb_set(
        jsonb_set(
          checkpoint_payload,
          '{discovery,searchAdStats}',
          '[]'::jsonb,
          true
        ),
        '{discovery,sourceTagsByKeyword}',
        '{}'::jsonb,
        true
      ),
      '{discovery,candidates}',
      '[]'::jsonb,
      true
    ),
    updated_at = now()
where archived_at is null
  and status in ('queued', 'running')
  and jsonb_typeof(checkpoint_payload -> 'candidates') = 'array'
  and jsonb_array_length(checkpoint_payload -> 'candidates') > 0
  and jsonb_typeof(checkpoint_payload -> 'discovery') = 'object';

comment on function public.compact_seo_run_checkpoint_payload() is
  'Removes redundant discovery search rows after scored candidates exist, keeping durable SEO checkpoint writes bounded.';
