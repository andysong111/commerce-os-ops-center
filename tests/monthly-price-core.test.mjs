import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, candidate, live, observation } from './monthly-price-fixtures.mjs';
import { monthlyCostsFromEvidence, monthlyProtectedCosts, monthlyValidateObservation, monthlyMoney, monthlyMonth, buildMonthlyPricePlan, assertMonthlyWritePreimage, verifyMonthlyPricePlan, monthlyLiveProduct } from '../src/lib/monthlyPriceCore.ts';

test('September missing cache: durable receipt plus matching freight close reconstructs only arrival cost', () => {
  const input = fixture(), before = structuredClone(input);
  const cost = monthlyCostsFromEvidence(input);
  assert.equal(cost[0].unitCostKrw, 1495); assert.equal(cost[0].quantity, 10);
  assert.equal(cost[0].provenance, 'CONFIRMED_RECEIPT_AND_CLOSED_COST'); assert.deepEqual(input, before);
  assert.equal('inventoryQuantity' in cost[0], false);
});
test('August-style receipt without captured cost can use verified immutable paid-order + close evidence', () => {
  const input = fixture(); delete input.receiptRows[0].result_snapshot.receiptCost;
  assert.equal(monthlyCostsFromEvidence(input)[0].unitCostKrw, 1495);
});
for (const [name, mutate, code] of [
  ['missing final close', x => delete x.close.closedAt, /FINAL_COST/],
  ['post-close draft change', x => x.draft.savedAt='2026-09-12T00:00:00Z', /CLOSED_DRAFT_CHANGED/],
  ['wrong close totals', x => x.close.productPurchaseCostKrw++, /CLOSED_DRAFT_CHANGED/],
  ['wrong close multiplier', x => x.close.actualMultiplier=1.45, /CLOSED_COST_CONFLICT/],
  ['invented month', x => x.receiptRows[0].result_snapshot.cycleMonth='2026-08', /IDENTITY_CONFLICT/],
  ['payload other draft', x => x.receiptRows[0].input_snapshot.payload.draftId='other', /IDENTITY_CONFLICT/],
  ['duplicate receipt', x => x.receiptRows.push(structuredClone(x.receiptRows[0])), /RECEIPT_DUPLICATE/],
  ['partially received', x => { x.receiptRows[0].result_snapshot.receivedNow=9; x.receiptRows[0].input_snapshot.payload.receivedNow=9; delete x.receiptRows[0].result_snapshot.receiptCost; }, /RECEIPT_INCOMPLETE/],
  ['captured unit cost mismatch', x => x.receiptRows[0].result_snapshot.receiptCost.unitCostKrw=999, /CAPTURED_COST_CONFLICT/],
  ['unknown cost never defaults to zero', x => delete x.draft.lines[0].unitPriceCny, /COST_INPUT_MISSING/],
  ['malformed receipt UUID', x => { x.receiptRows[0].result_snapshot.receiptId='-'.repeat(36); x.receiptRows[0].input_snapshot.payload.receiptId='-'.repeat(36); }, /IDENTITY_CONFLICT/],
]) test(`receipt protection: ${name}`, () => { const x=fixture(); mutate(x); assert.throws(() => monthlyCostsFromEvidence(x), code); });
test('mixed legacy stock: high verified historical cost retained, not weighted using unknown quantities', () => {
  const c=monthlyCostsFromEvidence(fixture()); c[0].unitCostKrw=900;
  const history=[{...c[0],unitCostKrw:1200,quantity:1},{...c[0],unitCostKrw:99999,provenance:'ESTIMATED'}];
  assert.equal(monthlyProtectedCosts(c,history).get('ABC1-1'),1200);
});
test('base increase preserves independently higher channel price and display original purchase/list prices', () => {
  const plan=buildMonthlyPricePlan(candidate(),live(1000),observation(99000));
  assert.equal(plan.writes.length,1); assert.equal(plan.writes[0].mallKey,null);
  assert.equal(plan.targets.find(x=>x.mallKey)?.target.sellPrice,99000);
  assert.equal(plan.writes[0].target.purchasePrice,321); assert.equal(plan.writes[0].target.consumerPrice,6543);
  assert.equal(plan.protectedDecreaseCount,1);
});
test('unknown or low cost cannot produce automatic markdown', () => {
  assert.equal(buildMonthlyPricePlan(candidate(500),live(99999),observation(99999)).writes.length,0);
  assert.throws(()=>buildMonthlyPricePlan({...candidate(),reason:'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED'},live(),observation()),/CONFIRMED_COST_REQUIRED/);
  assert.throws(()=>buildMonthlyPricePlan(candidate(0),live(),observation()),/VALUE_INVALID/);
});
test('unknown unit count, group, nonzero surcharge and shared option scope require review', () => {
  const c=candidate(); c.options[0].unitsPerOrder=0;
  assert.throws(()=>buildMonthlyPricePlan(c,live(),observation()),/VALUE_INVALID/);
  assert.throws(()=>buildMonthlyPricePlan({...candidate(),productGroup:'unknown'},live(),observation()),/GROUP_REQUIRED/);
  assert.throws(()=>buildMonthlyPricePlan(candidate(),[{...live()[0],optAmt:'-100'}],observation()),/SURCHARGE_REVIEW/);
  assert.throws(()=>buildMonthlyPricePlan(candidate(),[...live(),{...live()[0],optId:'99'}],observation()),/OPTION_SCOPE/);
});
test('different known option targets are blocked rather than rewriting cheap options', () => {
  const c=candidate(); c.options.push({...c.options[0],barcode:'ABC1-2',optionId:'12',currentCostKrw:1700,protectedCostKrw:1700});
  assert.throws(()=>buildMonthlyPricePlan(c,[...live(),{...live()[0],optId:'12'}],observation()),/OPTION_TARGET_CONFLICT/);
});
test('missing current channel or conflicting multiple accounts never guessed', () => {
  assert.throws(()=>buildMonthlyPricePlan(candidate(),live(),{...observation(),rows:[]}),/MALL_CURRENT_PRICE/);
  const o=observation(); o.rows.push({...o.rows[0],sellPrice:5000});
  assert.throws(()=>buildMonthlyPricePlan(candidate(),live(),o),/MALL_ACCOUNT_CONFLICT/);
});
test('observation rejects stale, wrong page identity and positional fallback', () => {
  for(const patch of [{observedAt:Date.now()-31000},{goodsKey:'9999999'},{pageUrl:'https://evil.invalid/'},{rows:[{...observation().rows[0],source:'position'}]}]) assert.throws(()=>monthlyValidateObservation({...observation(),...patch},'1234567'));
  assert.equal(monthlyValidateObservation(observation(),'1234567').rows.length,1);
});
test('absolute target + preimage makes repeat safe, external drift blocks instead of lowering', () => {
  const p=buildMonthlyPricePlan(candidate(),live(),observation()), w=p.writes[0];
  assert.equal(assertMonthlyWritePreimage(w,w.before),'WRITE'); assert.equal(assertMonthlyWritePreimage(w,w.target),'ALREADY_APPLIED');
  assert.throws(()=>assertMonthlyWritePreimage(w,{...w.before,sellPrice:99999}),/CURRENT_PRICE_CHANGED/);
});
test('positive readback requires every base and connected channel target, not an API ACK', () => {
  const p=buildMonthlyPricePlan(candidate(),live(),observation());
  assert.throws(()=>verifyMonthlyPricePlan(p,candidate(),live(),observation()),/READBACK_MISMATCH/);
  const b=p.targets.find(x=>x.mallKey===null),m=p.targets.find(x=>x.mallKey);
  assert.equal(verifyMonthlyPricePlan(p,candidate(),live(b.target.sellPrice),observation(m.target.sellPrice)),true);
  assert.throws(()=>monthlyLiveProduct(candidate(),[{...live()[0],sale_status:'D'}]),/INACTIVE_LISTING/);
});
test('boundary validation: zero, missing, booleans, decimals, infinite, malformed month', () => {
  for(const v of [null,undefined,'',false,0,-1,0.5,Infinity,100000001]) assert.throws(()=>monthlyMoney(v));
  assert.equal(monthlyMoney(0,true),0);
  for(const m of ['2026-00','2026-13','2026-9',null]) assert.throws(()=>monthlyMonth(m));
});
test('deterministic 1000-case property: no base/channel decrease and no ancillary-cost rewrite', () => {
  let seed=19; const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  for(let i=0;i<1000;i++) {
    const p=buildMonthlyPricePlan(candidate(1+rng()%20000),live(1+rng()%50000),observation(1+rng()%70000));
    for(const t of p.targets) {assert.ok(t.target.sellPrice>=t.before.sellPrice); assert.equal(t.target.purchasePrice,t.before.purchasePrice); assert.equal(t.target.consumerPrice,t.before.consumerPrice);}
  }
});
