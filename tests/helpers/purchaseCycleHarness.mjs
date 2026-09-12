import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const builtinRequire = createRequire(import.meta.url);
export function loadPurchaseCycleModule(path, imports = {}, globals = {}) {
  const exports = {};
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(output, {
    exports, Error, Date, Number, String, Object, Array, Map, Set, Promise,
    Request, Response, URL, URLSearchParams, AbortSignal, AbortController,
    encodeURIComponent, decodeURIComponent, structuredClone, JSON,
    process: { env: {} },
    fetch: async () => { throw new Error("UNMOCKED_NETWORK_FORBIDDEN"); },
    require: (name) => {
      if (Object.hasOwn(imports, name)) return imports[name];
      // Load the real read guard and unchanged handlers; never bypass their logic.
      if (name === "@/lib/inventoryStockReadGuard") {
        return loadPurchaseCycleModule("src/lib/inventoryStockReadGuard.ts", imports, globals);
      }
      if (name === "./handler" && /^src\/app\/api\/inventory-stock-control\/(sync\/)?route\.ts$/.test(path)) {
        return loadPurchaseCycleModule(join(dirname(path), "handler.ts"), imports, globals);
      }
      if (name === "@/lib/purchaseCycleLocalBaselineAuthority") {
        return { assertPurchaseCycleLocalBaselineAuthorityReadable: async () => ({ resetCount: 0, stocktakeCount: 0 }) };
      }
      if (name === "node:crypto") return builtinRequire(name);
      throw new Error(`UNMOCKED_IMPORT_FORBIDDEN:${name}`);
    }, ...globals,
  }, { filename: path });
  return exports;
}
export const receiptId = "12345678-1234-4567-89ab-123456789abc";
export const draftId = "fast-purchase-draft:1234567890abcdef1234";
export const barcode = "BBB8-1";
export const at = "2026-09-11T12:00:00.000Z";
export const receiptCost = {
  id: `china-receipt:${receiptId}:${barcode}`, receiptId, batchId: 202609, orderItemId: 1,
  barcode, modelNumber: "AAA123", optionName: "단품", quantity: 7, unitCostKrw: 430, receivedAt: at,
};
export function receiptOperation(cost = receiptCost) {
  return {
    input_snapshot: { sourceSystem: "fast-purchase-mvp", sourceRunId: draftId, barcode: cost.barcode, status: "RECEIVED", occurredAt: at, receivedQuantity: cost.quantity, payload: { receiptId, draftId, cycleMonth: "2026-09", receivedNow: cost.quantity } },
    result_snapshot: { receiptId, draftId, cycleMonth: "2026-09", barcode: cost.barcode, receivedNow: cost.quantity, cumulativeReceived: cost.quantity, followupVersion: 1, receiptLineCount: 1, receiptCost: cost }, started_at: at,
  };
}
export function costReadback(costs = [receiptCost]) {
  return { ok: true, receiptId, proof: "PERSISTED_RECEIPT_COST_ROWS_ONLY", rows: costs.map((cost) => ({ externalId: cost.id, barcode: cost.barcode, skuId: "stable-sku", quantity: cost.quantity, unitCostKrw: cost.unitCostKrw, receivedAt: cost.receivedAt })) };
}
export function stockFixture() {
  const row = { barcode, productName: "fixture", optionName: "단품", modelNo: "AAA123", goodsKeys: [], productKind: "OPTION", resetAt: at, resetEventId: "reset-1", receivedSinceReset: 7, soldSinceReset: 5, exactInventoryQuantity: 2, recent30StockoutDays: 0, desiredStatus: "ON_SALE", desiredSince: at, salesCoverageReady: true, receiptEvidenceCount: 1, salesEvidenceCount: 1, latestSyncOutcome: "SUCCEEDED", latestSyncAt: at, syncNeeded: false, syncBlocked: false, syncBlockReason: null };
  return { generatedAt: at, state: "READY", message: "fixture", fingerprint: "fixture", resetCount: 1, exactCount: 1, soldOutCount: 0, onSaleCount: 1, pendingSyncCount: 0, uncertainSyncCount: 0, rows: [row], blockers: [] };
}
