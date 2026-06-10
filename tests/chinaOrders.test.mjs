import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAppliedExchangeRate,
  calculateChinaOrders,
  SAMPLE_CHINA_ORDERS,
} from "../src/lib/chinaOrders.ts";

test("calculates the expected aaa270 and aaa179 final unit costs in CNY", () => {
  const rows = calculateChinaOrders(SAMPLE_CHINA_ORDERS, 235);
  const aaa270 = rows.find((row) => row.modelNo === "aaa270");
  const aaa179 = rows.find((row) => row.modelNo === "aaa179");

  assert.ok(aaa270);
  assert.ok(aaa179);
  assert.ok(Math.abs(aaa270.finalUnitCostCny - 0.3667) < 0.0001);
  assert.equal(aaa179.finalUnitCostCny, 0.75);
});

test("applies percentage and fixed exchange fees to KRW calculations", () => {
  const appliedRate = calculateAppliedExchangeRate({
    baseExchangeRateKrwPerCny: 200,
    feeRatePercent: 2,
    feeFixedKrwPerCny: 1,
  });
  const [row] = calculateChinaOrders(
    [
      {
        id: "fee-test",
        freightGroupId: "fee-group",
        modelNo: "test",
        modelName: "test",
        optionName: "test",
        quantity: 10,
        unitCostCny: 1,
        domesticChinaFreightCny: 0,
      },
    ],
    appliedRate,
  );

  assert.equal(appliedRate, 205);
  assert.equal(row.finalUnitCostKrw, 205);
  assert.equal(row.totalFinalPurchaseCostKrw, 2050);
});
