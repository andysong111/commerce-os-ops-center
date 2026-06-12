import assert from "node:assert/strict";
import test from "node:test";
import { calculateBarcodeLabelPrintCount } from "../src/lib/barcodeLabelPrint.ts";

test("prints one label for every item when the label unit is one", () => {
  assert.equal(calculateBarcodeLabelPrintCount(300, 1), 300);
});

test("rounds up when the item quantity does not divide evenly", () => {
  assert.equal(calculateBarcodeLabelPrintCount(101, 10), 11);
  assert.equal(calculateBarcodeLabelPrintCount(5, 10), 1);
});

test("uses whole item and unit counts", () => {
  assert.equal(calculateBarcodeLabelPrintCount(10.9, 3.8), 4);
});

test("returns zero for non-printable quantities or label units", () => {
  assert.equal(calculateBarcodeLabelPrintCount(0, 1), 0);
  assert.equal(calculateBarcodeLabelPrintCount(-10, 1), 0);
  assert.equal(calculateBarcodeLabelPrintCount(10, 0), 0);
  assert.equal(calculateBarcodeLabelPrintCount(10, Number.NaN), 0);
  assert.equal(calculateBarcodeLabelPrintCount(Number.POSITIVE_INFINITY, 1), 0);
});
