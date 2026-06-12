import assert from "node:assert/strict";
import test from "node:test";

import { calculateBarcodeLabelPrint } from "../src/lib/barcodeLabelPrint.ts";

test("detects a 10-item bundle unit from the work memo", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({
      quantity: 300,
      memo: "10개씩 소분 후 바코드 부착",
    }),
    { printCount: 30, bundleUnit: 10 },
  );
});

test("prints one label per item for an individual-attachment memo", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({ quantity: 50, memo: "개별 부착" }),
    { printCount: 50 },
  );
});

test("prints one label for a box memo", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({ quantity: 50, memo: "박스 외부 바코드 부착" }),
    { printCount: 1 },
  );
});

test("falls back to quantity when the memo is empty", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 60, memo: "" }), {
    printCount: 60,
  });
});

test("rounds up partial memo-detected bundles", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({ quantity: 55, memo: "10개씩" }),
    { printCount: 6, bundleUnit: 10 },
  );
});

test("falls back to one label for invalid quantities", () => {
  for (const quantity of [undefined, null, "", 0, -1, Number.NaN, "invalid"]) {
    assert.deepEqual(calculateBarcodeLabelPrint({ quantity, memo: "10개씩" }), {
      printCount: 1,
    });
  }
});

test("manual bundle unit takes precedence over memo detection", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({
      quantity: 95,
      memo: "10개씩",
      bundleUnit: 20,
    }),
    { printCount: 5, bundleUnit: 20 },
  );
});

test("manual print count takes precedence over bundle unit and memo", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({
      quantity: 95,
      memo: "10개씩",
      bundleUnit: 20,
      printCount: 7,
    }),
    { printCount: 7 },
  );
});
