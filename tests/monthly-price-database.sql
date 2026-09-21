begin;
do $$
declare r uuid; i uuid; j uuid; token uuid; fresh_token uuid; touched integer; key text := 'fixture-'||gen_random_uuid();
begin
  if exists(select 1 from pg_class where oid in ('public.commerce_monthly_price_runs'::regclass,'public.commerce_monthly_price_items'::regclass,'public.commerce_monthly_price_goods_locks'::regclass,'public.commerce_monthly_price_audit'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
  if has_table_privilege('anon','public.commerce_monthly_price_items','SELECT') or has_table_privilege('authenticated','public.commerce_monthly_price_items','UPDATE') or has_function_privilege('anon','public.claim_monthly_price_item(uuid)','EXECUTE') then raise exception 'untrusted role access'; end if;
  insert into public.commerce_monthly_price_runs(cycle_month,policy_version,source_hash,source_snapshot) values('2099-01','TEST',repeat('a',64),'{}') returning id into r;
  insert into public.commerce_monthly_price_items(run_id,goods_key,candidate) values(r,key,'{}') returning id into i;
  select claim_token into token from public.claim_monthly_price_item(i);
  if token is null then raise exception 'claim not durable'; end if;
  begin perform public.claim_monthly_price_item(i); raise exception 'duplicate lease allowed'; exception when others then if SQLERRM <> 'MONTHLY_PRICE_ITEM_BUSY' then raise; end if; end;
  insert into public.commerce_monthly_price_runs(cycle_month,policy_version,source_hash,source_snapshot) values('2099-02','TEST',repeat('b',64),'{}') returning id into r;
  insert into public.commerce_monthly_price_items(run_id,goods_key,candidate) values(r,key,'{}') returning id into j;
  begin perform public.claim_monthly_price_item(j); raise exception 'cross-month duplicate allowed'; exception when others then if SQLERRM <> 'MONTHLY_PRICE_GOODSKEY_BUSY' then raise; end if; end;
  update public.commerce_monthly_price_items set state='WRITING',claim_until=now()-interval '1 minute' where id=i;
  select claim_token into fresh_token from public.claim_monthly_price_item(i);
  if fresh_token=token then raise exception 'lease token reused'; end if;
  update public.commerce_monthly_price_items set state='PREPARED' where id=i and claim_token=token;
  get diagnostics touched=ROW_COUNT;
  if touched<>0 then raise exception 'stale CAS accepted'; end if;
  if (select state from public.commerce_monthly_price_items where id=i)<>'WRITING' then raise exception 'ambiguous write lost'; end if;
  update public.commerce_monthly_price_items set state='TRANSMITTED',claim_until=null where id=i;
  perform public.claim_monthly_price_item(j);
  if (select item_id from public.commerce_monthly_price_goods_locks where goods_key=key)<>j then raise exception 'terminal lock not transferable'; end if;
end;
$$;
rollback;
