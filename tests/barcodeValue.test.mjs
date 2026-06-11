import assert from "node:assert/strict";
import test from "node:test";
import {
  BARCODE_ORIGIN_LABEL,
  getEncodedBarcodeValue,
  isValidBarcodeValue,
  sanitizeBarcodeValue,
} from "../src/lib/barcodeValue.ts";

test("uppercases lowercase barcode input without changing its symbols", () => {
  assert.equal(sanitizeBarcodeValue("bba1-3"), "BBA1-3");
});

test("accepts only uppercase letters, numbers, and hyphens", () => {
  assert.equal(isValidBarcodeValue("BBA1-3"), true);
  assert.equal(isValidBarcodeValue("BBA1 3"), false);
  assert.equal(isValidBarcodeValue("BBA1_3"), false);
});

test("passes only the sanitized barcode field value to the encoder", () => {
  const encodedValue = getEncodedBarcodeValue("bba1-3");

  assert.equal(encodedValue, "BBA1-3");
  assert.notEqual(encodedValue, BARCODE_ORIGIN_LABEL);
  assert.equal(getEncodedBarcodeValue(`${BARCODE_ORIGIN_LABEL} BBA1-3`), null);
});

test("does not produce an encoded value for empty or invalid input", () => {
  assert.equal(getEncodedBarcodeValue(), null);
  assert.equal(getEncodedBarcodeValue(""), null);
  assert.equal(getEncodedBarcodeValue("BBA1 3"), null);
});
