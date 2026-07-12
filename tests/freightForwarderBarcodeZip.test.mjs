import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  buildFreightForwarderBarcodeZip,
  buildFreightForwarderPdfFileName,
  isWarehouseLocationLikeBarcode,
  validateFreightForwarderRows,
} from "../src/lib/freightForwarderBarcodeZip.ts";

const item = (rowNo, barcode, printCount = 50) => ({ id: String(rowNo), rowNo, itemName: `품목 ${rowNo}`, optionText: "옵션", quantity: 999, barcode, labelPrintCount: printCount });

test("ZIP folder and Korean filenames follow exact rule in numeric row order", () => {
  const result = buildFreightForwarderBarcodeZip({ applicationNo: "634993", items: [item(21, "ABC-21", 100), item(1, "ABC-1", 50), item(9, "ABC-9", 60)] });
  const files = unzipSync(result.zipBytes);
  assert.deepEqual(result.filenames, ["634993-1번 50개.pdf", "634993-9번 60개.pdf", "634993-21번 100개.pdf"]);
  assert.deepEqual(Object.keys(files).sort((a, b) => a.localeCompare(b, "ko")), [
    "634993/634993-1번 50개.pdf",
    "634993/634993-21번 100개.pdf",
    "634993/634993-9번 60개.pdf",
  ].sort((a, b) => a.localeCompare(b, "ko")));
  assert.equal(result.zipFileName, "634993.zip");
  assert.equal(result.folderName, "634993");
});

test("print count does not repeat PDF pages", () => {
  const result = buildFreightForwarderBarcodeZip({ applicationNo: "634993", items: [item(1, "ABC-1", 200)] });
  const files = unzipSync(result.zipBytes);
  const pdfText = new TextDecoder().decode(files["634993/634993-1번 200개.pdf"]);
  assert.equal((pdfText.match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test("missing barcode and duplicate rowNo are excluded", () => {
  const validation = validateFreightForwarderRows([item(1, "ABC-1"), item(2, ""), item(1, "ABC-DUP")]);
  assert.equal(validation.valid.length, 1);
  assert.deepEqual(validation.exclusions, [{ rowNo: 1, reason: "중복 순번" }, { rowNo: 2, reason: "바코드 값 없음" }]);
});

test("filename normalization removes freight center suffix and extra whitespace", () => {
  assert.equal(buildFreightForwarderPdfFileName("634993  ", 7, 20), "634993-7번 20개.pdf");
});

test("warehouse-location-like barcode patterns are detected", () => {
  assert.equal(isWarehouseLocationLikeBarcode("BAA1-1"), true);
  assert.equal(isWarehouseLocationLikeBarcode("C01-01"), true);
  assert.equal(isWarehouseLocationLikeBarcode("8801234567890"), false);
});
