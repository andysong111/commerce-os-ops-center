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

function productMasterBaselineMock(calls) {
  return {
    loadProductMasterVerifiedZeroResetEvents: async () => {
      calls.productMaster += 1;
      return [supplementalReset];
    },
  };
}

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
    "@/lib/productMasterVerifiedInventoryBaselines": productMasterBaselineMock(calls),
    "@/lib/supabase/admin": {
      createSupabaseAdminClient: async () => null,
    },
  });
}

function overviewFixture(options) {
  const base = stockFixture();
  const resets = options?.supplementalResetEvents ?? [];
  const supplementalRows = resets.map((reset) => ({
    barcode: reset.barcode,
    productName: "Product Master fixture",
    optionName: null,
    modelNo: reset.modelNo,
    goodsKeys: ["14717973"],
    productKind: reset.productKind,
    resetAt: reset.occurredAt,
    resetEventId: reset.eventId,
    receivedSinceReset: 0,
    soldSinceReset: 0,
    exactInventoryQuantity: 0,
    recent30StockoutDays: 1,
    desiredStatus: "SOLD_OUT",
    desiredSince: reset.occurredAt,
    salesCoverageReady: false,
    receiptEvidenceCount: 0,
    salesEvidenceCount: 0,
    latestSyncOutcome: null,
    latestSyncAt: null,
    syncNeeded: true,
    syncBlocked: true,
    syncBlockReason: "Canonical coverage pending",
  }));
  return {
    ...base,
    resetCount: base.resetCount + supplementalRows.length,
    pendingSyncCount: 0,
    rows: [...base.rows, ...supplementalRows],
  };
}

function loadOverviewRoute(calls) {
  return load("src/app/api/inventory-stock-control/route.ts", {
    "@/lib/inventoryStockControl": {
      INVENTORY_STOCKOUT_RESET_OPERATION_TYPE: "INVENTORY_STOCKOUT_RESET_EVENT",
      loadInventoryStockControlReport: async (options) => {
        calls.inventory.push(options);
        return overviewFixture(options);
      },
      normalizeStockoutResetInput: (input) => input,
      storeInventoryOperation: async () => {
        calls.stores += 1;
        return { duplicate: false, rows: [] };
      },
    },
    "@/lib/inventoryStockResetCorrections": {
      overlayInventoryStockControlReportWithResetCorrections: async (value) => value,
    },
    "@/lib/inventoryStockResetIdentity": {
      validateInventoryStockoutResetIdentity: async (value) => value,
    },
    "@/lib/inventoryStockSalesTail": {
      overlayInventoryStockControlReportWithTail: async (value) => value,
    },
    "@/lib/inventoryStockSalesTailCoverage": {
      ensureExactInventoryStockSalesTailCoverage: async (report) => {
        calls.tailRefresh.push(report);
        return {
          ok: true,
          refreshed: false,
          reused: true,
          targetCount: 0,
          message: "fixture",
        };
      },
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
    "@/lib/opsAdaptiveDispatcher": {
      wakeOpsDispatchTask: async () => false,
    },
    "@/lib/productMasterShoplingSalesEventSync": {
      createProductMasterShoplingSalesEventSyncRequest: async () => ({
        requestId: "unused",
        analysisAsOf: at,
      }),
      loadProductMasterShoplingSalesEventSyncStatus: async () => ({
        state: "COMPLETED",
        requestId: "unused",
        analysisAsOf: at,
      }),
    },
    "@/lib/productMasterVerifiedInventoryBaselines": productMasterBaselineMock(calls),
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

test("overview refresh materializes Product Master zero-reset evidence into Tail coverage input", async () => {
  const calls = {
    inventory: [],
    productMaster: 0,
    stores: 0,
    tailRefresh: [],
  };
  const route = loadOverviewRoute(calls);
  const response = await route.GET(
    new Request("https://ops.example/api/inventory-stock-control", {
      headers: { origin: "https://ops.example" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls.productMaster, 1);
  assert.equal(calls.inventory.length, 1);
  assertSupplementalOptions(calls.inventory[0]);
  assert.equal(calls.tailRefresh.length, 1);
  const tailRow = calls.tailRefresh[0].rows.find(
    (row) => row.barcode === supplementalReset.barcode,
  );
  assert.ok(tailRow, "Product Master zero reset must reach Tail refresh input");
  assert.equal(tailRow.resetEventId, supplementalReset.eventId);
  assert.equal(tailRow.resetAt, supplementalReset.occurredAt);
  assert.equal(calls.stores, 0);
});
