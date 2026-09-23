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

test('legacy group blocker retry is allowed only before any write and with matching fresh pricing identity',()=>{
  const h=storeHarness();
  const oldCandidate={...candidate(),productGroup:'',reason:'MONTHLY_PRICE_GROUP_REQUIRED'};
  const freshCandidate={...candidate(),productGroup:'',reason:null};
  const item={id:itemId,state:'BLOCKED',write_index:0,plan:null,transmission:null,error_code:'MONTHLY_PRICE_GROUP_REQUIRED',candidate:oldCandidate};
  assert.equal(h.api.canRetryLegacyGroupBlockedItem(item,freshCandidate,true),true);
  assert.equal(h.api.canRetryLegacyGroupBlockedItem({...item,write_index:1},freshCandidate,true),false);
  assert.equal(h.api.canRetryLegacyGroupBlockedItem({...item,plan:{fingerprint:'x'}},freshCandidate,true),false);
  assert.equal(h.api.canRetryLegacyGroupBlockedItem(item,{...freshCandidate,reason:'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED'},true),false);
  const changed={...freshCandidate,options:[{...freshCandidate.options[0],protectedCostKrw:freshCandidate.options[0].protectedCostKrw+1}]};
  assert.equal(h.api.canRetryLegacyGroupBlockedItem(item,changed,true),false);
  assert.equal(h.api.canRetryLegacyGroupBlockedItem(item,freshCandidate,false),false);
});
