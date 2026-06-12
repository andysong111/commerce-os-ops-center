import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  InMemoryFreightBarcodeHistoryStorage,
  createInMemoryFreightBarcodeHistoryStorage,
} from "../src/lib/freightBarcodeHistoryStore.ts";
import {
  getFreightBarcodeHistoryStorage,
} from "../src/lib/freightBarcodeHistoryStorage.ts";

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

let storage;

beforeEach(() => {
  storage = createInMemoryFreightBarcodeHistoryStorage();
  delete process.env.FREIGHT_BARCODE_HISTORY_STORAGE;
});

test("creates a server history record with regeneration data and match summary", async () => {
  const record = await storage.create(requestInput);

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

test("lists and gets detached server history records", async () => {
  const created = await storage.create(requestInput);
  const listed = await storage.list();

  assert.equal(listed.length, 1);
  assert.deepEqual(await storage.get(created.id), created);

  listed[0].parsedItems[0].itemName = "Changed outside store";
  assert.equal(
    (await storage.get(created.id))?.parsedItems[0].itemName,
    "Key Ring",
  );
});

test("updates only the server history title and memo", async () => {
  const created = await storage.create(requestInput);
  const updated = await storage.update(created.id, {
    title: " Updated title ",
    memo: " Updated memo ",
  });

  assert.equal(updated?.title, "Updated title");
  assert.equal(updated?.memo, "Updated memo");
  assert.deepEqual(updated?.parsedItems, created.parsedItems);
  assert.equal(updated?.rawText, created.rawText);
  assert.equal(updated?.createdAt, created.createdAt);
  assert.ok(updated.updatedAt >= created.updatedAt);
  assert.equal(await storage.update("missing", { title: "No record" }), undefined);
});

test("deletes a server history record", async () => {
  const created = await storage.create(requestInput);

  assert.equal(await storage.delete(created.id), true);
  assert.equal(await storage.get(created.id), undefined);
  assert.deepEqual(await storage.list(), []);
  assert.equal(await storage.delete(created.id), false);
});

test("default provider returns the process-local memory adapter", () => {
  const first = getFreightBarcodeHistoryStorage();
  const second = getFreightBarcodeHistoryStorage();

  assert.ok(first instanceof InMemoryFreightBarcodeHistoryStorage);
  assert.equal(second, first);
});

test("unsupported storage modes safely fall back to memory", () => {
  process.env.FREIGHT_BARCODE_HISTORY_STORAGE = "supabase";

  assert.ok(
    getFreightBarcodeHistoryStorage() instanceof InMemoryFreightBarcodeHistoryStorage,
  );
});
