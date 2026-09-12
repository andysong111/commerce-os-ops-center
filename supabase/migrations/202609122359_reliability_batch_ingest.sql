begin;

create or replace function public.ingest_reliability_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_event jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_duplicates integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'reliability batch must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_events);
  if v_count < 1 or v_count > 50 then
    raise exception 'reliability batch size must be between 1 and 50';
  end if;

  for v_event in
    select value
    from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception 'each reliability event must be a JSON object';
    end if;

    v_result := public.ingest_reliability_event(v_event);
    if coalesce((v_result->>'duplicate')::boolean, false) then
      v_duplicates := v_duplicates + 1;
    end if;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'accepted', v_count,
    'duplicates', v_duplicates,
    'results', v_results
  );
end;
$$;

revoke all on function public.ingest_reliability_events(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_reliability_events(jsonb) to service_role;

comment on function public.ingest_reliability_events(jsonb) is
  'Service-role-only bounded reliability batch ingest. Normalized events are processed sequentially inside one database transaction and one PostgREST RPC round trip.';

commit;
