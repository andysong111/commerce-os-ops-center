import assert from "node:assert/strict";
import test from "node:test";

const { calculateInternalChinaOrderedSpendKrw } = await import(
  new URL("../src/lib/internalChinaPurchaseOrderSpend.ts", import.meta.url)
);

test("ordered purchase spend includes product cost and China domestic freight", () => {
  const amount = calculateInternalChinaOrderedSpendKrw({
    lines: [
      { quantity: 10, unitPriceCny: 2, domesticChinaFreightCny: 5 },
      { quantity: 5, unitPriceCny: 5, domesticChinaFreightCny: 5 },
    ],
    exchangeRateKrwPerCny: 230,
    internalOrderCostMultiplier: 1.45,
  });
  assert.equal(amount, Math.round(55 * 230 * 1.45));
});

test("ordered purchase spend fails closed when price evidence is incomplete", () => {
  assert.throws(
    () => calculateInternalChinaOrderedSpendKrw({
      lines: [{ quantity: 10, unitPriceCny: 0, domesticChinaFreightCny: 0 }],
      exchangeRateKrwPerCny: 230,
      internalOrderCostMultiplier: 1.45,
    }),
    /INTERNAL_CHINA_ORDER_SPEND_UNVERIFIED/,
  );
  assert.throws(
    () => calculateInternalChinaOrderedSpendKrw({
      lines: [],
      exchangeRateKrwPerCny: 230,
      internalOrderCostMultiplier: 1.45,
    }),
    /INTERNAL_CHINA_ORDER_SPEND_UNVERIFIED/,
  );
});
