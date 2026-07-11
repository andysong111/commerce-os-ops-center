import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import {
  buildFreightBarcodePdfFilename,
  buildFreightBarcodePdfZip,
  createFreightBarcodeItemPdf,
  LARGE_BARCODE_LABEL_SIZE_PT,
  SMALL_BARCODE_LABEL_SIZE_PT,
} from "../src/lib/freightBarcodePdfZip.ts";

const item = {
  id: "item-1",
  rowNo: 1,
  itemName: "Poultry Drinker 급수기",
  optionText: "颜色: 银色",
  quantity: 5,
  barcode: "BAA1-1",
  labelPrintCount: 2,
};

test("keeps PR #196 Korean filename rule", () => {
  assert.equal(
    buildFreightBarcodePdfFilename({ applicationNo: "642247", rowNo: 1, printCount: 2 }),
    "642247-1번 2개.pdf",
  );
});

test("keeps barcode PDF MediaBox size and omits non-Latin body text", () => {
  assert.deepEqual(SMALL_BARCODE_LABEL_SIZE_PT, { width: 90, height: 147 });
  assert.deepEqual(LARGE_BARCODE_LABEL_SIZE_PT, { width: 425.25, height: 255 });

  const pdf = new TextDecoder().decode(createFreightBarcodeItemPdf(item));
  assert.match(pdf, /\/MediaBox \[0 0 425\.25 255\]/);
  assert.match(pdf, /\(MADE IN CHINA\) Tj/);
  assert.match(pdf, /\(BAA1-1\) Tj/);
  assert.doesNotMatch(pdf, /급수기|颜色|银色/);
});

test("ZIP preserves Korean folder and PDF file names", () => {
  const zip = buildFreightBarcodePdfZip({ applicationNo: "신청서642247", items: [item] });
  const files = unzipSync(zip);
  assert.ok(files["신청서642247/신청서642247-1번 2개.pdf"]);
});
