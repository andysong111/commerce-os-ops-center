import assert from "node:assert/strict";
import test from "node:test";
import { allocatePurchaseCashflow } from "../src/lib/purchaseCashflowAllocation.ts";

const rows = () => [
  { barcode: "BAA1-1", priorityScore: 100, targetQuantity: 10, unitCostKrw: 1_000, moq: 2, cartonQuantity: 2 },
  { barcode: "BAA2-1", priorityScore: 90, targetQuantity: 10, unitCostKrw: 1_000, moq: 2, cartonQuantity: 2 },
  { barcode: "BAA3-1", priorityScore: 80, targetQuantity: 10, unitCostKrw: 1_000, moq: 2, cartonQuantity: 2 },
  { barcode: "BAA4-1", priorityScore: 70, targetQuantity: 10, unitCostKrw: 1_000, moq: 2, cartonQuantity: 2 },
];

test("enough cash preserves every engine target", () => {
  const result = allocatePurchaseCashflow(rows(), 40_000);
  assert.deepEqual(result.map((row) => row.allocatedQuantity), [10, 10, 10, 10]);
  assert.equal(result.reduce((sum, row) => sum + row.estimatedCostKrw, 0), 40_000);
  assert.ok(result.every((row) => row.cashAdjusted === false));
});

test("tight cash protects core then tapers support and canary without breaking cartons", () => {
  const result = allocatePurchaseCashflow(rows(), 24_000);
  assert.deepEqual(result.map((row) => row.tier), ["CORE", "SUPPORT", "SUPPORT", "CANARY"]);
  assert.deepEqual(result.map((row) => row.allocatedQuantity), [10, 6, 6, 2]);
  assert.equal(result.reduce((sum, row) => sum + row.estimatedCostKrw, 0), 24_000);
  assert.ok(result.every((row) => row.allocatedQuantity % row.cartonQuantity === 0));
  assert.ok(result.every((row) => row.allocatedQuantity >= row.minimumQuantity));
});

test("insufficient cash excludes lower rows explicitly instead of exceeding the cap", () => {
  const result = allocatePurchaseCashflow(rows(), 12_000);
  assert.deepEqual(result.map((row) => row.allocatedQuantity), [10, 2, 0, 0]);
  assert.equal(result.reduce((sum, row) => sum + row.estimatedCostKrw, 0), 12_000);
  assert.ok(result.every((row) => row.allocatedQuantity <= row.targetQuantity));
});

test("allocation is deterministic and never mutates the source", () => {
  const source = rows().reverse();
  const original = structuredClone(source);
  const first = allocatePurchaseCashflow(source, 24_000);
  const second = allocatePurchaseCashflow([...source].reverse(), 24_000);
  assert.deepEqual(source, original);
  assert.deepEqual(first, second);
});
