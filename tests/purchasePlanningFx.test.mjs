import assert from "node:assert/strict";
import test from "node:test";
import { calculateInternalChinaPurchaseCostSummary } from "../src/lib/internalChinaPurchaseCostMath.ts";
import {
  parseEcbDailyPurchaseFx,
  planningDraftRate,
  readConsistentPurchasePlanningFx,
} from "../src/lib/purchasePlanningFx.ts";

const now = new Date("2026-11-26T01:00:00Z");
const ecbXml = `<Cube><Cube time='2026-11-25'>
    <Cube currency='CNY' rate='7.2999'/>
    <Cube currency='KRW' rate='1471.19'/>
  </Cube></Cube>`;

test("ECB cross-rate is applied once to 1688 goods and domestic freight before the 1.50 arrival estimate", () => {
  const quote = parseEcbDailyPurchaseFx(ecbXml, now);
  assert.deepEqual(quote, { source: "ECB", date: "2026-11-25", baseKrwPerCny: 1471.19 / 7.2999 });
  const rate = planningDraftRate(quote);
  assert.equal(rate.exchangeRateKrwPerCny.toFixed(2), "211.61");
  const cost = calculateInternalChinaPurchaseCostSummary({
    ...rate,
    lines: [{ quantity: 10, unitPriceCny: 9, domesticChinaFreightCny: 10 }],
    internalOrderCostMultiplier: 1.5,
  });
  assert.equal(cost.actualOrderCostKrw, 21_161);
  assert.equal(cost.paymentFeeKrw, 0);
  assert.equal(cost.internalBaseCostKrw, 31_742);
});

test("the ECB feed rejects missing, duplicate, invalid, future and stale observations", () => {
  assert.throws(() => parseEcbDailyPurchaseFx(ecbXml.replace("KRW", "USD"), now), /RATES_INVALID/);
  assert.throws(() => parseEcbDailyPurchaseFx(ecbXml.replace("KRW", "CNY"), now), /RATES_INVALID/);
  assert.throws(() => parseEcbDailyPurchaseFx(ecbXml.replace("7.2999", "0"), now), /RATES_INVALID/);
  for (const date of ["2026-11-27", "2026-11-18", "2026-11-31"]) {
    assert.throws(() => parseEcbDailyPurchaseFx(ecbXml.replace("2026-11-25", date), now), /DATE_INVALID/);
  }
  assert.throws(() => parseEcbDailyPurchaseFx(ecbXml + ecbXml, now), /DATE_INVALID/);
});

test("a saved ECB quote survives JSON storage and conflicting draft quotes stop recalculation", () => {
  const quote = parseEcbDailyPurchaseFx(ecbXml, now);
  const stored = JSON.parse(JSON.stringify(quote));
  const restored = readConsistentPurchasePlanningFx([undefined, quote, stored]);
  assert.deepEqual(planningDraftRate(restored), planningDraftRate(quote));
  assert.equal(readConsistentPurchasePlanningFx([undefined, { source: "another provider" }]), null);
  assert.throws(
    () => readConsistentPurchasePlanningFx([quote, { ...quote, date: "2026-11-24" }]),
    /PURCHASE_DRAFT_FX_CONFLICT/,
  );
});
