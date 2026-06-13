import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBarcodeLabelPages,
  calculateBarcodeLabelPrint,
  formatBarcodeBundleUnit,
  getTotalBarcodeLabelCount,
} from "../src/lib/barcodeLabelPrint.ts";

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


test("formats detected bundle units for the work request", () => {
  assert.equal(
    formatBarcodeBundleUnit({ quantity: 300, memo: "10개씩 소분 후 바코드 부착" }),
    "10개",
  );
  assert.equal(formatBarcodeBundleUnit({ quantity: 50, memo: "개별 부착" }), "개별");
  assert.equal(formatBarcodeBundleUnit({ quantity: 50, memo: "박스 외부" }), "박스 외부");
  assert.equal(
    formatBarcodeBundleUnit({ quantity: 300, memo: "10개씩", printCount: 25 }),
    "10개",
  );
});

test("does not build label pages for an item with a missing barcode", () => {
  assert.deepEqual(
    buildBarcodeLabelPages([
      { id: "missing", barcode: "", quantity: 300, memo: "10개씩" },
    ]),
    [],
  );
});

test("totals final print counts across printable barcode items", () => {
  const items = [
    { id: "bundled", barcode: "BAA1-1", quantity: 300, memo: "10개씩" },
    { id: "individual", barcode: "BAA1-2", quantity: 50, memo: "개별 부착" },
    { id: "box", barcode: "BAA1-3", quantity: 50, memo: "박스 외부" },
    { id: "missing", barcode: "", quantity: 200, memo: "개별 부착" },
  ];

  assert.equal(getTotalBarcodeLabelCount(items), 81);
  assert.equal(buildBarcodeLabelPages(items).length, 81);
});

test("builds one small-page label per final print count without changing the barcode value", () => {
  const pages = buildBarcodeLabelPages([
    {
      id: "manual-count",
      barcode: "BAA1-1",
      quantity: 50,
      memo: "long work request memo that must not affect the encoded barcode",
      printCount: 6,
    },
  ]);

  assert.equal(pages.length, 6);
  assert.deepEqual(pages.map(({ item }) => item.barcode), Array(6).fill("BAA1-1"));
});
