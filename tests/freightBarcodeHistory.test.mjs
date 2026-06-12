import assert from "node:assert/strict";
import test from "node:test";
import {
  FREIGHT_BARCODE_HISTORY_STORAGE_KEY,
  buildFreightBarcodeHistoryRecordFromCurrentState,
  deleteFreightBarcodeHistory,
  listFreightBarcodeHistory,
  loadFreightBarcodeHistory,
  saveFreightBarcodeHistory,
} from "../src/lib/freightBarcodeHistory.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function buildRecord({ id, updatedAt, applicationNo = "642247" }) {
  return buildFreightBarcodeHistoryRecordFromCurrentState({
    id,
    applicationNo,
    rawText: `신청번호:${applicationNo}`,
    items: [
      {
        id: `${id}-item`,
        rowNo: 1,
        itemName: "Key Ring",
        optionText: "Gold",
        quantity: 200,
        locationCode: "BAA1-1",
        memo: "개별 부착",
        selectedImageCandidateUrl: "https://example.com/key-ring.jpg",
        matchedModelNo: "AAA270",
      },
    ],
    now: updatedAt,
  });
}

test("saves and lists freight barcode history records", () => {
  const storage = new MemoryStorage();
  const record = buildRecord({ id: "record-1", updatedAt: "2026-06-10T10:00:00.000Z" });

  saveFreightBarcodeHistory(record, storage);

  assert.deepEqual(listFreightBarcodeHistory(storage), [record]);
  assert.equal(listFreightBarcodeHistory(storage)[0].items[0].locationCode, "BAA1-1");
});

test("sorts records by newest updatedAt first", () => {
  const storage = new MemoryStorage();
  const older = buildRecord({ id: "older", updatedAt: "2026-06-09T10:00:00.000Z" });
  const newer = buildRecord({ id: "newer", updatedAt: "2026-06-11T10:00:00.000Z" });

  saveFreightBarcodeHistory(older, storage);
  saveFreightBarcodeHistory(newer, storage);

  assert.deepEqual(
    listFreightBarcodeHistory(storage).map((record) => record.id),
    ["newer", "older"],
  );
});

test("returns an empty list for invalid JSON", () => {
  const storage = new MemoryStorage();
  storage.setItem(FREIGHT_BARCODE_HISTORY_STORAGE_KEY, "{invalid-json");

  assert.deepEqual(listFreightBarcodeHistory(storage), []);
});

test("loads a record by id", () => {
  const storage = new MemoryStorage();
  const record = buildRecord({ id: "record-1", updatedAt: "2026-06-10T10:00:00.000Z" });
  saveFreightBarcodeHistory(record, storage);

  assert.deepEqual(loadFreightBarcodeHistory("record-1", storage), record);
  assert.equal(loadFreightBarcodeHistory("missing", storage), undefined);
});

test("deletes a record by id", () => {
  const storage = new MemoryStorage();
  saveFreightBarcodeHistory(
    buildRecord({ id: "record-1", updatedAt: "2026-06-10T10:00:00.000Z" }),
    storage,
  );
  saveFreightBarcodeHistory(
    buildRecord({ id: "record-2", updatedAt: "2026-06-11T10:00:00.000Z" }),
    storage,
  );

  deleteFreightBarcodeHistory("record-2", storage);

  assert.deepEqual(
    listFreightBarcodeHistory(storage).map((record) => record.id),
    ["record-1"],
  );
});

test("preserves the version field", () => {
  const storage = new MemoryStorage();
  const record = buildRecord({ id: "record-1", updatedAt: "2026-06-10T10:00:00.000Z" });
  saveFreightBarcodeHistory(record, storage);

  assert.equal(loadFreightBarcodeHistory("record-1", storage)?.version, 1);
});


test("restores legacy local history records without removing the browser workflow", () => {
  const storage = new MemoryStorage();
  storage.setItem(FREIGHT_BARCODE_HISTORY_STORAGE_KEY, JSON.stringify([{
    id: "legacy-record",
    applicationNo: "642247",
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    rawText: "신청번호:642247",
    items: [{
      id: "legacy-item",
      rowNo: 1,
      itemName: "Legacy Key Ring",
      optionText: "Gold",
      quantity: 200,
      matchedModelNo: "AAA270",
    }],
    version: 1,
  }]));

  const record = loadFreightBarcodeHistory("legacy-record", storage);
  assert.equal(record?.parsedItems[0].itemName, "Legacy Key Ring");
  assert.equal(record?.itemCount, 1);
  assert.equal(record?.matchedItemCount, 1);
  assert.equal(record?.pdfVersion, 1);
});

test("saved local history contains enough data to restore the PDF request", () => {
  const record = buildRecord({
    id: "restore-record",
    updatedAt: "2026-06-10T10:00:00.000Z",
  });

  assert.equal(record.rawText, "신청번호:642247");
  assert.equal(record.applicationNo, "642247");
  assert.equal(record.parsedItems[0].locationCode, "BAA1-1");
  assert.equal(record.productMasterMatches[0].matchedModelNo, "AAA270");
});
