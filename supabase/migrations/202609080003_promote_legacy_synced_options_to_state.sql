-- Reconcile the legacy JSON tracker state from the normalized Shopling option ledger.
-- This prevents later full-state writers from reintroducing stale pre-sync options.

create or replace function public.promote_legacy_synced_options_to_tracker_state(
  p_owner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_promoted_count integer := 0;
begin
  if p_owner_id is null then
    raise exception 'LEGACY_OPTION_STATE_PROMOTION_OWNER_REQUIRED' using errcode = '22023';
  end if;

  with normalized as (
    select
      i.owner_id,
      i.item_id,
      i.item_payload->'shoplingOptionSync' as sync_meta,
      coalesce(
        jsonb_agg(o.option_payload order by o.option_index)
          filter (where o.option_id is not null),
        '[]'::jsonb
      ) as order_options,
      coalesce(
        jsonb_agg(o.sale_option order by o.option_index)
          filter (where o.option_id is not null),
        '[]'::jsonb
      ) as option_labels
    from public.product_launch_items i
    left join public.product_launch_options o
      on o.owner_id = i.owner_id
     and o.item_id = i.item_id
    where i.owner_id = p_owner_id
      and i.archived_at is null
      and coalesce(i.item_payload->'shoplingOptionSync'->>'syncedAt', '') <> ''
      and coalesce(i.item_payload->'shoplingOptionSync'->>'source', '') =
          'shopling_live_grouped_option_sync'
    group by i.owner_id, i.item_id, i.item_payload
    having count(o.option_id) > 0
  ), rebuilt as (
    select
      s.owner_id,
      jsonb_agg(
        case
          when n.item_id is null then e.item
          else e.item || jsonb_build_object(
            'orderOptions', n.order_options,
            'optionLabels', n.option_labels,
            'options', n.option_labels,
            'shoplingOptionSync', n.sync_meta
          )
        end
        order by e.ordinality
      ) as items,
      count(n.item_id)::integer as promoted_count
    from public.product_launch_tracker_states s
    cross join lateral jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb))
      with ordinality as e(item, ordinality)
    left join normalized n
      on n.owner_id = s.owner_id
     and n.item_id = e.item->>'id'
    where s.owner_id = p_owner_id
    group by s.owner_id
  ), updated as (
    update public.product_launch_tracker_states s
    set
      state_payload = jsonb_set(s.state_payload, '{items}', r.items, true),
      updated_at = now()
    from rebuilt r
    where s.owner_id = r.owner_id
    returning r.promoted_count
  )
  select coalesce(max(promoted_count), 0)
  into v_promoted_count
  from updated;

  return jsonb_build_object(
    'ok', true,
    'ownerId', p_owner_id,
    'promotedCount', v_promoted_count
  );
end;
$$;

revoke all on function public.promote_legacy_synced_options_to_tracker_state(uuid) from public;
revoke all on function public.promote_legacy_synced_options_to_tracker_state(uuid) from anon;
revoke all on function public.promote_legacy_synced_options_to_tracker_state(uuid) from authenticated;
grant execute on function public.promote_legacy_synced_options_to_tracker_state(uuid) to service_role;
