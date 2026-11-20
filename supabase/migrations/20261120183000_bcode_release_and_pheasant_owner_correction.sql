begin;

create table if not exists public.option_bcode_release_events (
  event_id text primary key,
  option_barcode_no text not null,
  previous_b_code text not null,
  source text not null,
  changed_at timestamptz not null,
  applied_at timestamptz not null default now(),
  constraint option_bcode_release_option_no_format check (option_barcode_no ~ '^[0-9]{12}$'),
  constraint option_bcode_release_previous_code_format check (previous_b_code ~ '^B[A-Z]{2}[0-9]+-[0-9]+$')
);

alter table public.option_bcode_release_events enable row level security;
revoke all on public.option_bcode_release_events from public, anon, authenticated;
grant select, insert on public.option_bcode_release_events to service_role;

create or replace function public.sync_product_launch_option_barcode_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_bcode text;
  v_old_bcode text;
  v_no text;
  v_identity text;
  v_ledger_bcode text;
  v_conflicting_no text;
  v_release_authorized boolean := false;
begin
  new.option_payload := coalesce(new.option_payload, '{}'::jsonb);
  v_bcode := upper(regexp_replace(coalesce(new.barcode, new.option_payload->>'barcode', ''), '\s+', '', 'g'));
  v_old_bcode := case when tg_op='UPDATE'
    then upper(regexp_replace(coalesce(old.barcode, ''), '\s+', '', 'g'))
    else '' end;

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

  select l.b_code into v_ledger_bcode
  from public.option_bcode_projection_ledger l
  where l.option_barcode_no = v_no;

  if tg_op='UPDATE' and v_old_bcode is distinct from v_bcode then
    if v_bcode='' then
      select exists(
        select 1 from public.option_bcode_release_events e
        where e.option_barcode_no=v_no and e.previous_b_code=v_old_bcode
      ) into v_release_authorized;
      if not v_release_authorized then
        raise exception 'BCODE_CANONICAL_RELEASE_REQUIRED:%:%',v_no,v_old_bcode;
      end if;
    elsif v_ledger_bcode is null or v_ledger_bcode is distinct from v_bcode then
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
        option_barcode_no,b_code,source,source_event_id,changed_at
      ) values (
        v_no,v_bcode,'normalized_insert',
        'normalized-insert:'||new.owner_id::text||':'||new.item_id||':'||new.option_id,now()
      );
    elsif v_ledger_bcode is distinct from v_bcode then
      raise exception 'BCODE_CANONICAL_WRITE_REQUIRED:%:%',v_no,v_bcode;
    end if;
    v_identity := 'B:'||v_bcode;
  else
    v_identity := 'OPTION:BARCODE:'||v_no;
  end if;

  new.barcode := v_bcode;
  new.option_barcode_no := v_no;
  new.option_barcode_identity_key := v_identity;
  new.option_payload := new.option_payload || jsonb_build_object(
    'barcode',v_bcode,
    'optionBarcodeNo',v_no,
    'optionBarcodeIdentityKey',v_identity,
    'optionBarcodeIdentityKind',case when v_bcode<>'' then 'B_CODE' else 'OPTION' end
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
  if coalesce(btrim(p_event_id), '') = '' or length(p_event_id) > 300 then raise exception 'BCODE_EVENT_ID_INVALID'; end if;
  if coalesce(p_option_barcode_no, '') !~ '^[0-9]{12}$' then raise exception 'OPTION_BARCODE_INVALID'; end if;
  if v_bcode !~ '^B[A-Z]{2}[0-9]+-[0-9]+$' then raise exception 'BCODE_FORMAT_INVALID:%',v_bcode; end if;

  perform pg_advisory_xact_lock(hashtext('option:'||p_option_barcode_no));
  perform pg_advisory_xact_lock(hashtext('bcode:'||v_bcode));
  select * into v_event from public.option_bcode_projection_events where event_id=p_event_id;
  if found then
    if v_event.option_barcode_no<>p_option_barcode_no or v_event.b_code<>v_bcode then raise exception 'BCODE_EVENT_ID_CONFLICT:%',p_event_id; end if;
    return jsonb_build_object('ok',true,'changed',false,'idempotent',true,'optionBarcodeNo',p_option_barcode_no,'bCode',v_bcode);
  end if;
  select option_barcode_no into v_conflict from public.option_bcode_projection_ledger where b_code=v_bcode and option_barcode_no<>p_option_barcode_no limit 1;
  if v_conflict is not null then raise exception 'BCODE_ALREADY_ASSIGNED:%:%',v_bcode,v_conflict; end if;
  select * into v_current from public.option_bcode_projection_ledger where option_barcode_no=p_option_barcode_no for update;
  insert into public.option_bcode_projection_ledger(option_barcode_no,b_code,source,source_event_id,changed_at)
  values(p_option_barcode_no,v_bcode,coalesce(nullif(btrim(p_source),''),'product_master'),p_event_id,coalesce(p_changed_at,now()))
  on conflict(option_barcode_no) do update set b_code=excluded.b_code,source=excluded.source,source_event_id=excluded.source_event_id,changed_at=excluded.changed_at,updated_at=now();
  update public.product_launch_options
  set barcode=v_bcode,
      option_barcode_identity_key='B:'||v_bcode,
      option_payload=coalesce(option_payload,'{}'::jsonb)||jsonb_build_object(
        'barcode',v_bcode,'optionBarcodeNo',p_option_barcode_no,
        'optionBarcodeIdentityKey','B:'||v_bcode,'optionBarcodeIdentityKind','B_CODE'),
      updated_at=now()
  where option_barcode_no=p_option_barcode_no;
  get diagnostics v_rows=row_count;
  update public.option_barcode_registry
  set identity_key='B:'||v_bcode,identity_kind='B_CODE',primary_b_code=v_bcode,updated_at=now()
  where option_barcode_no=p_option_barcode_no;
  insert into public.option_bcode_projection_events(event_id,option_barcode_no,b_code,source,changed_at)
  values(p_event_id,p_option_barcode_no,v_bcode,coalesce(nullif(btrim(p_source),''),'product_master'),coalesce(p_changed_at,now()));
  return jsonb_build_object('ok',true,'changed',v_current.option_barcode_no is null or v_current.b_code is distinct from v_bcode,'idempotent',false,'optionBarcodeNo',p_option_barcode_no,'bCode',v_bcode,'updatedRows',v_rows);
end;
$function$;

create or replace function public.release_option_bcode_projection(
  p_event_id text,
  p_option_barcode_no text,
  p_expected_b_code text,
  p_source text,
  p_changed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected text := upper(regexp_replace(coalesce(p_expected_b_code,''),'\s+','','g'));
  v_current text;
  v_existing public.option_bcode_release_events%rowtype;
  v_rows integer := 0;
begin
  if coalesce(btrim(p_event_id),'')='' or length(p_event_id)>300 then raise exception 'BCODE_EVENT_ID_INVALID'; end if;
  if coalesce(p_option_barcode_no,'') !~ '^[0-9]{12}$' then raise exception 'OPTION_BARCODE_INVALID'; end if;
  if v_expected !~ '^B[A-Z]{2}[0-9]+-[0-9]+$' then raise exception 'BCODE_FORMAT_INVALID:%',v_expected; end if;
  perform pg_advisory_xact_lock(hashtext('option:'||p_option_barcode_no));
  perform pg_advisory_xact_lock(hashtext('bcode:'||v_expected));
  select * into v_existing from public.option_bcode_release_events where event_id=p_event_id;
  if found then
    if v_existing.option_barcode_no<>p_option_barcode_no or v_existing.previous_b_code<>v_expected then raise exception 'BCODE_EVENT_ID_CONFLICT:%',p_event_id; end if;
    return jsonb_build_object('ok',true,'changed',false,'idempotent',true,'optionBarcodeNo',p_option_barcode_no,'previousBCode',v_expected);
  end if;
  select b_code into v_current from public.option_bcode_projection_ledger where option_barcode_no=p_option_barcode_no for update;
  if v_current is not null and v_current<>v_expected then raise exception 'BCODE_RELEASE_STALE:%:%:%',p_option_barcode_no,v_current,v_expected; end if;
  insert into public.option_bcode_release_events(event_id,option_barcode_no,previous_b_code,source,changed_at)
  values(p_event_id,p_option_barcode_no,v_expected,coalesce(nullif(btrim(p_source),''),'product_master'),coalesce(p_changed_at,now()));
  delete from public.option_bcode_projection_ledger where option_barcode_no=p_option_barcode_no and b_code=v_expected;
  update public.product_launch_options
  set barcode='',
      option_barcode_identity_key='OPTION:BARCODE:'||p_option_barcode_no,
      option_payload=coalesce(option_payload,'{}'::jsonb)||jsonb_build_object(
        'barcode','','optionBarcodeNo',p_option_barcode_no,
        'optionBarcodeIdentityKey','OPTION:BARCODE:'||p_option_barcode_no,'optionBarcodeIdentityKind','OPTION'),
      updated_at=now()
  where option_barcode_no=p_option_barcode_no and upper(regexp_replace(coalesce(barcode,''),'\s+','','g')) in ('',v_expected);
  get diagnostics v_rows=row_count;
  update public.option_barcode_registry
  set identity_key='OPTION:BARCODE:'||p_option_barcode_no,identity_kind='OPTION',primary_b_code='',updated_at=now()
  where option_barcode_no=p_option_barcode_no;
  return jsonb_build_object('ok',true,'changed',v_current is not null,'idempotent',false,'optionBarcodeNo',p_option_barcode_no,'previousBCode',v_expected,'updatedRows',v_rows);
end;
$function$;

revoke all on function public.release_option_bcode_projection(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.release_option_bcode_projection(text,text,text,text,timestamptz) to service_role;

do $correct_owner_transfer$
begin
  perform public.release_option_bcode_projection('owner-correction-20261120:AAA090:000000000128','000000000128','BBD3-1','owner_instruction_reconciliation_20261120',now());
  perform public.release_option_bcode_projection('owner-correction-20261120:AAA090:000000000129','000000000129','BBD3-2','owner_instruction_reconciliation_20261120',now());
  perform public.apply_option_bcode_projection('owner-correction-20261120:AAA129:000000000298','000000000298','BBD3-1','owner_instruction_reconciliation_20261120',now());
  perform public.apply_option_bcode_projection('owner-correction-20261120:AAA129:000000000299','000000000299','BBD3-2','owner_instruction_reconciliation_20261120',now());
end
$correct_owner_transfer$;

do $postcondition$
declare v_count integer;
begin
  select count(*) into v_count from public.product_launch_options
  where (option_barcode_no,barcode) in (('000000000298','BBD3-1'),('000000000299','BBD3-2'));
  if v_count<>2 then raise exception 'AAA129_OPS_BCODE_RESTORE_FAILED actual=%',v_count; end if;
  if exists(select 1 from public.product_launch_options where option_barcode_no in ('000000000128','000000000129') and barcode<>'') then raise exception 'AAA090_OPS_BCODE_RELEASE_FAILED'; end if;
  select count(*) into v_count from public.option_bcode_projection_ledger where (option_barcode_no,b_code) in (('000000000298','BBD3-1'),('000000000299','BBD3-2'));
  if v_count<>2 then raise exception 'AAA129_OPS_LEDGER_RESTORE_FAILED actual=%',v_count; end if;
end
$postcondition$;

commit;
