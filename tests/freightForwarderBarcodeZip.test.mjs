import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { createFreightForwarderBarcodeZip } from "../src/lib/freightForwarderBarcodeZip.ts";

const application = {
  applicationNo: "642247",
  items: [
    { id: "3", rowNo: 3, itemName: "셋째", optionText: "颜色: 蓝色", quantity: 1, barcode: "CC-333", labelPrintCount: 9 },
    { id: "1", rowNo: 1, itemName: "첫째", optionText: "颜色: 红色", quantity: 1, barcode: "AA-111", labelPrintCount: 3 },
    { id: "2", rowNo: 2, itemName: "둘째", optionText: "颜色: 绿色", quantity: 1, barcode: "" },
    { id: "1b", rowNo: 1, itemName: "중복", optionText: "颜色: 黑色", quantity: 1, barcode: "BB-222" },
  ],
};

function decode(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

test("preserves ZIP folder, filename, sorting, Korean filenames, and exclusions", () => {
  const result = createFreightForwarderBarcodeZip(application);
  assert.equal(result.zipFilename, "642247.zip");
  assert.equal(result.folderName, "642247");
  assert.deepEqual(result.entries.map((entry) => entry.path), [
    "642247/642247-1번 3개.pdf",
    "642247/642247-3번 9개.pdf",
  ]);
  assert.deepEqual(result.excluded, [
    { rowNo: 1, reason: "duplicate-row-no" },
    { rowNo: 2, reason: "missing-barcode" },
  ]);

  const files = unzipSync(result.bytes);
  assert.deepEqual(Object.keys(files).sort(), result.entries.map((entry) => entry.path).sort());
});

test("printCount changes filename count but does not duplicate PDF pages", () => {
  const result = createFreightForwarderBarcodeZip(application);
  const pdf = decode(result.entries[0].pdf);

  assert.equal(result.entries[0].path, "642247/642247-1번 3개.pdf");
  assert.match(pdf, /\/Type \/Pages \/Kids \[4 0 R\] \/Count 1/);
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
});
