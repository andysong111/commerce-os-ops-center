import assert from "node:assert/strict";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const at = "2026-09-10T02:26:46.254Z";

function row(snapshot) {
  return {
    source_event_id: `stored:${snapshot.eventId || "missing"}`,
    input_snapshot: snapshot,
    result_snapshot: {},
    started_at: at,
    status: "SUCCEEDED",
  };
}

function adminFor({ resets = [], stocktakes = [], errorType = null } = {}) {
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
          if (errorType === operationType) {
            return Promise.resolve({ data: null, error: { message: "fixture read failed" } });
          }
          return Promise.resolve({
            data: operationType === "INVENTORY_STOCKOUT_RESET_EVENT" ? resets : stocktakes,
            error: null,
          });
        },
      };
      return chain;
    },
  };
}

function service(admin) {
  return load("src/lib/purchaseCycleLocalBaselineAuthority.ts", {
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin },
  });
}

const validReset = {
  eventId: "reset-1",
  barcode: "BAB3-1",
  productKind: "SINGLE",
  modelNo: "AAA231",
  occurredAt: at,
};
const validStocktake = {
  eventId: "stocktake-1",
  barcode: "BBB8-1",
  productKind: "SINGLE",
  modelNo: "AAA339",
  baselineQuantity: 10,
  occurredAt: at,
};

test("complete local reset and stocktake authorities pass read-only preflight", async () => {
  const result = await service(adminFor({
    resets: [row(validReset)],
    stocktakes: [row(validStocktake)],
  })).assertPurchaseCycleLocalBaselineAuthorityReadable();
  assert.equal(result.resetCount, 1);
  assert.equal(result.stocktakeCount, 1);
});

test("malformed SUCCEEDED local reset cannot be reinterpreted as natural baseline absence", async () => {
  for (const patch of [
    { productKind: null },
    { barcode: "" },
    { occurredAt: "not-a-date" },
    { eventId: "", sourceEventMissing: true },
  ]) {
    const snapshot = { ...validReset, ...patch };
    const stored = row(snapshot);
    if (patch.sourceEventMissing) stored.source_event_id = "";
    await assert.rejects(
      service(adminFor({ resets: [stored] })).assertPurchaseCycleLocalBaselineAuthorityReadable(),
      /PURCHASE_CYCLE_LOCAL_RESET_INCOMPLETE/,
    );
  }
});

test("malformed SUCCEEDED stocktake cannot disappear from exact inventory authority", async () => {
  for (const patch of [
    { productKind: null },
    { baselineQuantity: 0 },
    { baselineQuantity: "10" },
    { baselineQuantity: null },
    { occurredAt: "invalid" },
  ]) {
    await assert.rejects(
      service(adminFor({ stocktakes: [row({ ...validStocktake, ...patch })] }))
        .assertPurchaseCycleLocalBaselineAuthorityReadable(),
      /PURCHASE_CYCLE_LOCAL_STOCKTAKE_INCOMPLETE/,
    );
  }
});

test("local baseline authority database read failure fails closed", async () => {
  await assert.rejects(
    service(adminFor({ errorType: "INVENTORY_STOCKOUT_RESET_EVENT" }))
      .assertPurchaseCycleLocalBaselineAuthorityReadable(),
    /PURCHASE_CYCLE_LOCAL_BASELINE_READ_FAILED:INVENTORY_STOCKOUT_RESET_EVENT/,
  );
});
