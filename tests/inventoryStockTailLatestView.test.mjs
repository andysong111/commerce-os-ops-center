import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

const resetAt = "2026-09-12T00:00:00.000Z";

function tailRow({
  resetEventId,
  barcode,
  analysisAsOf,
  matchedRows = 0,
}) {
  return {
    source_event_id: `tail:${resetEventId}:${analysisAsOf}`,
    result_snapshot: {
      snapshot: {
        resetEventId,
        barcode,
        resetAt,
        analysisAsOf,
        coverageStartAt: resetAt,
        coverageEndAt: analysisAsOf,
        planningContentFingerprint: "fixture",
        fetchedRows: 11,
        matchedRows,
        events: [],
      },
    },
    started_at: analysisAsOf,
    status: "SUCCEEDED",
  };
}

function loadTailModule({ rows = [], error = null } = {}) {
  const calls = {
    tables: [],
    selects: [],
    orders: [],
    limits: [],
  };

  const query = {
    select(columns) {
      calls.selects.push(columns);
      return this;
    },
    eq() {
      throw new Error("LATEST_TAIL_VIEW_MUST_NOT_RESCAN_LEGACY_LEDGER");
    },
    order(column, options) {
      calls.orders.push({ column, options });
      return this;
    },
    limit(value) {
      calls.limits.push(value);
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error, count: null }).then(resolve, reject);
    },
  };

  const module = load("src/lib/inventoryStockSalesTail.ts", {
    "@/lib/chinaOrderLedger": {
      CHINA_ORDER_EVENT_OPERATION_TYPE: "CHINA_ORDER_COMMITMENT_EVENT",
    },
    "@/lib/inventoryStockControl": {
      SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE: "SHOPLING_STOCK_STATUS_SYNC_EVENT",
      loadInventoryStockControlReport: async () => {
        throw new Error("UNUSED_IN_THIS_TEST");
      },
      storeInventoryOperation: async () => {
        throw new Error("UNEXPECTED_WRITE");
      },
    },
    "@/lib/productDecisionLiveRefresh": {
      loadProductPlanningSnapshot: async () => ({ products: [], contentFingerprint: "fixture" }),
    },
    "@/lib/shopling/shoplingNormalize": {
      normalizeShoplingOrder: () => ({}),
    },
    "@/lib/shopling/shoplingReadClient": {
      ShoplingReadClient: class {},
      shoplingReadConfigFromEnv: () => ({}),
      splitShoplingDateRange: () => [],
    },
    "@/lib/supabase/admin": {
      createSupabaseAdminClient: async () => ({
        from(table) {
          calls.tables.push(table);
          if (table === "commerce_operation_runs") {
            throw new Error("LEGACY_TAIL_LEDGER_SCAN_REGRESSION");
          }
          assert.equal(table, "commerce_inventory_latest_tail_snapshots");
          return query;
        },
      }),
    },
  });

  return { module, calls };
}

test("latest Tail loader reads the bounded latest-snapshot projection instead of the append-only Tail ledger", async () => {
  const rows = [
    tailRow({
      resetEventId: "reset-a",
      barcode: "BBB8-1",
      analysisAsOf: "2026-09-12T01:00:00.000Z",
      matchedRows: 1,
    }),
    tailRow({
      resetEventId: "reset-b",
      barcode: "BAB3-1",
      analysisAsOf: "2026-09-12T02:00:00.000Z",
    }),
  ];
  const { module, calls } = loadTailModule({ rows });

  const snapshots = await module.loadLatestInventoryStockSalesTailSnapshots();

  assert.deepEqual(calls.tables, ["commerce_inventory_latest_tail_snapshots"]);
  assert.deepEqual(calls.selects, [
    "source_event_id,result_snapshot,started_at,status",
  ]);
  assert.equal(calls.orders.length, 1);
  assert.equal(calls.orders[0].column, "started_at");
  assert.equal(calls.orders[0].options.ascending, true);
  assert.deepEqual(calls.limits, [10_000]);
  assert.equal(snapshots.size, 2);
  assert.equal(snapshots.get("reset-a")?.barcode, "BBB8-1");
  assert.equal(snapshots.get("reset-b")?.barcode, "BAB3-1");
});

test("latest Tail projection failure is fail-closed and never falls back to a full legacy ledger scan", async () => {
  const { module, calls } = loadTailModule({
    error: { message: "Supabase REST timeout after 5000ms" },
  });

  await assert.rejects(
    () => module.loadLatestInventoryStockSalesTailSnapshots(),
    /INVENTORY_STOCK_TAIL_LATEST_VIEW_READ_FAILED:Supabase REST timeout after 5000ms/,
  );
  assert.deepEqual(calls.tables, ["commerce_inventory_latest_tail_snapshots"]);
});

test("Tail projection normalizes analysisAsOf before winner selection, keeps the append-only ledger and restricts reads", () => {
  const initial = readFileSync(
    "supabase/migrations/202609130001_inventory_tail_latest_view.sql",
    "utf8",
  );
  const correction = readFileSync(
    "supabase/migrations/202609130002_inventory_tail_latest_normalized_time.sql",
    "utf8",
  );

  for (const migration of [initial, correction]) {
    assert.match(migration, /commerce_inventory_try_iso_timestamptz/);
    assert.match(migration, /returns timestamptz/i);
    assert.match(migration, /value::timestamptz/i);
    assert.match(migration, /exception when others[\s\S]*return null/i);
    assert.match(migration, /commerce_operation_runs_tail_reset_analysis_ts_idx/);
    assert.match(migration, /INVENTORY_STOCK_SALES_TAIL_EVENT/);
    assert.match(migration, /create or replace view public\.commerce_inventory_latest_tail_snapshots/i);
    assert.match(migration, /distinct on \(reset_event_id\)/i);
    assert.match(migration, /analysis_at desc[\s\S]*started_at desc/i);
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
    assert.match(migration, /grant select[\s\S]*to service_role/i);
    assert.doesNotMatch(migration, /delete\s+from\s+public\.commerce_operation_runs/i);
  }
});
