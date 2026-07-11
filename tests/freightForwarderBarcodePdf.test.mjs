import assert from "node:assert/strict";
import test from "node:test";
import {
  LARGE_FREIGHT_FORWARDER_LABEL_SIZE,
  SMALL_FREIGHT_FORWARDER_LABEL_SIZE,
  generateFreightForwarderLabelPdf,
  selectFreightForwarderLabelTemplate,
} from "../src/lib/freightForwarderBarcodePdf.ts";

function mediaBox(pdfBytes) {
  const text = new TextDecoder().decode(pdfBytes);
  const match = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(match, "MediaBox exists");
  return { width: Number(match[1]), height: Number(match[2]), pageCount: (text.match(/\/Type \/Page\b/g) ?? []).length };
}

const baseItem = { id: "1", rowNo: 1, itemName: "상품", optionText: "옵션", quantity: 10, barcode: "ABC-123", labelPrintCount: 50 };

test("small template PDF is exactly 90 x 147pt and has one page", () => {
  const box = mediaBox(generateFreightForwarderLabelPdf({ ...baseItem, labelTemplate: "small" }, "small"));
  assert.deepEqual(box, { ...SMALL_FREIGHT_FORWARDER_LABEL_SIZE, pageCount: 1 });
});

test("large template PDF uses normalized 425.25 x 255pt size and has one page", () => {
  const box = mediaBox(generateFreightForwarderLabelPdf({ ...baseItem, labelTemplate: "large" }, "large"));
  assert.deepEqual(box, { ...LARGE_FREIGHT_FORWARDER_LABEL_SIZE, pageCount: 1 });
});

test("auto template suggests large for tape keywords and small otherwise", () => {
  assert.equal(selectFreightForwarderLabelTemplate({ itemName: "스펀지테이프", optionText: "", labelTemplate: "auto" }, "auto"), "large");
  assert.equal(selectFreightForwarderLabelTemplate({ itemName: "Key Ring", optionText: "", labelTemplate: "auto" }, "auto"), "small");
});
