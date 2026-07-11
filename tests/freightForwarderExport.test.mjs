import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";

import { buildFreightForwarderZipExport } from "../src/lib/freightForwarderExport.ts";

const application = {
  applicationNo: "642247",
  items: [{
    id: "item-1",
    rowNo: 1,
    itemName: "Poultry Drinker",
    optionText: "产品规格: 固定螺丝水碗",
    quantity: 300,
    hsCode: "3926909000",
    trackingNo: "YT123",
    orderNo: "3306760070065591852",
    barcode: "BAA1-1",
    memo: "10개씩 소분 후 바코드 부착",
  }],
};

test("builds a freight-forwarder zip with PDF-ready request HTML and summary files", () => {
  const result = buildFreightForwarderZipExport(application, "2026-07-11");
  assert.equal(result.filename, "freight-forwarder-642247-2026-07-11.zip");

  const entries = unzipSync(result.bytes);
  const paths = Object.keys(entries).sort();
  assert.deepEqual(paths, [
    "freight-forwarder-642247-2026-07-11/barcode-work-request.html",
    "freight-forwarder-642247-2026-07-11/forwarder-message.txt",
    "freight-forwarder-642247-2026-07-11/summary.json",
  ]);

  const html = strFromU8(entries["freight-forwarder-642247-2026-07-11/barcode-work-request.html"]);
  assert.match(html, /@page \{ size: A4; margin: 12mm; \}/);
  assert.match(html, /바코드 작업요청서/);
  assert.match(html, /BAA1-1/);
  assert.match(html, /30장/);

  const summary = JSON.parse(strFromU8(entries["freight-forwarder-642247-2026-07-11/summary.json"]));
  assert.equal(summary.applicationNo, "642247");
  assert.equal(summary.barcodeItemCount, 1);
  assert.equal(summary.items[0].labelPrintCount, 30);
});
