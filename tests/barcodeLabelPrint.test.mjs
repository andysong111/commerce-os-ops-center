import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildBarcodeLabelPages,
  buildSampleBarcodeLabelPages,
  calculateBarcodeLabelPrint,
  formatBarcodeBundleUnit,
  getSampleBarcodeLabelCount,
  getTotalBarcodeLabelCount,
} from "../src/lib/barcodeLabelPrint.ts";

function base(printCount) {
  return { printCount, remainder: 0, hasRemainderWarning: false };
}

test("detects a 10-item bundle unit from the work memo", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 300, memo: "10개씩 소분 후 바코드 부착" }), {
    printCount: 30,
    bundleUnit: 10,
    remainder: 0,
    fullBundleCount: 30,
    hasRemainderWarning: false,
  });
});

test("prints one label per item for an individual-attachment memo", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 50, memo: "개별 부착" }), base(50));
});

test("prints one label for a box memo", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 50, memo: "박스 외부 바코드 부착" }), base(1));
});

test("falls back to quantity when the memo is empty", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 60, memo: "" }), base(60));
});

test("rounds up partial memo-detected bundles", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 55, memo: "10개씩" }), {
    printCount: 6,
    bundleUnit: 10,
    remainder: 5,
    fullBundleCount: 5,
    hasRemainderWarning: true,
  });
});

test("falls back to one label for invalid quantities", () => {
  for (const quantity of [undefined, null, "", 0, -1, Number.NaN, "invalid"]) {
    assert.deepEqual(calculateBarcodeLabelPrint({ quantity, memo: "10개씩" }), base(1));
  }
});

test("manual bundle unit takes precedence over memo detection", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 95, memo: "10개씩", bundleUnit: 20 }), {
    printCount: 5,
    bundleUnit: 20,
    remainder: 15,
    fullBundleCount: 4,
    hasRemainderWarning: true,
  });
});

test("manual print count takes precedence over bundle unit and memo", () => {
  assert.deepEqual(
    calculateBarcodeLabelPrint({ quantity: 95, memo: "10개씩", bundleUnit: 20, printCount: 7 }),
    base(7),
  );
});

test("calculates bundle print counts and remainders", () => {
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 115, bundleUnit: 10 }), {
    printCount: 12, bundleUnit: 10, remainder: 5, fullBundleCount: 11, hasRemainderWarning: true,
  });
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 100, bundleUnit: 10 }), {
    printCount: 10, bundleUnit: 10, remainder: 0, fullBundleCount: 10, hasRemainderWarning: false,
  });
  assert.deepEqual(calculateBarcodeLabelPrint({ quantity: 53, bundleUnit: 20 }), {
    printCount: 3, bundleUnit: 20, remainder: 13, fullBundleCount: 2, hasRemainderWarning: true,
  });
});

test("does not show remainder warnings for individual or box memos", () => {
  assert.equal(calculateBarcodeLabelPrint({ quantity: 50, memo: "개별 부착" }).hasRemainderWarning, false);
  assert.equal(calculateBarcodeLabelPrint({ quantity: 50, memo: "박스 외부 바코드 부착" }).hasRemainderWarning, false);
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

test("sample labels deduplicate barcodes, skip missing values, and preserve first occurrence order", () => {
  const first = { id: "first", barcode: "BAA1-1", quantity: 6, printCount: 6 };
  const items = [
    first,
    { id: "duplicate", barcode: "BAA1-1", quantity: 2, printCount: 2 },
    { id: "missing", barcode: "  ", quantity: 3, printCount: 3 },
    { id: "second", barcode: "BBA1-3", quantity: 4, printCount: 4 },
    { id: "third", barcode: "C01-01", quantity: 1, printCount: 1 },
  ];

  const samplePages = buildSampleBarcodeLabelPages(items);

  assert.equal(buildBarcodeLabelPages([first]).length, 6);
  assert.equal(samplePages.length, 3);
  assert.deepEqual(
    samplePages.map(({ item }) => item.barcode),
    ["BAA1-1", "BBA1-3", "C01-01"],
  );
  assert.deepEqual(samplePages.map(({ printCount }) => printCount), [1, 1, 1]);
  assert.equal(getSampleBarcodeLabelCount(items), 3);
});


test("uses a horizontal custom page for individual barcode labels", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(css, /@page barcode-label \{[\s\S]*?size: 52mm 32mm;/);
  assert.match(
    css,
    /\.print-individual-labels \.individual-label-page,[\s\S]*?\.print-sample-labels \.individual-label-page \{[\s\S]*?width: 52mm;[\s\S]*?height: 32mm;/,
  );
  assert.match(
    css,
    /\.barcode-label-card \{[\s\S]*?width: 52mm;[\s\S]*?height: 32mm;/,
  );
});
