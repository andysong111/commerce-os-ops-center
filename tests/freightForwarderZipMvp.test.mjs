import assert from "node:assert/strict";
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

function assertTextMatricesStayInsideLogicalLabel(pdf) {
  const matrices = [...pdf.matchAll(/BT \/F1 ([0-9.]+) Tf 1 0 0 1 ([0-9.]+) ([0-9.]+) Tm <([0-9a-f]+)> Tj ET/g)];
  assert.ok(matrices.length > 0);
  for (const [, sizeText, xText, yText, hex] of matrices) {
    const size = Number(sizeText);
    const x = Number(xText);
    const y = Number(yText);
    const charCount = hex.length / 4;
    const conservativeWidth = charCount * size;
    assert.ok(x >= 4, `text x ${x} should stay inside left inset`);
    assert.ok(x + Math.min(132, conservativeWidth) <= 143.001, `text should stay inside right inset: ${x} + ${conservativeWidth}`);
    assert.ok(y >= 4, `text y ${y} should stay inside bottom inset`);
    assert.ok(y + size <= 86.001, `text should stay inside top inset: ${y} + ${size}`);
  }
}

function assertNoTextOverlap(pdf) {
  const rows = [...pdf.matchAll(/BT \/F1 ([0-9.]+) Tf 1 0 0 1 [0-9.]+ ([0-9.]+) Tm </g)]
    .map((match) => ({ size: Number(match[1]), y: Number(match[2]) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    assert.ok(current.y - previous.y >= Math.min(previous.size, current.size) * 0.72, `text rows overlap near y=${previous.y} and y=${current.y}`);
  }
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

test("PDF rotates only the label content clockwise while preserving the page", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "BBA1-1"), 50));

  assert.match(pdf, /\/MediaBox \[0 0 90 147\]/);
  assert.equal(countPdfPages(pdf), 1);
  assert.match(pdf, /q\n0 -1 1 0 0 147 cm\n[\s\S]*004d00410044004500200049004e0020004300480049004e0041[\s\S]*0042004200410031002d0031[\s\S]*\nQ/);
  assert.doesNotMatch(pdf, /\/Rotate\b/);
});

test("printCount does not create repeated pages", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1), 100));
  assert.equal(countPdfPages(pdf), 1);
});

test("PDF embeds a Korean-capable Type0 font and keeps label fields", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "BBA1-1"), 50));
  assert.match(pdf, /\/Subtype \/Type0/);
  assert.match(pdf, /\/FontFile2/);
  assert.doesNotMatch(pdf, /\/BaseFont \/Helvetica/);
  assert.match(pdf, /004d00410044004500200049004e0020004300480049004e0041/);
  assert.match(pdf, /0042004200410031002d0031/);
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


test("matchedLabelText Korean text is encoded and long labels report wrapping", () => {
  const label = "재봉용 벨크로 블랙 너비 20mm 25M 1롤\n수입원:와일드사운드 제조원:와일드사운드협력사\n제조국:중국 내용량:단품 재질:폴리+나일론\n상품유형:벨크로테이프 사용기준:14세이상\n주의사항:용도 이외에 사용하지 마세요";
  const result = buildFreightForwarderMvpZip({ applicationNo: "634993", items: [item(1, "S0030616878361", 50, { matchedLabelText: label })] });
  const pdf = pdfText(zipEntries(result)["634993/634993-1번 50개.pdf"]);

  assert.match(pdf, /c7ac/);
  assert.match(pdf, /\/FontFile2/);
  assert.doesNotMatch(pdf, /\/Rotate\b/);
  assert.match(result.statusMessage, /라벨 문구 자동 줄바꿈 발생/);
});

test("S0030616878361 barcode is drawn with Code128 Auto encoded bar count", () => {
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "S0030616878361"), 50));
  assert.match(pdf, /00530030003000330030003600310036003800370038003300360031/);
  assert.ok((pdf.match(/ re f/g) ?? []).length > 20);
});

test("long Korean PDF label keeps every text matrix inside the rotated label page", () => {
  const label = [
    "재봉용 벨크로 블랙 너비 20mm 25M 1롤 추가 긴 제품명 확인용",
    "수입원:와일드사운드 제조원:와일드사운드협력사 아주긴문구",
    "제조국:중국 내용량:단품 재질:폴리+나일론",
    "상품유형:벨크로테이프 사용기준:14세이상",
    "주의사항:용도 이외에 사용하지 마세요 어린이 손이 닿지 않는 곳 보관",
  ].join("\n");
  const pdf = pdfText(buildFreightForwarderMvpPdf(item(1, "S0030616878361", 50, { matchedLabelText: label }), 50));

  assertTextMatricesStayInsideLogicalLabel(pdf);
  assertNoTextOverlap(pdf);
});
