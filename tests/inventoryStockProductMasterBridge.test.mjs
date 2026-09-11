import assert from "node:assert/strict";
import test from "node:test";
import {
  at,
  loadPurchaseCycleModule as load,
  stockFixture,
} from "./helpers/purchaseCycleHarness.mjs";

const supplementalReset = {
  eventId: `product-master-sold-out-reset:BAB3-1:${at}`,
  barcode: "BAB3-1",
  productKind: "SINGLE",
  modelNo: "AAA231",
  occurredAt: at,
  note: "Product Master VERIFIED SOLD_OUT_RESET 기준점",
};

function loadRoute(calls) {
  return load("src/app/api/inventory-stock-control/sync/route.ts", {
    "@/lib/inventoryStockControl": {
      SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE: "SHOPLING_STOCK_STATUS_SYNC_EVENT",
      loadInventoryStockControlReport: async (options) => {
        calls.inventory.push(options);
        return stockFixture();
      },
      normalizeShoplingStockSyncInput: (input) => ({
        ...input,
        occurredAt: input.occurredAt || at,
        message: input.message || "fixture",
        evidence: input.evidence ?? null,
      }),
      storeInventoryOperation: async () => {
        calls.stores += 1;
        return { duplicate: false, rows: [] };
      },
    },
    "@/lib/inventoryStockResetCorrections": {
      overlayInventoryStockControlReportWithResetCorrections: async (value) => value,
    },
    "@/lib/inventoryStockSalesTail": {
      overlayInventoryStockControlReportWithTail: async (value) => value,
    },
    "@/lib/inventoryStockSalesTailCoverage": {
      ensureExactInventoryStockSalesTailCoverage: async () => ({
        ok: true,
        refreshed: false,
        reused: true,
        targetCount: 0,
        message: "fixture",
      }),
    },
    "@/lib/inventoryStockSyncResolution": {
      normalizeRetryableShoplingSyncReportWithEvidence: async (value) => value,
    },
    "@/lib/inventoryStocktakeBaselines": {
      overlayInventoryStockControlReportWithStocktakeBaselines: async (value) => value,
    },
    "@/lib/opsLoginBypass": {
      isSameOriginOpsRequest: () => true,
    },
    "@/lib/productMasterVerifiedInventoryBaselines": {
      loadProductMasterVerifiedZeroResetEvents: async () => {
        calls.productMaster += 1;
        return [supplementalReset];
      },
    },
    "@/lib/supabase/admin": {
      createSupabaseAdminClient: async () => null,
    },
  });
}

function assertSupplementalOptions(options) {
  assert.equal(options.supplementalResetEvents.length, 1);
  assert.equal(options.supplementalResetEvents[0].eventId, supplementalReset.eventId);
  assert.equal(options.supplementalResetEvents[0].barcode, "BAB3-1");
  assert.equal(options.supplementalResetEvents[0].productKind, "SINGLE");
  assert.equal(options.supplementalResetEvents[0].modelNo, "AAA231");
}

test("operational Shopling queue GET consumes the same Product Master zero-reset evidence as purchase-cycle status", async () => {
  const calls = { inventory: [], productMaster: 0, stores: 0 };
  const route = loadRoute(calls);
  const response = await route.GET(
    new Request("https://ops.example/api/inventory-stock-control/sync", {
      headers: { origin: "https://ops.example" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls.productMaster, 1);
  assert.equal(calls.inventory.length, 1);
  assertSupplementalOptions(calls.inventory[0]);
  assert.equal(calls.stores, 0);
});

test("operational Shopling result POST rebuilds the queue with Product Master zero-reset evidence after the state write", async () => {
  const calls = { inventory: [], productMaster: 0, stores: 0 };
  const route = loadRoute(calls);
  const response = await route.POST(
    new Request("https://ops.example/api/inventory-stock-control/sync", {
      method: "POST",
      headers: {
        origin: "https://ops.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        eventId: "fixture-event",
        jobId: "fixture-job",
        barcode: "BAB3-1",
        productKind: "SINGLE",
        modelNo: "AAA231",
        desiredStatus: "SOLD_OUT",
        outcome: "SUCCEEDED",
        occurredAt: at,
      }),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(calls.stores, 1);
  assert.equal(calls.productMaster, 1);
  assert.equal(calls.inventory.length, 1);
  assertSupplementalOptions(calls.inventory[0]);
});
