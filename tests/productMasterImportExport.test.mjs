import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PRODUCT_ORIGIN,
  exportProductMasterItemsToCsv,
  exportProductMasterItemsToJson,
  parseProductMasterCsv,
  previewProductMasterCsv,
} from "../src/lib/productMasterImportExport.ts";

test("parses English Product Master headers and trims whitespace", () => {
  const rows = parseProductMasterCsv(`
model_no,model_name,option_name,barcode,madeIn,display_name,note
  PM-001  ,  Storage Basket  , Large , 12345 , KOREA , Basket Large ,  sample
`);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].values, {
    modelNo: "PM-001",
    modelName: "Storage Basket",
    optionName: "Large",
    barcode: "12345",
    origin: "KOREA",
    displayName: "Basket Large",
    memo: "sample",
  });
});

test("maps Korean Product Master headers and ignores fully empty rows", () => {
  const rows = parseProductMasterCsv(
    "모델번호,상품명,옵션,상품바코드,제조국,노출명,비고\n" +
      "K-100,수납함,파랑,8801,대한민국,파란 수납함,테스트\n" +
      ",,,,,,\n",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.modelNo, "K-100");
  assert.equal(rows[0].values.modelName, "수납함");
  assert.equal(rows[0].values.optionName, "파랑");
  assert.equal(rows[0].values.origin, "대한민국");
});

test("supports commas, quotes, and newlines inside quoted CSV values", () => {
  const rows = parseProductMasterCsv(
    'modelNo,modelName,displayName,memo\nQ-1,"Box, Large","Large ""Box""","line 1\nline 2"',
  );

  assert.equal(rows[0].values.modelName, "Box, Large");
  assert.equal(rows[0].values.displayName, 'Large "Box"');
  assert.equal(rows[0].values.memo, "line 1\nline 2");
});

test("validates required fields without crashing and defaults origin", () => {
  const result = previewProductMasterCsv(
    "modelNo,modelName,displayName,origin\n" +
      ",Missing model,,\n" +
      "PM-2,,,\n" +
      "PM-3,,Display fallback,\n",
  );

  assert.equal(result.summary.totalRows, 3);
  assert.equal(result.summary.validCount, 1);
  assert.equal(result.summary.invalidCount, 2);
  assert.match(result.invalidRows[0].messages[0], /modelNo/);
  assert.match(result.invalidRows[1].messages[0], /modelName or displayName/);
  assert.equal(result.validItems[0].modelName, "Display fallback");
  assert.equal(result.validItems[0].origin, DEFAULT_PRODUCT_ORIGIN);
});

test("reports duplicate model numbers as warnings while preserving option rows", () => {
  const result = previewProductMasterCsv(
    "modelNo,modelName,optionName\n" +
      "PM-4,Product,Blue\n" +
      "pm-4,Product,Red\n",
  );

  assert.equal(result.validItems.length, 2);
  assert.deepEqual(result.duplicateModelNos, ["PM-4"]);
  assert.equal(result.summary.duplicateCount, 1);
  assert.equal(result.summary.warningCount, 1);
  assert.deepEqual(result.warnings[0].rowNumbers, [2, 3]);
});

test("exports stable CSV headers and safely escaped values", () => {
  const csv = exportProductMasterItemsToCsv([
    {
      id: "one",
      modelNo: "PM-5",
      modelName: "Basket, Large",
      optionName: 'Blue "Ocean"',
      displayName: "Large Basket",
      origin: "MADE IN CHINA",
      memo: "line 1\nline 2",
    },
  ]);

  assert.equal(
    csv,
    'modelNo,modelName,optionName,barcode,origin,displayName,memo\n' +
      'PM-5,"Basket, Large","Blue ""Ocean""",,MADE IN CHINA,Large Basket,"line 1\nline 2"',
  );
});

test("exports normalized JSON without storage-only fields", () => {
  const json = exportProductMasterItemsToJson([
    {
      id: "internal-id",
      modelNo: "PM-6",
      modelName: "Product",
      optionName: "",
      displayName: "Display Product",
    },
  ]);

  assert.deepEqual(JSON.parse(json), [
    {
      modelNo: "PM-6",
      modelName: "Product",
      optionName: "",
      barcode: "",
      origin: "",
      displayName: "Display Product",
      memo: "",
    },
  ]);
});
