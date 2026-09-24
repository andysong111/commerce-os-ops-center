import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/lib/monthlyPriceCore.ts';
import {loadModule} from './monthly-price-module.mjs';
import {fixture,runId,itemId,candidate} from './monthly-price-fixtures.mjs';

function sourceHarness() {
  const f=fixture();
  const groups={CHINA_ORDER_COMMITMENT_EVENT:f.receiptRows, INTERNAL_CHINA_FORWARDER_COST_CLOSE:[{result_snapshot:f.close}], INTERNAL_CHINA_PURCHASE_PREP:[{result_snapshot:{snapshot:f.draft}}], INTERNAL_CHINA_PURCHASE_QUANTITY_OVERRIDE:[]};
  const db={from(){let op; const q={select(){return q;},eq(k,v){if(k==='operation_type')op=v;return q;},order(){return q;},range(){return q;},then(yes,no){return Promise.resolve({data:groups[op],error:null}).then(yes,no);}};return q;}};
  const api=loadModule('../src/lib/monthlyPriceSource.ts',{
    '@/lib/supabase/admin':{createSupabaseAdminClient:async()=>db},
    '@/lib/internalChinaDraftQuantityOverride':{applyInternalChinaActualPurchaseCosts:x=>x,applyInternalChinaQuantityOverrides:x=>x},
    '@/lib/internalChinaMonthlyPurchaseSummary':{buildInternalChinaMonthlyPurchaseSummaryFromRows:()=>null},
    '@/lib/internalChinaForwarderCost':{buildInternalChinaForwarderCostSummaryFromDraft:(draft,month,actualCostKrw,closedAt)=>({...f.close,draftId:draft.draftId,cycleMonth:month,actualCostKrw,closedAt})},
    '@/lib/productDecisionLiveRefresh':{loadProductPlanningSnapshot:async()=>({products:[]})},
    '@/lib/shopling/shoplingProductGroupRegistry':{loadShoplingProductGroupsByGoodsKey:async()=>new Map()},
    '@/lib/monthlyPriceCore':core,
  });
  return {groups,api};
}
test('source revision changes immutable run key even when affected candidates are identical',async()=>{
  const h=sourceHarness(),a=await h.api.loadMonthlyPriceSources('2026-09');
  h.groups.INTERNAL_CHINA_PURCHASE_QUANTITY_OVERRIDE.push({source_event_id:'unrelated-change',input_snapshot:{draftId:'unrelated'}});
  const b=await h.api.loadMonthlyPriceSources('2026-09');
  assert.equal(JSON.stringify(a.candidates),JSON.stringify(b.candidates));
  assert.notEqual(a.evidenceVersion,b.evidenceVersion);assert.notEqual(a.sourceHash,b.sourceHash);
  await assert.rejects(h.api.assertMonthlyEvidenceUnchanged(a.evidenceVersion),/SOURCE_CHANGED/);
  await h.api.assertMonthlyEvidenceUnchanged(b.evidenceVersion);
});
test('malformed operation response cannot masquerade as empty confirmed receipt history',async()=>{
  const h=sourceHarness();h.groups.INTERNAL_CHINA_PURCHASE_PREP={};
  await assert.rejects(h.api.loadMonthlyPriceSources('2026-09'),/SOURCE_SHAPE_INVALID/);
});
function storeHarness() {
  const state={data:{id:runId},patchRows:[{id:itemId}],rpcRows:[{id:itemId,claim_token:'lease'}]};
  const db={rpc:async()=>({data:state.rpcRows,error:null}),from(){const q={select(){return q;},eq(){return q;},update(){return q;},maybeSingle:async()=>({data:state.data,error:null}),then(yes,no){return Promise.resolve({data:state.patchRows,error:null}).then(yes,no);}};return q;}};
  const api=loadModule('../src/lib/monthlyPriceStore.ts',{'@/lib/supabase/admin':{createSupabaseAdminClient:async()=>db},'@/lib/monthlyPriceCore':core});
  return {state,api};
}
test('repository REST client has maybeSingle only; missing run is an explicit error',async()=>{
  const h=storeHarness();assert.equal((await h.api.loadMonthlyPriceRun(runId)).id,runId);
  h.state.data=null;await assert.rejects(h.api.loadMonthlyPriceRun(runId),/RUN_NOT_FOUND/);
});
test('claim and CAS require an actual single-row array response',async()=>{
  const h=storeHarness();assert.equal((await h.api.claimMonthlyPriceItem(itemId)).id,itemId);
  h.state.rpcRows={id:itemId};await assert.rejects(h.api.claimMonthlyPriceItem(itemId),/CLAIM_FAILED/);
  const item={id:itemId,claim_token:'lease',candidate:candidate()};
  await h.api.saveMonthlyPriceItem(item);
  h.state.patchRows={id:itemId};await assert.rejects(h.api.saveMonthlyPriceItem(item),/LEASE_LOST/);
  h.state.patchRows=[];await assert.rejects(h.api.saveMonthlyPriceItem(item),/LEASE_LOST/);
});

