import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  buildFreightForwarderMvpFilename,
  buildFreightForwarderMvpPdf,
  buildFreightForwarderMvpZip,
  sortRowsByRowNo,
  validateFreightForwarderMvpRows,
} from "../src/lib/freightForwarderZipMvp.ts";

const item = (rowNo, barcode = `BBA1-${rowNo}`, printCount = 50, overrides = {}) => ({
  id: `item-${rowNo}-${barcode}`,
  rowNo,
  itemName: "Product name must not render",
  optionText: "옵션/中文 must not render",
  quantity: 100,
  barcode,
  labelPrintCount: printCount,
  ...overrides,
});

function pdfText(bytes) {
  return new TextDecoder().decode(bytes);
}

function zipEntries(result) {
  return unzipSync(result.zipBytes);
}

function countPdfPages(pdf) {
  return (pdf.match(/\/Type \/Page\b/g) ?? []).length;
}

function extractTextCommand(pdf, text) {
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = pdf.match(new RegExp(`BT /F1 (\\d+) Tf ([\\d.]+) ([\\d.]+) Td \\(${escapedText}\\) Tj ET`));
  assert.ok(match, `${text} text command should exist`);
  return { fontSize: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

test("ZIP filename is applicationNo.zip and folder is applicationNo/", () => {
  const result = buildFreightForwarderMvpZip({ applicationNo: "634993", items: [item(1)] });
  assert.equal(result.zipFilename, "634993.zip");
  assert.equal(result.folderName, "634993");
  assert.ok(Object.hasOwn(zipEntries(result), "634993/"));
});

test("PDF filename rule preserves Korean filename parts", () => {
  assert.equal(buildFreightForwarderMvpFilename("634993", 9, 60), "634993-9번 60개.pdf");
  const result = buildFreightForwarderMvpZip({ applicationNo: "634993", items: [item(9, "BBA1-9", 60)] });
  assert.ok(Object.hasOwn(zipEntries(result), "634993/634993-9번 60개.pdf"));
});


test("rows without manual labelPrintCount use calculated positive print count", () => {
  const result = validateFreightForwarderMvpRows([
    item(1, "BBA1-1", undefined, { quantity: 6 }),
    item(2, "BBA1-2", undefined, { quantity: 12, bundleUnit: 2 }),
  ]);

  assert.deepEqual(result.excludedRows, []);
  assert.deepEqual(result.validRows.map((row) => [row.rowNo, row.printCount]), [
    [1, 6],
    [2, 6],
  ]);
});

test("quantity 6 without manual labelPrintCount creates filename with 6개", () => {
  const result = buildFreightForwarderMvpZip({
    applicationNo: "649324",
    items: [item(1, "BBA1-1", undefined, { quantity: 6 })],
  });

  assert.deepEqual(result.validRows.map((row) => row.printCount), [6]);
  assert.ok(Object.hasOwn(zipEntries(result), "649324/649324-1번 6개.pdf"));
});

test("ZIP contains actual PDF files for calculated rows, not only folder", () => {
  const result = buildFreightForwarderMvpZip({
    applicationNo: "649324",
    items: [
      item(1, "BBA1-1", undefined, { quantity: 6 }),
      item(2, "BBA1-2", undefined, { quantity: 12, bundleUnit: 2 }),
    ],
  });
  const entries = zipEntries(result);
  const pdfNames = Object.keys(entries).filter((name) => name.endsWith(".pdf"));

  assert.deepEqual(pdfNames.sort(), [
    "649324/649324-1번 6개.pdf",
    "649324/649324-2번 6개.pdf",
  ]);
  for (const pdfName of pdfNames) {
    assert.match(pdfText(entries[pdfName]), /^%PDF-1\.4/);
  }
});

test("numeric row sorting works", () => {
  assert.deepEqual(sortRowsByRowNo([{ rowNo: 10 }, { rowNo: 2 }, { rowNo: 1 }, { rowNo: 11 }]).map((row) => row.rowNo), [1, 2, 10, 11]);
  const result = buildFreightForwarderMvpZip({ applicationNo: "634993", items: [item(10), item(2), item(1)] });
  assert.deepEqual(result.validRows.map((row) => row.rowNo), [1, 2, 10]);
});

test("each PDF has exactly one page and MediaBox is exactly 90 x 147pt", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1), 50));
  assert.equal(countPdfPages(pdf), 1);
  assert.match(pdf, /\/MediaBox \[0 0 90 147\]/);
});

