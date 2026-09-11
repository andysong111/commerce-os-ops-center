import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const at = "2026-09-10T00:34:21.643Z";
const validReset = {
  source_event_id: "reset-1",
  input_snapshot: {
    eventId: "reset-1",
    barcode: "BAB3-1",
    productKind: "SINGLE",
    modelNo: "AAA231",
    occurredAt: at,
  },
  result_snapshot: {},
  started_at: at,
  status: "SUCCEEDED",
};
const validStocktake = {
  source_event_id: "stocktake-1",
  input_snapshot: {
    eventId: "stocktake-1",
    barcode: "BBB8-1",
    productKind: "SINGLE",
    modelNo: "AAA339",
    baselineQuantity: 10,
    occurredAt: at,
  },
  result_snapshot: {},
  started_at: at,
  status: "SUCCEEDED",
};

function adminWith(responses) {
  return {
    from(table) {
      assert.equal(table, "commerce_operation_runs");
      let operationType = "";
      const chain = {
        select() { return chain; },
        eq(field, value) {
          if (field === "operation_type") operationType = value;
          return chain;
        },
        order() { return chain; },
        limit() {
          const response = responses[operationType];
          return Promise.resolve(response ?? { data: [], error: null });
        },
      };
      return chain;
    },
  };
}

function inventoryService(admin) {
  return load("src/lib/inventoryStockControl.ts", {
    "@/lib/chinaOrderLedger": { CHINA_ORDER_EVENT_OPERATION_TYPE: "CHINA_ORDER_EVENT" },
    "@/lib/productDecisionLiveRefresh": {
      loadProductPlanningSnapshot: async () => ({ products: [] }),
    },
    "@/lib/stage8CanonicalSalesEventSnapshot": {
      loadStage8CanonicalSalesEventSnapshot: async () => ({
        state: "READY_READ_ONLY",
        coverageStartAt: "2026-09-01T00:00:00.000Z",
        coverageEndAt: "2026-09-12T00:00:00.000Z",
        events: [],
      }),
    },
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin },
  });
}

function stocktakeService(admin) {
  return load("src/lib/inventoryStocktakeBaselines.ts", {
    "@/lib/inventoryStockControl": {
      SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE: "SHOPLING_STOCK_STATUS_SYNC_EVENT",
    },
    "@/lib/productDecisionLiveRefresh": {
      loadProductPlanningSnapshot: async () => ({ products: [] }),
    },
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin },
  });
}

test("actual inventory reset consumer blocks on a null second-read payload", async () => {
  const service = inventoryService(adminWith({
    INVENTORY_STOCKOUT_RESET_EVENT: { data: null, error: null },
  }));
  const report = await service.loadInventoryStockControlReport();
  assert.equal(report.state, "BLOCKED");
  assert.ok(report.blockers.some((value) => String(value).includes("INVENTORY_STOCK_CONTROL_READ_FAILED:INVENTORY_STOCKOUT_RESET_EVENT:NON_ARRAY_DATA")));
});

test("actual inventory reset consumer blocks when a SUCCEEDED reset becomes malformed after preflight", async () => {
  const malformed = structuredClone(validReset);
  delete malformed.input_snapshot.productKind;
  const service = inventoryService(adminWith({
    INVENTORY_STOCKOUT_RESET_EVENT: { data: [malformed], error: null },
  }));
  const report = await service.loadInventoryStockControlReport();
  assert.equal(report.state, "BLOCKED");
  assert.ok(report.blockers.includes("INVENTORY_STOCKOUT_RESET_AUTHORITY_INCOMPLETE"));
  assert.equal(report.rows.length, 0);
});

test("actual stocktake consumer rejects null authority data instead of treating it as no baseline", async () => {
  const service = stocktakeService(adminWith({
    INVENTORY_STOCKTAKE_BASELINE_EVENT: { data: null, error: null },
  }));
  await assert.rejects(
    service.loadLatestInventoryStocktakeBaselines(),
    /INVENTORY_STOCKTAKE_READ_FAILED:INVENTORY_STOCKTAKE_BASELINE_EVENT:NON_ARRAY_DATA/,
  );
});

test("actual stocktake consumer rejects a malformed SUCCEEDED authority row", async () => {
  const malformed = structuredClone(validStocktake);
  malformed.input_snapshot.baselineQuantity = 0;
  const service = stocktakeService(adminWith({
    INVENTORY_STOCKTAKE_BASELINE_EVENT: { data: [malformed], error: null },
  }));
  await assert.rejects(
    service.loadLatestInventoryStocktakeBaselines(),
    /INVENTORY_STOCKTAKE_AUTHORITY_INCOMPLETE/,
  );
});
