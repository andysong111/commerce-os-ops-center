import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBarcodeLabelPrintCounts,
  calculateBarcodeLabelPrintCount,
  calculateTotalBarcodeLabelPrintCount,
  normalizeUnitsPerLabel,
} from "../src/lib/barcodeLabelPrint.ts";

test("calculates one label per unit by default", () => {
  assert.equal(calculateBarcodeLabelPrintCount(24, 1), 24);
});

test("rounds up when a final partial bundle needs a label", () => {
  assert.equal(calculateBarcodeLabelPrintCount(101, 10), 11);
});

test("normalizes invalid quantities and units per label safely", () => {
  assert.equal(calculateBarcodeLabelPrintCount(0, 10), 0);
  assert.equal(calculateBarcodeLabelPrintCount(-4, 10), 0);
  assert.equal(calculateBarcodeLabelPrintCount(Number.NaN, 10), 0);
  assert.equal(normalizeUnitsPerLabel(0), 1);
  assert.equal(normalizeUnitsPerLabel(Number.POSITIVE_INFINITY), 1);
  assert.equal(normalizeUnitsPerLabel(2.9), 2);
});

test("builds per-item counts and a total", () => {
  const counts = buildBarcodeLabelPrintCounts(
    [
      { id: "first", quantity: 25 },
      { id: "second", quantity: 8 },
    ],
    { first: 10, second: 4 },
  );

  assert.deepEqual(counts, [
    { itemId: "first", quantity: 25, unitsPerLabel: 10, printCount: 3 },
    { itemId: "second", quantity: 8, unitsPerLabel: 4, printCount: 2 },
  ]);
  assert.equal(calculateTotalBarcodeLabelPrintCount(counts), 5);
});
