import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/lib/monthlyPriceCore.ts';
import { loadModule } from './monthly-price-module.mjs';
import { candidate, live, observation, goodsKey, runId, itemId } from './monthly-price-fixtures.mjs';

const nextBatchId='55555555-5555-4555-8555-555555555555';

function harness() {
  const c=candidate();
  const beforeObservation=observation(1000);
  const plan=core.buildMonthlyPricePlan(c,live(1000),beforeObservation);
  const base=plan.targets.find(row=>row.mallKey===null);
  const mall=plan.targets.find(row=>row.mallKey==='SMALL_00069');
  const appliedLive=live(base.target.sellPrice,base.options?.[0]?.targetAmount??0);
  const appliedObservation=observation(mall.target.sellPrice);
  const token='44444444-4444-4444-8444-444444444444';
  const item={
    id:itemId,run_id:runId,goods_key:goodsKey,state:'RESENDING',candidate:c,plan,
    write_index:plan.writes.length,claim_token:null,claim_until:null,
    error_code:'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED',
    transmission:{token,fingerprint:plan.fingerprint,claimedAt:'2026-09-24T00:00:00.000Z'},
    updated_at:'2026-09-24T00:00:00.000Z',
  };
  const log=[];
  let liveRows=appliedLive;
  const api=loadModule('../src/lib/monthlyPriceLegacyReview.ts',{
    '@/lib/monthlyPriceCore':core,
    '@/lib/monthlyPriceShopling':{readMonthlyLiveProduct:async()=>liveRows},
    '@/lib/monthlyPriceStore':{
      withMonthlyPriceItem:async(id,rid,work)=>{assert.equal(id,itemId);assert.equal(rid,runId);return work(item,{id:runId});},
      auditMonthlyPrice:async(_,event,evidence)=>log.push({event,evidence}),
    },
  });
  const market=(status,sellPrice,code='LIVE-1')=>({
    mallKey:'SMALL_00069',status,mallProductCode:code,mallProductName:'fixture mall',
    sellPrice,source:'linked_market_table',
  });
  const call=(marketRows)=>api.reviewLegacyMonthlyTransmission({
    itemId,runId,nextBatchId,
    observation:{...appliedObservation,observedAt:Date.now(),marketRows},
  });
  return {item,plan,mall,token,log,market,call,set liveRows(value){liveRows=value;}};
}

test('legacy market review finishes an old uncertain transmission when every selling market price matches',async()=>{
  const h=harness();
  const result=await h.call([
    h.market('삭제',99999,'OLD-1'),
    h.market('판매중',h.mall.target.sellPrice,'LIVE-1'),
  ]);
  assert.equal(result.marketReview.state,'MATCHED');
  assert.equal(result.requeued,false);
  assert.equal(h.item.state,'TRANSMITTED');
  assert.equal(h.item.error_code,null);
  assert.equal(h.item.transmission.token,h.token);
  assert.equal(h.item.transmission.result,'LINKED_MARKET_PRICE_VERIFIED');
  assert.equal(h.log.at(-1).event,'LEGACY_MARKET_PRICE_VERIFIED');
});

test('legacy market review gives only a proven mismatch a fresh batch capability',async()=>{
  const h=harness();
  const result=await h.call([h.market('판매중',h.mall.target.sellPrice-100)]);
  assert.equal(result.marketReview.state,'MISMATCH');
  assert.equal(result.requeued,true);
  assert.equal(h.item.state,'RESENDING');
  assert.equal(h.item.error_code,null);
  assert.equal(h.item.transmission.batchId,nextBatchId);
  assert.equal(h.item.transmission.fingerprint,h.plan.fingerprint);
  assert.notEqual(h.item.transmission.token,h.token);
  assert.equal(h.log.at(-1).event,'LEGACY_MARKET_PRICE_MISMATCH_REQUEUE');
});

test('legacy market review keeps missing linked-market evidence blocked from automatic resend',async()=>{
  const h=harness();
  const result=await h.call([]);
  assert.equal(result.marketReview.state,'UNCERTAIN');
  assert.equal(result.requeued,false);
  assert.equal(h.item.state,'RESENDING');
  assert.equal(h.item.error_code,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(h.item.transmission.token,h.token);
  assert.equal(h.item.transmission.batchId,undefined);
  assert.equal(h.log.at(-1).event,'LEGACY_MARKET_PRICE_REVIEW_UNCERTAIN');
});

test('legacy market review revalidates immutable Shopling source prices before any retry decision',async()=>{
  const h=harness();
  h.liveRows=live(1000);
  await assert.rejects(()=>h.call([h.market('판매중',h.mall.target.sellPrice-100)]),/MONTHLY_PRICE_READBACK_MISMATCH/);
  assert.equal(h.item.error_code,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(h.item.transmission.token,h.token);
  assert.equal(h.log.length,0);
});

test('legacy market review never takes over a modern batch transmission',async()=>{
  const h=harness();
  h.item.transmission.batchId='66666666-6666-4666-8666-666666666666';
  const result=await h.call([h.market('판매중',h.mall.target.sellPrice-100)]);
  assert.equal(result.marketReview,null);
  assert.equal(result.requeued,false);
  assert.equal(h.item.transmission.batchId,'66666666-6666-4666-8666-666666666666');
  assert.equal(h.log.length,0);
});