test('retryable prewrite blockers are allowed only before any write and with matching fresh pricing identity',()=>{
  const h=storeHarness();
  const oldCandidate={...candidate(),productGroup:'',reason:'MONTHLY_PRICE_GROUP_REQUIRED'};
  const freshCandidate={...candidate(),productGroup:'',reason:null};
  const item={id:itemId,state:'BLOCKED',write_index:0,plan:null,transmission:null,error_code:'MONTHLY_PRICE_GROUP_REQUIRED',candidate:oldCandidate};
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem(item,freshCandidate,true),true);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem({...item,error_code:'MONTHLY_PRICE_INACTIVE_LISTING',candidate:freshCandidate},freshCandidate,true),true);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem({...item,error_code:'MONTHLY_PRICE_MALL_CURRENT_PRICE_REQUIRED',candidate:freshCandidate},freshCandidate,true),true);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem({...item,error_code:'MONTHLY_PRICE_OPTION_BARCODE_CONFLICT',candidate:freshCandidate},freshCandidate,true),true);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem({...item,error_code:'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED'},freshCandidate,true),false);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem({...item,write_index:1},freshCandidate,true),false);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem({...item,plan:{fingerprint:'x'}},freshCandidate,true),false);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem(item,{...freshCandidate,reason:'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED'},true),false);
  const changed={...freshCandidate,options:[{...freshCandidate.options[0],protectedCostKrw:freshCandidate.options[0].protectedCostKrw+1}]};
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem(item,changed,true),false);
  assert.equal(h.api.canRetryMonthlyPrewriteBlockedItem(item,freshCandidate,false),false);
});


function resumeStoreHarness() {
  const oldCandidate={...candidate(),productGroup:'',reason:'MONTHLY_PRICE_GROUP_REQUIRED'};
  const freshCandidate={...candidate(),productGroup:'',reason:null};
  const run={
    id:runId,cycle_month:'2026-09',source_hash:'old-hash',policy_version:core.MONTHLY_PRICE_POLICY,
    source_snapshot:{evidenceVersion:'evidence-v1'},created_at:'2026-09-22T00:00:00Z'
  };
  const item={
    id:itemId,run_id:runId,goods_key:oldCandidate.goodsKey,state:'BLOCKED',candidate:oldCandidate,
    plan:null,write_index:0,claim_token:null,claim_until:null,error_code:'MONTHLY_PRICE_GROUP_REQUIRED',
    transmission:null,updated_at:'2026-09-22T00:00:00Z'
  };
  const state={run,item,audit:[],rpcCount:0};
  const db={
    rpc:async(name,args)=>{
      assert.equal(name,'claim_monthly_price_item');assert.equal(args.p_item_id,itemId);
      state.rpcCount+=1;
      return {data:[{...structuredClone(state.item),claim_token:'lease',claim_until:'2099-01-01T00:00:00Z'}],error:null};
    },
    from(table){
      let patch=null,filters=[];
      const q={
        select(){return q;},
        eq(key,value){filters.push([key,value]);return q;},
        order(){return q;},
        limit(){return q;},
        update(value){patch=value;return q;},
        insert:async(value)=>{
          assert.equal(table,'commerce_monthly_price_audit');
          state.audit.push(structuredClone(value));
          return {data:[value],error:null};
        },
        maybeSingle:async()=>{
          if(table==='commerce_monthly_price_runs'){
            const idFilter=filters.find(([key])=>key==='id');
            return {data:!idFilter||idFilter[1]===state.run.id?structuredClone(state.run):null,error:null};
          }
          return {data:null,error:null};
        },
        then(yes,no){
          let result;
          if(table==='commerce_monthly_price_items'&&patch){
            const idOk=filters.every(([key,value])=>key!=='id'||value===state.item.id);
            const tokenOk=filters.every(([key,value])=>key!=='claim_token'||value==='lease');
            if(idOk&&tokenOk){
              Object.assign(state.item,structuredClone(patch));
              result={data:[{id:state.item.id}],error:null};
            }else result={data:[],error:null};
          }else if(table==='commerce_monthly_price_items'){
            const runOk=filters.every(([key,value])=>key!=='run_id'||value===state.item.run_id);
            result={data:runOk?[structuredClone(state.item)]:[],error:null};
          }else result={data:[],error:null};
          return Promise.resolve(result).then(yes,no);
        },
      };
      return q;
    },
  };
  const api=loadModule('../src/lib/monthlyPriceStore.ts',{'@/lib/supabase/admin':{createSupabaseAdminClient:async()=>db},'@/lib/monthlyPriceCore':core});
  const source={month:'2026-09',sourceHash:'fresh-hash',evidenceVersion:'evidence-v1',candidates:[freshCandidate],costs:[],warnings:[],scope:[]};
  return {state,api,source};
}