test("PDF rotates enlarged label content clockwise while preserving the page", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "BAA1-1"), 50));

  assert.match(pdf, /\/MediaBox \[0 0 90 147\]/);
  assert.equal(countPdfPages(pdf), 1);
  assert.match(pdf, /q\n0 -1 1 0 -28 147 cm\n[\s\S]*BT \/F1 10 Tf [\d.]+ 107 Td \(MADE IN CHINA\)[\s\S]*BAA1-1[\s\S]*\nQ/);
  assert.doesNotMatch(pdf, /\/Rotate\b/);
});

test("barcode remains vector rectangles and uses sample-like logical bounds", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "BAA1-1"), 50));
  const barcodeBars = pdf.match(/[\d.]+ 41 [\d.]+ 29 re f/g) ?? [];

  assert.ok(barcodeBars.length >= 20);
});

test("barcode layout constants remain unchanged", () => {
  const source = readFileSync(new URL("../src/lib/freightForwarderZipMvp.ts", import.meta.url), "utf8");

  assert.match(source, /const barcodeX = 7;/);
  assert.match(source, /const barcodeY = 41;/);
  assert.match(source, /const barcodeWidth = 130;/);
  assert.match(source, /const barcodeHeight = 29;/);
});

test("origin and barcode value text use 10pt centered logical positions", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "BAA1-1"), 50));

  const origin = extractTextCommand(pdf, "MADE IN CHINA");
  const barcode = extractTextCommand(pdf, "BAA1-1");

  assert.deepEqual(origin, { fontSize: 10, x: 35.72, y: 107 });
  assert.deepEqual(barcode, { fontSize: 10, x: 56.27, y: 29 });
});

test("rotated text areas do not overlap barcode area", () => {
  const barcodePhysicalXStart = 41 - 28;
  const barcodePhysicalXEnd = barcodePhysicalXStart + 29;
  const barcodeValuePhysicalXEnd = 29 - 28 + 10;
  const originPhysicalXStart = 107 - 28;

  assert.equal(barcodePhysicalXStart, 13);
  assert.equal(barcodePhysicalXEnd, 42);
  assert.ok(barcodeValuePhysicalXEnd <= barcodePhysicalXStart - 2);
  assert.ok(originPhysicalXStart >= barcodePhysicalXEnd + 2);
});

test("printCount does not create repeated pages", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1), 100));
  assert.equal(countPdfPages(pdf), 1);
});

test("PDF body contains only origin label, barcode bars, and barcode value text", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "BBA1-1"), 50));
  assert.match(pdf, /MADE IN CHINA/);
  assert.match(pdf, /BBA1-1/);
  assert.doesNotMatch(pdf, /Product name must not render|옵션|中文/);
});

test("missing barcode row is excluded while valid rows still generate", () => {
  const result = buildFreightForwarderMvpZip({ applicationNo: "634993", items: [item(1), item(7, "", 50)] });
  assert.deepEqual(result.validRows.map((row) => row.rowNo), [1]);
  assert.deepEqual(result.excludedRows, [{ rowNo: 7, reason: "바코드 값 없음" }]);
  assert.ok(Object.hasOwn(zipEntries(result), "634993/634993-1번 50개.pdf"));
});

test("duplicate rowNo is excluded", () => {
  const result = validateFreightForwarderMvpRows([item(1), item(1, "BBA1-2", 60), item(2)]);
  assert.deepEqual(result.validRows.map((row) => row.rowNo), [2]);
  assert.deepEqual(result.excludedRows, [
    { rowNo: 1, reason: "중복 순번" },
    { rowNo: 1, reason: "중복 순번" },
  ]);
});
