import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyFreightBundleUnitPreferences,
  FREIGHT_BUNDLE_UNIT_LEDGER_SKIPS_STORAGE_KEY,
  findFreightBundleUnitPreference,
  hasFreightBundleUnitLedgerReceipt,
  isFreightBundleUnitEmpty,
  listFreightBundleUnitLedgerReceipts,
  listFreightBundleUnitPreferences,
  reconcileFreightBundleUnitLedgerReceipts,
  saveFreightBundleUnitPreference,
} from "../src/lib/freightBundleUnitPreferences.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test("the newest bundle unit replaces the previous value for the same B-code", () => {
  const storage = memoryStorage();
  saveFreightBundleUnitPreference(" bce6-1 ", 10, storage, "2026-11-19T01:00:00.000Z");
  saveFreightBundleUnitPreference("BCE6-1", 25, storage, "2026-11-19T02:00:00.000Z");
  assert.deepEqual(listFreightBundleUnitPreferences(storage), [{ barcode: "BCE6-1", bundleUnit: 25, updatedAt: "2026-11-19T02:00:00.000Z" }]);
  assert.equal(findFreightBundleUnitPreference("bce6-1", storage)?.bundleUnit, 25);
});

test("saved B-code units apply to future manual or automatic imports", () => {
  const storage = memoryStorage();
  saveFreightBundleUnitPreference("BCE6-1", 25, storage);
  const items = applyFreightBundleUnitPreferences([
    { id: "1", rowNo: 1, itemName: "A", optionText: "", quantity: 100, barcode: "BCE6-1" },
    { id: "2", rowNo: 2, itemName: "B", optionText: "", quantity: 100, barcode: "BBF8-1" },
  ], listFreightBundleUnitPreferences(storage));
  assert.equal(items[0].bundleUnit, 25);
  assert.equal(items[1].bundleUnit, undefined);
});

test("the latest timestamp wins when local preferences and Product Master differ", () => {
  const base = {
    id: "1",
    rowNo: 1,
    itemName: "A",
    optionText: "",
    quantity: 100,
    barcode: "BCE6-1",
  };
  const remoteNewer = applyFreightBundleUnitPreferences(
    [{ ...base, bundleUnit: 20, bundleUnitUpdatedAt: "2026-11-19T03:00:00.000Z" }],
    [{ barcode: "BCE6-1", bundleUnit: 10, updatedAt: "2026-11-19T02:00:00.000Z" }],
  );
  assert.equal(remoteNewer[0].bundleUnit, 20);

  const localNewer = applyFreightBundleUnitPreferences(
    [{ ...base, bundleUnit: 20, bundleUnitUpdatedAt: "2026-11-19T03:00:00.000Z" }],
    [{ barcode: "BCE6-1", bundleUnit: 30, updatedAt: "2026-11-19T04:00:00.000Z" }],
  );
  assert.equal(localNewer[0].bundleUnit, 30);
  assert.equal(localNewer[0].bundleUnitUpdatedAt, "2026-11-19T04:00:00.000Z");
});

test("empty barcodes and non-positive units are not stored", () => {
  const storage = memoryStorage();
  assert.equal(saveFreightBundleUnitPreference("", 10, storage), undefined);
  assert.equal(saveFreightBundleUnitPreference("BCE6-1", 0, storage), undefined);
  assert.deepEqual(listFreightBundleUnitPreferences(storage), []);
});

test("only missing bundle units count as empty", () => {
  assert.equal(isFreightBundleUnitEmpty(undefined), true);
  assert.equal(isFreightBundleUnitEmpty(null), true);
  assert.equal(isFreightBundleUnitEmpty(0), false);
  assert.equal(isFreightBundleUnitEmpty(10), false);
});

