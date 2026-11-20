begin;

create table if not exists public.option_bcode_projection_ledger (
  option_barcode_no text primary key,
  b_code text not null unique,
  source text not null,
  source_event_id text not null,
  changed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_bcode_projection_option_no_format check (option_barcode_no ~ '^[0-9]{12}$'),
  constraint option_bcode_projection_b_code_format check (b_code ~ '^B[A-Z]{2}[0-9]+-[0-9]+$')
);

create table if not exists public.option_bcode_projection_events (
  event_id text primary key,
  option_barcode_no text not null,
  b_code text not null,
  source text not null,
  changed_at timestamptz not null,
  applied_at timestamptz not null default now(),
  constraint option_bcode_projection_event_option_no_format check (option_barcode_no ~ '^[0-9]{12}$'),
  constraint option_bcode_projection_event_b_code_format check (b_code ~ '^B[A-Z]{2}[0-9]+-[0-9]+$')
);

alter table public.option_bcode_projection_ledger enable row level security;
alter table public.option_bcode_projection_events enable row level security;
revoke all on public.option_bcode_projection_ledger from public, anon, authenticated;
revoke all on public.option_bcode_projection_events from public, anon, authenticated;
grant select, insert, update on public.option_bcode_projection_ledger to service_role;
grant select, insert on public.option_bcode_projection_events to service_role;

do $guard$
begin
  if exists (
    select 1
    from public.product_launch_options
    where coalesce(btrim(barcode), '') <> ''
    group by upper(regexp_replace(barcode, '\s+', '', 'g'))
    having count(distinct option_barcode_no) > 1
  ) then
    raise exception 'BCODE_MULTIPLE_OPTION_IDENTITIES_EXIST';
  end if;
  if exists (
    select 1
    from public.product_launch_options
    where coalesce(btrim(barcode), '') <> '' and option_barcode_no ~ '^[0-9]{12}$'
    group by option_barcode_no
    having count(distinct upper(regexp_replace(barcode, '\s+', '', 'g'))) > 1
  ) then
    raise exception 'OPTION_IDENTITY_MULTIPLE_BCODES_EXIST';
  end if;
end
$guard$;

insert into public.option_bcode_projection_ledger(
  option_barcode_no, b_code, source, source_event_id, changed_at
)
select distinct on (o.option_barcode_no)
  o.option_barcode_no,
  upper(regexp_replace(o.barcode, '\s+', '', 'g')),
  'migration_seed',
  'migration-seed:' || o.option_barcode_no,
  coalesce(o.updated_at, now())
from public.product_launch_options o
where o.option_barcode_no ~ '^[0-9]{12}$'
  and upper(regexp_replace(coalesce(o.barcode, ''), '\s+', '', 'g')) ~ '^B[A-Z]{2}[0-9]+-[0-9]+$'
order by o.option_barcode_no, o.updated_at desc
on conflict (option_barcode_no) do update
set b_code = excluded.b_code,
    source = excluded.source,
    source_event_id = excluded.source_event_id,
    changed_at = excluded.changed_at,
    updated_at = now();

insert into public.option_bcode_projection_events(
  event_id, option_barcode_no, b_code, source, changed_at
)
select source_event_id, option_barcode_no, b_code, source, changed_at
from public.option_bcode_projection_ledger
on conflict (event_id) do nothing;

create or replace function public.sync_product_launch_option_barcode_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_bcode text;
  v_no text;
  v_identity text;
  v_ledger_bcode text;
  v_conflicting_no text;
