import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = process.cwd();
const sourcePath = path.join(root, "src", "lib", "internalChinaPurchaseDraftAutosave.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const testModule = { exports: {} };
vm.runInNewContext(transpiled, { module: testModule, exports: testModule.exports, Date, JSON, Object, Set, String, Number, Boolean });
const {
  clearPurchaseDraftPendingAutosave,
  purchaseDraftPendingAutosaveKey,
  readPurchaseDraftPendingAutosave,
  writePurchaseDraftPendingAutosave,
} = testModule.exports;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("pending stock and quantity changes survive a browser refresh", () => {
  const storage = memoryStorage();
  const draftId = "fast-purchase-draft:1234567890abcdef1234";
  writePurchaseDraftPendingAutosave(storage, draftId, {
    editedQuantities: { "BAF1-1": 190 },
    stagedExclusions: { "BBD4-3": true },
    releasedQuantityOverrides: {},
    stagedStockBands: { "BAF1-1": "LOW", "BBD4-2": "HIGH" },
    stagedAdditions: [{
      barcode: "BBC1-1",
      modelNo: "AAA001",
      productName: "자석 안경클립",
      optionName: "블랙",
      inDraft: false,
      currentDraftQuantity: 0,
      otherOpenQuantity: 0,
      targetQuantity: 10,
    }],
  }, new Date("2026-10-27T00:00:00.000Z"));

  const restored = readPurchaseDraftPendingAutosave(
    storage,
    draftId,
    Date.parse("2026-10-27T00:01:00.000Z"),
  );
  assert.equal(JSON.stringify(restored), JSON.stringify({
    editedQuantities: { "BAF1-1": 190 },
    stagedExclusions: { "BBD4-3": true },
    releasedQuantityOverrides: {},
    stagedStockBands: { "BAF1-1": "LOW", "BBD4-2": "HIGH" },
    stagedAdditions: [{
      barcode: "BBC1-1",
      modelNo: "AAA001",
      productName: "자석 안경클립",
      optionName: "블랙",
      inDraft: false,
      currentDraftQuantity: 0,
      otherOpenQuantity: 0,
      targetQuantity: 10,
    }],
  }));
});

test("successful recalculation can clear the pending autosave", () => {
  const storage = memoryStorage();
  const draftId = "fast-purchase-draft:1234567890abcdef1234";
  writePurchaseDraftPendingAutosave(storage, draftId, {
    editedQuantities: {},
    stagedExclusions: {},
    releasedQuantityOverrides: {},
    stagedStockBands: { "BAF1-1": "OUT" },
    stagedAdditions: [],
  });
  clearPurchaseDraftPendingAutosave(storage, draftId);
  assert.equal(storage.getItem(purchaseDraftPendingAutosaveKey(draftId)), null);
});

test("corrupt or expired autosaves are discarded", () => {
  const draftId = "fast-purchase-draft:1234567890abcdef1234";
  const corrupt = memoryStorage();
  corrupt.setItem(purchaseDraftPendingAutosaveKey(draftId), "not-json");
  assert.equal(readPurchaseDraftPendingAutosave(corrupt, draftId), null);

  const expired = memoryStorage();
  writePurchaseDraftPendingAutosave(expired, draftId, {
    editedQuantities: {},
    stagedExclusions: {},
    releasedQuantityOverrides: {},
    stagedStockBands: { "BAF1-1": "HIGH" },
    stagedAdditions: [],
  }, new Date("2026-09-01T00:00:00.000Z"));
  assert.equal(
    readPurchaseDraftPendingAutosave(expired, draftId, Date.parse("2026-10-27T00:00:00.000Z")),
    null,
  );
});
