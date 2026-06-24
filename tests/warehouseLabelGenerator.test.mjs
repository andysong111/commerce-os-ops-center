import assert from "node:assert/strict";
import test from "node:test";
import {
  WAREHOUSE_LABEL_50X30_MM,
  createWarehouseLabelPdf,
  getFontSizeForCode,
  parseWarehouseCodesFromCsv,
  parseWarehouseCodesFromText,
} from "../src/lib/warehouseLabelGenerator.ts";

test("parses warehouse codes from Korean CSV header", () => {
  assert.deepEqual(parseWarehouseCodesFromCsv("전체코드\nBAA1-1\nBAA1-2\n"), [
    "BAA1-1",
    "BAA1-2",
  ]);
});

test("parses warehouse codes from code CSV header with quoted values", () => {
  assert.deepEqual(parseWarehouseCodesFromCsv('name,code\nA,"BAA1-1"\nB,BBA1-3\n'), [
    "BAA1-1",
    "BBA1-3",
  ]);
});

test("parses direct input by newline and removes blanks", () => {
  assert.deepEqual(parseWarehouseCodesFromText("BAA1-1\n\n BAA1-2 \r\n"), [
    "BAA1-1",
    "BAA1-2",
  ]);
});

test("creates one 50x30mm PDF page for each warehouse code", () => {
  const pdf = new TextDecoder().decode(createWarehouseLabelPdf(["BAA1-1", "BAA1-2", "BAA1-3"]));

  assert.match(pdf, /%PDF-1\.4/);
  assert.match(pdf, /\/Count 3/);
  assert.match(pdf, /\/MediaBox \[0 0 141\.732 85\.039\]/);
  assert.match(pdf, /\(BAA1-1\) Tj/);
  assert.equal(Math.round(WAREHOUSE_LABEL_50X30_MM.widthPt * 1000) / 1000, 141.732);
  assert.equal(Math.round(WAREHOUSE_LABEL_50X30_MM.heightPt * 1000) / 1000, 85.039);
});

test("shrinks long warehouse codes below the default label font size", () => {
  assert.equal(getFontSizeForCode("BAA1-1"), 22);
  assert.ok(getFontSizeForCode("VERY-LONG-WAREHOUSE-LOCATION-CODE-001") < 22);
});

test("allows the warehouse label max font size to be increased", () => {
  assert.equal(getFontSizeForCode("BAA1-1", { maxFontSize: 28 }), 28);

  const pdf = new TextDecoder().decode(createWarehouseLabelPdf(["BAA1-1"], { maxFontSize: 36 }));
  assert.match(pdf, /\/F1 36 Tf/);
  assert.match(pdf, /\/MediaBox \[0 0 141\.732 85\.039\]/);
});

test("uses safe margin when shrinking oversized warehouse codes", () => {
  const code = "VERY-LONG-WAREHOUSE-LOCATION-CODE-001";
  const fontWithSmallMargin = getFontSizeForCode(code, { maxFontSize: 36, safeMarginMm: 1 });
  const fontWithLargeMargin = getFontSizeForCode(code, { maxFontSize: 36, safeMarginMm: 3 });

  assert.ok(fontWithLargeMargin < fontWithSmallMargin);
});
