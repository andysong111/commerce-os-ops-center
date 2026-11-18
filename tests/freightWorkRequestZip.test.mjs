import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  buildFreightWorkRequestZip,
  buildJpegPagesPdf,
  groupFreightWorkRequestItems,
} from "../src/lib/freightWorkRequestZip.ts";

function item(applicationNo, rowNo) {
  return {
    id: `${applicationNo}-${rowNo}`,
    applicationNo,
    rowNo,
    itemName: `상품 ${rowNo}`,
    optionText: "옵션",
    quantity: 10,
    barcode: `BCA1-${rowNo}`,
  };
}

test("work-request rows are grouped and sorted by application number", () => {
  const groups = groupFreightWorkRequestItems({
    applicationNo: "673626, 673624",
    applicationNos: ["673626", "673624"],
    items: [item("673624", 2), item("673626", 1), item("673624", 1)],
  });

  assert.deepEqual(
    groups.map((group) => [
      group.applicationNo,
      group.items.map((row) => row.rowNo),
    ]),
    [
      ["673626", [1]],
      ["673624", [1, 2]],
    ],
  );
});

test("work-request ZIP keeps one PDF in each application-number folder", async () => {
  const encoder = new TextEncoder();
  const result = await buildFreightWorkRequestZip(
    {
      applicationNo: "673626, 673624",
      applicationNos: ["673626", "673624"],
      items: [item("673626", 1), item("673624", 1)],
    },
    "2026-11-19",
    async (group) =>
      encoder.encode(`%PDF-test ${group.applicationNo} ${group.items.length}`),
  );
  const entries = unzipSync(result.zipBytes);

  assert.equal(result.zipFilename, "작업요청서-673626_673624.zip");
  assert.deepEqual(result.applicationNos, ["673626", "673624"]);
  assert.equal(result.pdfCount, 2);
  assert.ok(Object.hasOwn(entries, "673626/"));
  assert.ok(Object.hasOwn(entries, "673624/"));
  assert.equal(
    new TextDecoder().decode(entries["673626/작업요청서-673626.pdf"]),
    "%PDF-test 673626 1",
  );
  assert.equal(
    new TextDecoder().decode(entries["673624/작업요청서-673624.pdf"]),
    "%PDF-test 673624 1",
  );
});

test("rasterized work-request PDF supports multiple A4 pages", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildJpegPagesPdf([
    { bytes: jpeg, width: 1240, height: 1754 },
    { bytes: jpeg, width: 1240, height: 1754 },
  ]);
  const text = Buffer.from(pdf).toString("latin1");

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Count 2/);
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.equal((text.match(/\/Filter \/DCTDecode/g) ?? []).length, 2);
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text, /xref[\s\S]*startxref/);
});

test("long helper areas are collapsed and the on-screen work-request preview is removed", async () => {
  const [pageSource, enhancerSource] = await Promise.all([
    readFile(
      new URL("../src/app/freight-barcode-request/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/FreightBarcodePrintEnhancer.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal((pageSource.match(/필요할 때 펼치기/g) ?? []).length, 2);
  assert.doesNotMatch(pageSource, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.doesNotMatch(pageSource, /<WorkRequestPreview/);
  assert.doesNotMatch(pageSource, /작업요청서 PDF 저장\/인쇄/);
  assert.match(pageSource, /작업요청서 PDF ZIP 다운로드/);
  assert.match(pageSource, /buildFreightWorkRequestZip\(application, createdDate\)/);
  assert.match(
    enhancerSource,
    /WORK_REQUEST_BUTTON_LABEL = "작업요청서 PDF ZIP 다운로드"/,
  );
  assert.doesNotMatch(enhancerSource, /prepareWorkRequestPrintTitle/);
});
