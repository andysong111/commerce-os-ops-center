import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearFreightBarcodeHistoryRecordsForTests,
  createFreightBarcodeHistoryRecord,
  deleteFreightBarcodeHistoryRecord,
  getFreightBarcodeHistoryRecord,
  listFreightBarcodeHistoryRecords,
  updateFreightBarcodeHistoryRecord,
} from "../src/lib/freightBarcodeHistoryStore.ts";

const requestInput = {
  applicationNo: "642247",
  title: "June freight labels",
  rawText: "신청번호:642247\n품목: Key Ring",
  memo: "Print after review",
  source: "manual-paste",
  items: [
    {
      id: "item-1",
      rowNo: 1,
      itemName: "Key Ring",
      optionText: "Gold",
      quantity: 200,
      locationCode: "BAA1-1",
      matchedModelNo: "AAA270",
      matchedModelName: "Key Ring Gold",
      matchedBarcode: "8800000000270",
      matchedOriginLabel: "CHINA",
      matchedLabelText: "KEY RING",
      matchedImageUrl: "https://example.com/key-ring.jpg",
    },
  ],
};

beforeEach(() => {
  clearFreightBarcodeHistoryRecordsForTests();
});

test("creates a server history record with regeneration data and match summary", () => {
  const record = createFreightBarcodeHistoryRecord(requestInput);

  assert.ok(record.id);
  assert.equal(record.applicationNo, "642247");
  assert.equal(record.rawText, requestInput.rawText);
  assert.deepEqual(record.parsedItems, requestInput.items);
  assert.equal(record.productMasterMatches[0].itemId, "item-1");
  assert.equal(record.productMasterMatches[0].matchedModelNo, "AAA270");
  assert.equal(record.itemCount, 1);
  assert.equal(record.matchedItemCount, 1);
  assert.equal(record.pdfVersion, 1);
  assert.equal(record.source, "manual-paste");
});

test("lists and gets detached server history records", () => {
  const created = createFreightBarcodeHistoryRecord(requestInput);
  const listed = listFreightBarcodeHistoryRecords();

  assert.equal(listed.length, 1);
  assert.deepEqual(getFreightBarcodeHistoryRecord(created.id), created);

  listed[0].parsedItems[0].itemName = "Changed outside store";
  assert.equal(
    getFreightBarcodeHistoryRecord(created.id)?.parsedItems[0].itemName,
    "Key Ring",
  );
});

test("updates only the server history title and memo", () => {
  const created = createFreightBarcodeHistoryRecord(requestInput);
  const updated = updateFreightBarcodeHistoryRecord(created.id, {
    title: "Updated title",
    memo: "Updated memo",
  });

  assert.equal(updated?.title, "Updated title");
  assert.equal(updated?.memo, "Updated memo");
  assert.deepEqual(updated?.parsedItems, created.parsedItems);
  assert.equal(updated?.rawText, created.rawText);
});

test("deletes a server history record", () => {
  const created = createFreightBarcodeHistoryRecord(requestInput);

  assert.equal(deleteFreightBarcodeHistoryRecord(created.id), true);
  assert.equal(getFreightBarcodeHistoryRecord(created.id), undefined);
  assert.deepEqual(listFreightBarcodeHistoryRecords(), []);
  assert.equal(deleteFreightBarcodeHistoryRecord(created.id), false);
});
