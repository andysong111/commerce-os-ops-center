import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyFreightBundleUnitPreferences,
  findFreightBundleUnitPreference,
  isFreightBundleUnitEmpty,
  listFreightBundleUnitPreferences,
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