begin
  new.option_payload := coalesce(new.option_payload, '{}'::jsonb);
  v_bcode := upper(regexp_replace(coalesce(new.barcode, new.option_payload->>'barcode', ''), '\s+', '', 'g'));

  if v_bcode <> '' and v_bcode !~ '^B[A-Z]{2}[0-9]+-[0-9]+$' then
    raise exception 'BCODE_FORMAT_INVALID:%', v_bcode;
  end if;

  if tg_op = 'UPDATE' and coalesce(old.option_barcode_no, '') ~ '^[0-9]{12}$' then
    v_no := old.option_barcode_no;
    if coalesce(new.option_barcode_no, v_no) <> v_no then
      raise exception 'OPTION_BARCODE_IMMUTABLE:%:%', v_no, coalesce(new.option_barcode_no, '');
    end if;
  else
    v_no := coalesce(nullif(new.option_barcode_no, ''), nullif(new.option_payload->>'optionBarcodeNo', ''));
  end if;

  if coalesce(v_no, '') !~ '^[0-9]{12}$' then
    select r.option_barcode_no into v_no
    from public.resolve_option_barcode_nos(jsonb_build_array(jsonb_build_object(
      'identityKey', 'OPTION:' || new.owner_id::text || ':' || new.item_id || ':' || new.option_id,
      'identityKind', 'OPTION',
      'primaryBCode', '',
      'composition', coalesce(new.option_payload->'setComposition', '[]'::jsonb),
      'previousIdentityKey', '',
      'existingOptionBarcodeNo', ''
    ))) r
    limit 1;
  end if;

  if coalesce(v_no, '') !~ '^[0-9]{12}$' then
    raise exception 'OPTION_BARCODE_AUTO_ISSUE_FAILED';
  end if;

  v_identity := coalesce(
    nullif(new.option_barcode_identity_key, ''),
    nullif(new.option_payload->>'optionBarcodeIdentityKey', ''),
    case when tg_op = 'UPDATE' then nullif(old.option_barcode_identity_key, '') end,
    'OPTION:' || new.owner_id::text || ':' || new.item_id || ':' || new.option_id
  );
  select l.b_code into v_ledger_bcode
  from public.option_bcode_projection_ledger l
  where l.option_barcode_no = v_no;

  if tg_op = 'UPDATE' and upper(regexp_replace(coalesce(old.barcode, ''), '\s+', '', 'g')) is distinct from v_bcode then
    if v_ledger_bcode is null or v_ledger_bcode is distinct from v_bcode then
      raise exception 'BCODE_CANONICAL_WRITE_REQUIRED:%:%', v_no, v_bcode;
    end if;
  end if;

  if v_bcode <> '' then
    select l.option_barcode_no into v_conflicting_no
    from public.option_bcode_projection_ledger l
    where l.b_code = v_bcode and l.option_barcode_no <> v_no
    limit 1;
    if v_conflicting_no is not null then
      raise exception 'BCODE_ALREADY_ASSIGNED:%:%', v_bcode, v_conflicting_no;
    end if;

    if v_ledger_bcode is null then
      insert into public.option_bcode_projection_ledger(
        option_barcode_no, b_code, source, source_event_id, changed_at
      ) values (
        v_no, v_bcode, 'normalized_insert',
        'normalized-insert:' || new.owner_id::text || ':' || new.item_id || ':' || new.option_id,
        now()
      );
    elsif v_ledger_bcode is distinct from v_bcode then
      raise exception 'BCODE_CANONICAL_WRITE_REQUIRED:%:%', v_no, v_bcode;
    end if;
  elsif tg_op = 'UPDATE' and coalesce(btrim(old.barcode), '') <> '' then
    raise exception 'BCODE_CANONICAL_WRITE_REQUIRED:%:EMPTY', v_no;
  end if;

  new.barcode := v_bcode;
  new.option_barcode_no := v_no;
  new.option_barcode_identity_key := v_identity;
  new.option_payload := new.option_payload || jsonb_build_object(
    'barcode', v_bcode,
    'optionBarcodeNo', v_no,
    'optionBarcodeIdentityKey', v_identity,
    'optionBarcodeIdentityKind', case
      when v_identity like 'B:%' then 'B_CODE'
      when v_identity like 'SET:%' then 'SET'
      else 'OPTION'
    end
  );
  return new;
end;
$function$;

