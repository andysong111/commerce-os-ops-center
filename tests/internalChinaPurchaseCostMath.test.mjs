import assert from "node:assert/strict";
import test from "node:test";

import { calculateInternalChinaPurchaseCostSummary } from "../src/lib/internalChinaPurchaseCostMath.ts";
import {
  DEFAULT_PURCHASE_COST_MULTIPLIER,
  calculateProductOrderBudget,
} from "../src/lib/productDecisionEngine/portfolio.ts";

test("the historical upper-card mismatch fixture uses one final-order calculation at 1.03", () => {
  const summary = calculateInternalChinaPurchaseCostSummary({
    lines: [{
      quantity: 1,
      unitPriceCny: 18_372.1209,
      domesticChinaFreightCny: 1_260.95,
    }],
    exchangeRateKrwPerCny: 230,
    internalOrderCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
  });

  assert.equal(DEFAULT_PURCHASE_COST_MULTIPLIER, 1.03);
  assert.equal(summary.productCostKrw, 4_225_588);
  assert.equal(summary.domesticChinaAdjustmentKrw, 290_019);
  assert.equal(summary.actualOrderCostKrw, 4_515_606);
  assert.equal(summary.internalBaseCostKrw, 4_651_074);
  assert.notEqual(summary.internalBaseCostKrw, 6_547_629);
});

test("the budget cap and remaining amount use the same 1.03 policy", () => {
  const availableCashKrw = 7_841_739;
  const productCostKrw = 4_225_588;
  const productBudgetKrw = calculateProductOrderBudget(
    availableCashKrw,
    DEFAULT_PURCHASE_COST_MULTIPLIER,
  );

  assert.equal(productBudgetKrw, 7_613_338);
  assert.equal(productBudgetKrw - productCostKrw, 3_387_750);
});

test("a final-payment coupon stays signed and lowers both actual and internal cost", () => {
  const summary = calculateInternalChinaPurchaseCostSummary({
    lines: [
      { quantity: 75, unitPriceCny: 12.63, domesticChinaFreightCny: -0.31 },
      { quantity: 25, unitPriceCny: 7.96, domesticChinaFreightCny: 0 },
    ],
    exchangeRateKrwPerCny: 230,
    internalOrderCostMultiplier: 1.03,
  });

  assert.equal(summary.domesticChinaAdjustmentCny, -0.31);
  assert.equal(summary.domesticChinaAdjustmentKrw, -71);
  assert.equal(summary.actualOrderCostKrw, 263_566);
  assert.equal(summary.internalBaseCostKrw, 271_473);
});
