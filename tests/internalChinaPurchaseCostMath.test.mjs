import assert from "node:assert/strict";
import test from "node:test";

import { calculateInternalChinaPurchaseCostSummary } from "../src/lib/internalChinaPurchaseCostMath.ts";
import {
  DEFAULT_PAYMENT_FEE_MULTIPLIER,
  DEFAULT_PURCHASE_COST_MULTIPLIER,
  calculateProductOrderBudget,
} from "../src/lib/productDecisionEngine/portfolio.ts";

test("the upper-card fixture separates the 0.8% WorldFirst fee from the 1.50 landed-cost policy", () => {
  const summary = calculateInternalChinaPurchaseCostSummary({
    lines: [{
      quantity: 1,
      unitPriceCny: 18_372.1209,
      domesticChinaFreightCny: 1_260.95,
    }],
    exchangeRateKrwPerCny: 230,
    paymentFeeMultiplier: DEFAULT_PAYMENT_FEE_MULTIPLIER,
    internalOrderCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
  });

  assert.equal(DEFAULT_PAYMENT_FEE_MULTIPLIER, 1.008);
  assert.equal(DEFAULT_PURCHASE_COST_MULTIPLIER, 1.5);
  assert.equal(summary.productCostKrw, 4_225_588);
  assert.equal(summary.domesticChinaAdjustmentKrw, 290_019);
  assert.equal(summary.paymentFeeKrw, 36_125);
  assert.equal(summary.actualOrderCostKrw, 4_551_731);
  assert.equal(summary.internalBaseCostKrw, 6_827_597);
});

test("the budget cap and remaining amount reserve both policy multipliers", () => {
  const availableCashKrw = 7_841_739;
  const productCostKrw = 4_225_588;
  const productBudgetKrw = calculateProductOrderBudget(
    availableCashKrw,
    DEFAULT_PURCHASE_COST_MULTIPLIER,
    DEFAULT_PAYMENT_FEE_MULTIPLIER,
  );

  assert.equal(productBudgetKrw, 5_176_065);
  assert.equal(productBudgetKrw - productCostKrw, 950_477);
});

test("a final-payment coupon stays signed and lowers both actual and internal cost", () => {
  const summary = calculateInternalChinaPurchaseCostSummary({
    lines: [
      { quantity: 75, unitPriceCny: 12.63, domesticChinaFreightCny: -0.31 },
      { quantity: 25, unitPriceCny: 7.96, domesticChinaFreightCny: 0 },
    ],
    exchangeRateKrwPerCny: 230,
    paymentFeeMultiplier: 1.05,
    internalOrderCostMultiplier: 1.5,
  });

  assert.equal(summary.domesticChinaAdjustmentCny, -0.31);
  assert.equal(summary.domesticChinaAdjustmentKrw, -71);
  assert.equal(summary.actualOrderCostKrw, 276_745);
  assert.equal(summary.internalBaseCostKrw, 415_117);
});
