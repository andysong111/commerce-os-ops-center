import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  buildFreightForwarderBarcodeZip,
  createFreightForwarderBarcodePdf,
  FREIGHT_FORWARDER_BARCODE_TEMPLATES,
} from "../src/lib/freightForwarderBarcodeZip.ts";

const application = {
  applicationNo: "642247",
  items: [
    { id: "a", rowNo: 1, itemName: "한글 상품", optionText: "颜色", quantity: 300, barcode: "BAA1-1", labelPrintCount: 20 },
    { id: "b", rowNo: 2, itemName: "Missing", optionText: "", quantity: 1, barcode: "" },
  ],
};

test("buildFreightForwarderBarcodeZip keeps application number zip name and Korean zip paths", () => {
  const result = buildFreightForwarderBarcodeZip(application, "small");
  const entries = unzipSync(result.zipBytes);

  assert.equal(result.fileName, "642247.zip");
  assert.equal(result.includedItems.length, 1);
  assert.equal(result.excludedItems.length, 1);
  assert.ok(entries["642247/01행-BAA1-1.pdf"]);
  assert.ok(entries["642247/검증-제외-리포트.txt"]);
});

test("freight forwarder PDFs are one page regardless of print count", () => {
  const result = buildFreightForwarderBarcodeZip(application, "large");
  const pdf = new TextDecoder().decode(result.includedItems[0].pdfBytes);

  assert.match(pdf, /\/Type \/Pages \/Kids \[3 0 R\] \/Count 1/);
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test("freight forwarder PDF MediaBox follows selected template", () => {
  for (const template of FREIGHT_FORWARDER_BARCODE_TEMPLATES) {
    const pdfBytes = createFreightForwarderBarcodePdf({
      barcode: "BAA1-1",
      item: application.items[0],
      template,
    });
    const pdf = new TextDecoder().decode(pdfBytes);

    assert.match(pdf, new RegExp(`/MediaBox \\[0 0 ${template.widthPt} ${template.heightPt}\\]`));
  }
});
