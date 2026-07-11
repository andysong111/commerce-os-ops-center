import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFreightForwarderBarcodeLabelData,
  containsNonLatinPdfText,
  createFreightForwarderBarcodePdf,
  getSafePdfProductInfoLines,
} from "../src/lib/freightForwarderBarcodePdf.ts";

function decode(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

const item = {
  id: "item-1",
  rowNo: 2,
  itemName: "실리콘 杯 Holder",
  optionText: "颜色: 红色 / Size-L (2개)",
  quantity: 10,
  barcode: "AB-1234",
  origin: "MADE IN CHINA",
  matchedModelNo: "MD-01",
  matchedModelName: "Cup holder",
  matchedProductNameKo: "컵 홀더",
};

test("omits unsafe Korean/Chinese product text instead of writing corrupt Helvetica text", () => {
  const label = buildFreightForwarderBarcodeLabelData(item);
  assert.ok(label);
  assert.equal(containsNonLatinPdfText(item.itemName), true);
  assert.deepEqual(getSafePdfProductInfoLines(label), ["MODEL: MD-01", "SPEC: Cup holder"]);

  const pdf = decode(createFreightForwarderBarcodePdf(label));
  assert.match(pdf, /AB-1234/);
  assert.match(pdf, /MADE IN CHINA/);
  assert.doesNotMatch(pdf, /실리콘/);
  assert.doesNotMatch(pdf, /红色/);
  assert.doesNotMatch(pdf, /컵 홀더/);
  assert.doesNotMatch(pdf, /�/);
});

test("keeps small and large PDF MediaBox sizes", () => {
  const label = buildFreightForwarderBarcodeLabelData(item);
  const small = decode(createFreightForwarderBarcodePdf(label, { templateId: "small" }));
  const large = decode(createFreightForwarderBarcodePdf(label, { templateId: "large" }));

  assert.match(small, /\/MediaBox \[0 0 90 147\]/);
  assert.match(large, /\/MediaBox \[0 0 425\.25 255\]/);
});

test("creates one page per freight-forwarder PDF", () => {
  const label = buildFreightForwarderBarcodeLabelData(item);
  const pdf = decode(createFreightForwarderBarcodePdf(label));

  assert.match(pdf, /\/Type \/Pages \/Kids \[4 0 R\] \/Count 1/);
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
});
