import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSupportedLabelImage,
  buildTesseractArgs,
  createLabelObservationFromImage,
  recognizeLabelTrackingNumbers,
  resolveTesseractExecutable,
} from "../local-agent/src/shopling-label-ocr.mjs";

test("local OCR prefers an explicitly configured Tesseract binary", () => {
  const executable = resolveTesseractExecutable({ COMMERCE_OS_TESSERACT: "C:/ocr/tesseract.exe" }, (path) => path === "C:/ocr/tesseract.exe");
  assert.equal(executable, "C:/ocr/tesseract.exe");
});

test("local OCR accepts image files and rejects missing or unsupported inputs", () => {
  assert.match(assertSupportedLabelImage("C:/labels/photo.png", () => true), /photo\.png$/);
  assert.throws(() => assertSupportedLabelImage("C:/labels/photo.pdf", () => true), { code: "LABEL_IMAGE_FORMAT_UNSUPPORTED" });
  assert.throws(() => assertSupportedLabelImage("C:/labels/missing.png", () => false), { code: "LABEL_IMAGE_NOT_FOUND" });
});

test("Tesseract invocation is local, numeric-only and does not upload the image", () => {
  const args = buildTesseractArgs("C:/labels/photo.png", 11);
  assert.deepEqual(args.slice(1, 6), ["stdout", "-l", "eng", "--psm", "11"]);
  assert.ok(args.includes("tessedit_char_whitelist=0123456789- "));
  assert.equal(args.some((value) => /^https?:/i.test(value)), false);
});

test("orientation-aware OCR passes extract and deduplicate CJ tracking numbers", async () => {
  const calls = [];
  const result = await recognizeLabelTrackingNumbers("C:/labels/photo.png", {
    tesseractPath: "C:/ocr/tesseract.exe",
  }, {
    exists: () => true,
    execFile: async (executable, args) => {
      calls.push({ executable, args });
      return { stdout: calls.length === 1 ? "5876-2537-5225" : "587625375225" };
    },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(result.trackingCandidates, ["587625375225"]);
  assert.equal(result.engine, "LOCAL_TESSERACT");
});

test("photo observation keeps stockout review metadata with local OCR evidence", async () => {
  const observation = await createLabelObservationFromImage("C:/labels/photo.png", {
    reason: "STOCKOUT",
    stockoutBCodes: ["baf3-3"],
    expectedLabelCount: 1,
    tesseractPath: "C:/ocr/tesseract.exe",
  }, {
    exists: () => true,
    execFile: async () => ({ stdout: "5876 2537 5225" }),
  });
  assert.equal(observation.reason, "STOCKOUT");
  assert.deepEqual(observation.stockoutBCodes, ["baf3-3"]);
  assert.deepEqual(observation.trackingCandidates, ["587625375225"]);
  assert.equal(observation.ocrEngine, "LOCAL_TESSERACT");
});
