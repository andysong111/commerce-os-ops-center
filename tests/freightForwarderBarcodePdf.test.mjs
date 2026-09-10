import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  buildFreightForwarderBarcodePdfFilename,
  createFreightForwarderBarcodePdf,
  createFreightForwarderBarcodeZip,
} from "../src/lib/freightForwarderBarcodePdf.ts";

const cjkPattern = /[\u3131-\uD79D\u3400-\u9FFF]/;

const item = {
  id: "item-1",
  rowNo: 1,
  itemName: "한글 상품명 产品规格",
  optionText: "颜色: 银色",
  quantity: 12,
  barcode: "ABC-12345",
};

test("creates a one-page small PDF without unsafe non-Latin product text", () => {
  const pdfBytes = createFreightForwarderBarcodePdf(item, { size: "small" });
  const pdf = new TextDecoder().decode(pdfBytes);

  assert.match(pdf, /%PDF-1\.4/);
  assert.match(pdf, /\/MediaBox \[0 0 141\.732 85\.039\]/);
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.match(pdf, /MADE IN CHINA/);
  assert.match(pdf, /ABC-12345/);
  assert.doesNotMatch(pdf, cjkPattern);
  assert.doesNotMatch(pdf, /상품명|产品规格|颜色|银色/);
});

test("creates a one-page large PDF while keeping text ASCII-safe", () => {
  const pdf = new TextDecoder().decode(createFreightForwarderBarcodePdf(item, { size: "large" }));

  assert.match(pdf, /\/MediaBox \[0 0 283\.465 170\.079\]/);
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.doesNotMatch(pdf, cjkPattern);
});

test("creates one ZIP PDF per barcoded item with stable ASCII filenames", () => {
  const zipBytes = createFreightForwarderBarcodeZip([
    item,
    { ...item, id: "item-2", rowNo: 2, barcode: "XYZ-67890", itemName: "중국어 名称" },
    { ...item, id: "item-3", rowNo: 3, barcode: "" },
  ], { applicationNo: "신청-642247", size: "small" });
  const files = unzipSync(zipBytes);
  const names = Object.keys(files).sort();

  assert.deepEqual(names, ["642247_item-01_ABC-12345.pdf", "642247_item-02_XYZ-67890.pdf"]);
  for (const bytes of Object.values(files)) {
    const pdf = new TextDecoder().decode(bytes);
    assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
    assert.doesNotMatch(pdf, cjkPattern);
  }
});

test("filename builder removes non-ASCII text instead of placing it in PDF paths", () => {
  assert.equal(
    buildFreightForwarderBarcodePdfFilename({ rowNo: 7, barcode: "BAR 777" }, "신청번호 123"),
    "123_item-07_BAR-777.pdf",
  );
});
