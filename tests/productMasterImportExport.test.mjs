import assert from "node:assert/strict";
import test from "node:test";
import {
  exportProductMasterCsv,
  exportProductMasterJson,
  parseProductMasterCsv,
  validateProductMasterImport,
} from "../src/lib/productMasterImportExport.ts";
import { importProductMasterItemsToTemporaryStorage } from "../src/lib/productMasterImport.ts";
import { createInMemoryProductMasterStorage } from "../src/lib/productMasterStore.ts";

test("parses English headers, trims whitespace, and ignores empty rows", () => {
  const rows = parseProductMasterCsv(`model_no, model_name, option_name, barcodeNo, madeIn, display_name, note
 AAA001 , Sample Product , Blue , 123 , KOREA , Display Name , memo

`);

  assert.deepEqual(rows, [{
    modelNo: "AAA001",
    modelName: "Sample Product",
    optionName: "Blue",
    barcode: "123",
    origin: "KOREA",
    displayName: "Display Name",
    memo: "memo",
  }]);
});

test("maps Korean Product Master headers", () => {
  const [row] = parseProductMasterCsv(
    "모델번호,상품명,옵션,상품바코드,제조국,작업명,비고\nAAA002,한국어 상품,대형,456,중국,표시 상품,확인",
  );

  assert.equal(row.modelNo, "AAA002");
  assert.equal(row.modelName, "한국어 상품");
  assert.equal(row.optionName, "대형");
  assert.equal(row.barcode, "456");
  assert.equal(row.origin, "중국");
  assert.equal(row.displayName, "표시 상품");
  assert.equal(row.memo, "확인");
});

test("supports quoted commas and escaped quotes", () => {
  const [row] = parseProductMasterCsv(
    'modelNo,modelName,displayName,memo\nAAA003,"Product, Large","Display ""Large""",memo',
  );

  assert.equal(row.modelName, "Product, Large");
  assert.equal(row.displayName, 'Display "Large"');
});

test("validates required fields, duplicates, and default origin", () => {
  const result = validateProductMasterImport([
    {
      modelNo: "AAA001",
      modelName: "Valid",
      optionName: "",
      barcode: "",
      origin: "",
      displayName: "",
      memo: "",
    },
    {
      modelNo: "",
      modelName: "Missing model",
      optionName: "",
      barcode: "",
      origin: "",
      displayName: "",
      memo: "",
    },
    {
      modelNo: "AAA002",
      modelName: "",
      optionName: "",
      barcode: "",
      origin: "KOREA",
      displayName: "",
      memo: "",
    },
    {
      modelNo: "DUP",
      modelName: "Duplicate one",
      optionName: "",
      barcode: "",
      origin: "",
      displayName: "",
      memo: "",
    },
    {
      modelNo: "dup",
      modelName: "",
      optionName: "",
      barcode: "",
      origin: "",
      displayName: "Duplicate two",
      memo: "",
    },
  ]);

  assert.equal(result.summary.totalRows, 5);
  assert.equal(result.summary.validCount, 1);
  assert.equal(result.summary.invalidCount, 4);
  assert.equal(result.summary.warningCount, 1);
  assert.equal(result.summary.duplicateCount, 1);
  assert.deepEqual(result.duplicateModelNos, ["dup"]);
  assert.equal(result.validItems[0].origin, "MADE IN CHINA");
  assert.match(result.invalidRows[0].messages.join(" "), /modelNo is required/);
  assert.match(result.invalidRows[1].messages.join(" "), /modelName or displayName/);
});

test("exports stable Product Master CSV and JSON shapes", () => {
  const item = {
    id: "aaa-1",
    modelNo: "AAA001",
    modelName: "Sample, Product",
    optionName: "Blue",
    barcode: "123",
    origin: "MADE IN CHINA",
    displayName: "Sample Product · Blue",
    memo: 'memo "quoted"',
    category: "not exported",
  };

  const csv = exportProductMasterCsv([item]);
  assert.equal(
    csv,
    'modelNo,modelName,optionName,barcode,origin,displayName,memo\nAAA001,"Sample, Product",Blue,123,MADE IN CHINA,Sample Product · Blue,"memo ""quoted"""',
  );

  assert.deepEqual(JSON.parse(exportProductMasterJson([item])), [{
    modelNo: "AAA001",
    modelName: "Sample, Product",
    optionName: "Blue",
    barcode: "123",
    origin: "MADE IN CHINA",
    displayName: "Sample Product · Blue",
    memo: 'memo "quoted"',
  }]);
});

test("imports only valid new records into temporary storage and exports them", () => {
  const storage = createInMemoryProductMasterStorage([{
    id: "existing",
    modelNo: "EXISTING",
    modelName: "Original",
    optionName: "",
    displayName: "Original",
  }]);
  const preview = validateProductMasterImport(parseProductMasterCsv(
    `modelNo,modelName,optionName,barcode,origin,displayName,memo
NEW001,New Product,Blue,123,KOREA,New Product Blue,
EXISTING,Replacement,,,KOREA,Replacement,
DUP,Duplicate one,,,KOREA,Duplicate one,
dup,Duplicate two,,,KOREA,Duplicate two,
,Invalid,,,KOREA,Invalid,`,
  ));

  const result = importProductMasterItemsToTemporaryStorage(preview, storage);

  assert.deepEqual(result, {
    importedCount: 1,
    skippedCount: 4,
    skippedExistingModelNos: ["EXISTING"],
    errors: [],
    totalAttempted: 5,
  });
  assert.equal(storage.findByModelNo("NEW001")?.barcode, "123");
  assert.equal(storage.findByModelNo("EXISTING")?.modelName, "Original");
  assert.equal(storage.findByModelNo("DUP"), undefined);
  assert.match(exportProductMasterCsv(storage.list()), /NEW001,New Product/);
  assert.ok(
    JSON.parse(exportProductMasterJson(storage.list()))
      .some((item) => item.modelNo === "NEW001"),
  );
});

test("reports storage errors without counting failed records as imported", () => {
  const storage = createInMemoryProductMasterStorage([{
    id: "colliding-id",
    modelNo: "OTHER",
    modelName: "Other",
    optionName: "",
    displayName: "Other",
  }]);
  const preview = validateProductMasterImport([{
    modelNo: "COLLIDE",
    modelName: "Collision",
    optionName: "id",
    barcode: "",
    origin: "KOREA",
    displayName: "Collision",
    memo: "",
  }]);
  preview.validItems[0].id = "colliding-id";

  const result = importProductMasterItemsToTemporaryStorage(preview, storage);

  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.totalAttempted, 1);
  assert.match(result.errors[0], /already exists/);
});
