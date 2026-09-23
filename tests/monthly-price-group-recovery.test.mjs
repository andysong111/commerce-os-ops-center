import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverMonthlyPriceGroup } from '../src/lib/monthlyPriceGroupRecovery.ts';
import { candidate, live, observation } from './monthly-price-fixtures.mjs';

test('registered group remains authoritative',()=>{
  const result=recoverMonthlyPriceGroup({registeredGroup:'도매3',candidate:candidate(),liveRows:live(),observation:observation()});
  assert.equal(result.group,'도매3');assert.equal(result.source,'OPS_REGISTRY');
});
test('DM/SM partner-code prefix restores exact modern group when present',()=>{
  const rows=live();rows[0].ptn_goods_cd='SM2_OLD123';
  const result=recoverMonthlyPriceGroup({candidate:candidate(),liveRows:rows,observation:observation()});
  assert.equal(result.group,'소매2');assert.equal(result.source,'SELF_CODE_PREFIX');
});
test('legacy product with wholesale-only channels falls back to lowest wholesale group',()=>{
  const result=recoverMonthlyPriceGroup({candidate:{...candidate(),productGroup:''},liveRows:live(5000),observation:observation(5000)});
  assert.equal(result.group,'도매1');assert.equal(result.source,'WHOLESALE_CHANNEL_FAMILY');assert.deepEqual(result.mallScopeKeys,['SMALL_00069']);
});
test('legacy product with retail-only channels falls back to lowest retail group',()=>{
  const o=observation(5000);o.rows=[{...o.rows[0],mallKey:'SMALL_00012'}];
  const result=recoverMonthlyPriceGroup({candidate:{...candidate(),productGroup:''},liveRows:live(5000),observation:o});
  assert.equal(result.group,'소매1');assert.equal(result.source,'RETAIL_CHANNEL_FAMILY');assert.deepEqual(result.mallScopeKeys,['SMALL_00012']);
});
test('mixed channel evidence uses only strong price bands and never guesses the overlapping middle',()=>{
  const c={...candidate(1000),productGroup:''};
  const mixed=observation(2000);mixed.rows=[mixed.rows[0],{...mixed.rows[0],mallKey:'SMALL_00012'}];
  assert.equal(recoverMonthlyPriceGroup({candidate:c,liveRows:live(2200),observation:mixed}).group,'도매1');
  assert.equal(recoverMonthlyPriceGroup({candidate:c,liveRows:live(2800),observation:mixed}).group,'소매1');
  assert.equal(recoverMonthlyPriceGroup({candidate:c,liveRows:live(2600),observation:mixed}).group,null);
});