test('actual resume preflight persists stale GROUP_REQUIRED -> QUEUED and audits the transition',async()=>{
  const h=resumeStoreHarness();
  const status=await h.api.resumeMonthlyPriceRunPreflight(runId,h.source);
  assert.equal(h.state.rpcCount,1);
  assert.equal(h.state.item.state,'QUEUED');
  assert.equal(h.state.item.error_code,null);
  assert.equal(h.state.item.plan,null);
  assert.equal(status.items[0].state,'QUEUED');
  assert.equal(status.items[0].error_code,null);
  assert.deepEqual(h.state.audit.map(row=>row.event),['PREFLIGHT_BLOCK_RETRY']);
});

test('actual resume preflight requeues a corrected option-barcode conflict only before any write',async()=>{
  const h=resumeStoreHarness();
  h.state.item.candidate={...h.state.item.candidate,reason:null};
  h.state.item.error_code='MONTHLY_PRICE_OPTION_BARCODE_CONFLICT';
  h.source.candidates[0]={...h.source.candidates[0],reason:null};
  const status=await h.api.resumeMonthlyPriceRunPreflight(runId,h.source);
  assert.equal(h.state.rpcCount,1);
  assert.equal(h.state.item.state,'QUEUED');assert.equal(h.state.item.error_code,null);
  assert.equal(status.items[0].state,'QUEUED');
  assert.deepEqual(h.state.audit.map(row=>row.event),['PREFLIGHT_BLOCK_RETRY']);
});

test('actual resume preflight also requeues a safe stale inactive-listing blocker for live status re-read',async()=>{
  const h=resumeStoreHarness();
  h.state.item.candidate={...h.state.item.candidate,reason:null};
  h.state.item.error_code='MONTHLY_PRICE_INACTIVE_LISTING';
  h.source.candidates[0]={...h.source.candidates[0],reason:null};
  const status=await h.api.resumeMonthlyPriceRunPreflight(runId,h.source);
  assert.equal(h.state.rpcCount,1);
  assert.equal(h.state.item.state,'QUEUED');assert.equal(h.state.item.error_code,null);
  assert.equal(status.items[0].state,'QUEUED');
  assert.deepEqual(h.state.audit.map(row=>row.event),['PREFLIGHT_BLOCK_RETRY']);
});

test('actual resume preflight rejects changed evidence and refuses changed pricing identity',async()=>{
  const stale=resumeStoreHarness();
  await assert.rejects(
    stale.api.resumeMonthlyPriceRunPreflight(runId,{...stale.source,evidenceVersion:'evidence-v2'}),
    /SOURCE_CHANGED/,
  );
  assert.equal(stale.state.item.state,'BLOCKED');assert.equal(stale.state.rpcCount,0);

  const changed=resumeStoreHarness();
  changed.source.candidates[0]={...changed.source.candidates[0],options:[{...changed.source.candidates[0].options[0],protectedCostKrw:changed.source.candidates[0].options[0].protectedCostKrw+1}]};
  const status=await changed.api.resumeMonthlyPriceRunPreflight(runId,changed.source);
  assert.equal(changed.state.item.state,'BLOCKED');assert.equal(changed.state.rpcCount,0);
  assert.equal(changed.state.audit.length,0);assert.equal(status.items[0].state,'BLOCKED');
});