test("bulk bundle unit action only fills rows whose bundle unit is empty", async () => {
  const pageSource = await readFile(
    new URL("../src/app/freight-barcode-request/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /function applyBulkBundleUnit\(\)/);
  assert.match(pageSource, /if \(!isFreightBundleUnitEmpty\(item\.bundleUnit\)\) return item;/);
  assert.match(pageSource, /onClick=\{applyBulkBundleUnit\}/);
  assert.doesNotMatch(pageSource, /applyBulkBundleUnit\("(?:all|with-barcode)"\)/);
  assert.doesNotMatch(pageSource, />전체 품목에 적용</);
  assert.doesNotMatch(pageSource, />바코드 입력된 품목에만 적용</);
});

test("opening the freight page migrates saved browser bundle units to Product Master", async () => {
  const pageSource = await readFile(
    new URL("../src/app/freight-barcode-request/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /for \(const preference of listFreightBundleUnitPreferences\(\)\)/);
  assert.match(pageSource, /listFreightBundleUnitLedgerReceipts\(\)/);
  assert.match(pageSource, /hasFreightBundleUnitLedgerReceipt\(/);
  assert.match(pageSource, /fetch\("\/api\/freight-bundle-units"/);
  assert.match(pageSource, /reconcileFreightBundleUnitLedgerReceipts\(/);
  assert.match(
    pageSource,
    /saveFreightBundleUnitPreference\([\s\S]*stored\.updatedAt,[\s\S]*\);/,
  );
});

test("stored and missing Product Master B-codes are retried only after their local value changes", () => {
  const storage = memoryStorage();
  const stored = saveFreightBundleUnitPreference(
    "BCE6-1",
    10,
    storage,
    "2026-11-19T03:00:00.000Z",
  );
  const missing = saveFreightBundleUnitPreference(
    "BAA3-1",
    20,
    storage,
    "2026-11-19T04:00:00.000Z",
  );
  reconcileFreightBundleUnitLedgerReceipts(
    [stored, missing],
    [{ barcode: "BCE6-1", updatedAt: stored.updatedAt }],
    ["BAA3-1"],
    storage,
  );
  assert.deepEqual(listFreightBundleUnitLedgerReceipts(storage), [
    {
      barcode: "BAA3-1",
      updatedAt: "2026-11-19T04:00:00.000Z",
      result: "BARCODE_NOT_FOUND",
    },
    {
      barcode: "BCE6-1",
      updatedAt: "2026-11-19T03:00:00.000Z",
      result: "STORED",
    },
  ]);
  assert.deepEqual(listFreightBundleUnitPreferences(storage), [missing, stored]);

  const changed = saveFreightBundleUnitPreference(
    "BAA3-1",
    25,
    storage,
    "2026-11-19T05:00:00.000Z",
  );
  const receipt = listFreightBundleUnitLedgerReceipts(storage).find(
    (value) => value.barcode === "BAA3-1",
  );
  assert.equal(
    hasFreightBundleUnitLedgerReceipt(
      listFreightBundleUnitLedgerReceipts(storage),
      "BAA3-1",
      missing.updatedAt,
    ),
    true,
  );
  assert.equal(
    hasFreightBundleUnitLedgerReceipt(
      listFreightBundleUnitLedgerReceipts(storage),
      "BCE6-1",
      "2026-11-19T02:00:00.000Z",
    ),
    true,
  );
  assert.equal(
    hasFreightBundleUnitLedgerReceipt(
      listFreightBundleUnitLedgerReceipts(storage),
      "BAA3-1",
      changed.updatedAt,
    ),
    false,
  );
  assert.notEqual(changed.updatedAt, receipt.updatedAt);
});

test("legacy missing-code skip markers migrate to ledger receipts", () => {
  const storage = memoryStorage();
  storage.setItem(FREIGHT_BUNDLE_UNIT_LEDGER_SKIPS_STORAGE_KEY, JSON.stringify([
    { barcode: " baa3-1 ", updatedAt: "2026-11-19T04:00:00.000Z" },
  ]));
  assert.deepEqual(listFreightBundleUnitLedgerReceipts(storage), [
    {
      barcode: "BAA3-1",
      updatedAt: "2026-11-19T04:00:00.000Z",
      result: "BARCODE_NOT_FOUND",
    },
  ]);
});