create or replace function public.apply_option_bcode_projection(
  p_event_id text,
  p_option_barcode_no text,
  p_b_code text,
  p_source text,
  p_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event public.option_bcode_projection_events%rowtype;
  v_current public.option_bcode_projection_ledger%rowtype;
  v_bcode text := upper(regexp_replace(coalesce(p_b_code, ''), '\s+', '', 'g'));
  v_rows integer := 0;
  v_conflict text;
begin
  if coalesce(btrim(p_event_id), '') = '' or length(p_event_id) > 300 then
    raise exception 'BCODE_EVENT_ID_INVALID';
  end if;
  if coalesce(p_option_barcode_no, '') !~ '^[0-9]{12}$' then
    raise exception 'OPTION_BARCODE_INVALID';
  end if;
  if v_bcode !~ '^B[A-Z]{2}[0-9]+-[0-9]+$' then
    raise exception 'BCODE_FORMAT_INVALID:%', v_bcode;
  end if;

  perform pg_advisory_xact_lock(hashtext('option:' || p_option_barcode_no));
  perform pg_advisory_xact_lock(hashtext('bcode:' || v_bcode));

  select * into v_event
  from public.option_bcode_projection_events
  where event_id = p_event_id;
  if found then
    if v_event.option_barcode_no <> p_option_barcode_no or v_event.b_code <> v_bcode then
      raise exception 'BCODE_EVENT_ID_CONFLICT:%', p_event_id;
    end if;
    return jsonb_build_object('ok', true, 'changed', false, 'idempotent', true,
      'optionBarcodeNo', p_option_barcode_no, 'bCode', v_bcode);
  end if;

  select option_barcode_no into v_conflict
  from public.option_bcode_projection_ledger
  where b_code = v_bcode and option_barcode_no <> p_option_barcode_no
  limit 1;
  if v_conflict is not null then
    raise exception 'BCODE_ALREADY_ASSIGNED:%:%', v_bcode, v_conflict;
  end if;

  select * into v_current
  from public.option_bcode_projection_ledger
  where option_barcode_no = p_option_barcode_no
  for update;

  insert into public.option_bcode_projection_ledger(
    option_barcode_no, b_code, source, source_event_id, changed_at
  ) values (
    p_option_barcode_no, v_bcode,
    coalesce(nullif(btrim(p_source), ''), 'product_master'),
    p_event_id, coalesce(p_changed_at, now())
  )
  on conflict (option_barcode_no) do update
  set b_code = excluded.b_code,
      source = excluded.source,
      source_event_id = excluded.source_event_id,
      changed_at = excluded.changed_at,
      updated_at = now();

  update public.product_launch_options
  set barcode = v_bcode,
      option_payload = coalesce(option_payload, '{}'::jsonb) || jsonb_build_object(
        'barcode', v_bcode,
        'optionBarcodeNo', p_option_barcode_no
      ),
      updated_at = now()
  where option_barcode_no = p_option_barcode_no;
  get diagnostics v_rows = row_count;

  update public.option_barcode_registry
  set primary_b_code = v_bcode,
      updated_at = now()
  where option_barcode_no = p_option_barcode_no;

  insert into public.option_bcode_projection_events(
    event_id, option_barcode_no, b_code, source, changed_at
  ) values (
    p_event_id, p_option_barcode_no, v_bcode,
    coalesce(nullif(btrim(p_source), ''), 'product_master'),
    coalesce(p_changed_at, now())
  );

  return jsonb_build_object(
    'ok', true,
    'changed', v_current.option_barcode_no is null or v_current.b_code is distinct from v_bcode,
    'idempotent', false,
    'optionBarcodeNo', p_option_barcode_no,
    'bCode', v_bcode,
    'updatedRows', v_rows
  );
end;
$function$;

revoke all on function public.apply_option_bcode_projection(text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_option_bcode_projection(text,text,text,text,timestamptz) to service_role;

create index if not exists product_launch_options_option_barcode_no_idx
  on public.product_launch_options(option_barcode_no);
create index if not exists product_launch_options_barcode_idx
  on public.product_launch_options(barcode)
  where coalesce(btrim(barcode), '') <> '';

commit;
