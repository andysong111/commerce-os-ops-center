import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadPurchaseCycleModule as load } from "./helpers/purchaseCycleHarness.mjs";

// Execute the actual inventory GET -> actual sales creator -> actual DB guard.
// Only external storage/transport/planning are fixtures; no production calls.
const now = "2026-09-15T00:00:00.000Z", oldTime = "2026-09-07T14:32:29.432Z";
const resetAt = "2026-09-14T10:00:00.000Z";
const oldId = "95c910a4-88ff-4c05-b181-9d57ab497bc0";
const fp = `sha256:${"a".repeat(64)}`, planningFp = `sha256:${"b".repeat(64)}`;
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}
function fixture(state = "READY_CANARY", options = {}) {
  const analysisAsOf = options.analysisAsOf ?? oldTime;
  const request = { requestId: oldId, analysisAsOf, analysisStartDate: "2025-09-12", analysisEndDate: "2026-09-07", planningGeneratedAt: oldTime, planningContentFingerprint: planningFp, ranges: [{ start: "2025-09-12", end: "2026-09-07" }], createdAt: oldTime };
  const rows = [];
  function add(suffix, result = {}, input = {}) {
    rows.push({ operation_type: `PRODUCT_MASTER_SHOPLING_SALES_EVENT_${suffix}`, source_event_id: `fixture-${suffix}`, correlation_id: `product-master-sales-events:${oldId}`, status: "SUCCEEDED", input_snapshot: input, result_snapshot: result, started_at: oldTime });
  }
  if (state !== "IDLE") add("REQUEST", {}, request);
  if (!["IDLE", "QUEUED", "RUNNING", "FAILED"].includes(state)) add("REPORT", { planFingerprint: fp, sourceEventCount: 1, unmappedRows: state === "BLOCKED" ? 1 : 0, identityConflictCount: 0 });
  if (state === "RUNNING") add("CHUNK", { events: [], range: request.ranges[0] }, { range: request.ranges[0] });
  if (state === "READY_FULL") add("CANARY", { verified: true });
  if (state === "COMPLETED") add("FULL", { verified: true });
  if (state === "FAILED") add("FAILED", { message: "fixture failure" });
  const historical = structuredClone(rows), writes = [], wakes = [], transports = [];
  let owner = null, clockReads = 0, wall = now;
  class FixtureClock extends Clock {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return Date.parse(wall); }
  }
  const admin = {
    async rpc(name, { p_token }) {
      if (name === "claim_sales_event_mutation_lock") {
        if (options.lockUnavailable) return { data: null, error: { message: "fixture unavailable" } };
        if (owner) return { data: false, error: null };
        owner = p_token; return { data: true, error: null };
      }
      assert.equal(name, "release_sales_event_mutation_lock");
      const released = owner === p_token; if (released) owner = null;
      return { data: released, error: null };
    },
    from(table) {
      assert.equal(table, "commerce_operation_runs");
      const filters = [];
      return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, order() { return this; },
        async limit(n) {
          if (options.readFails) return { data: null, error: { message: "fixture read failed" } };
          return { error: null, data: rows.filter((row) => filters.every(([k, v]) => row[k] === v)).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, n) };
        },
      };
    },
  };
  const globals = {
    Date: FixtureClock, crypto: { randomUUID }, console, setTimeout, clearTimeout,
    process: { env: { PRODUCT_MASTER_INTEGRATION_SECRET: "fixture-only", PRODUCT_MASTER_BASE_URL: "https://master.invalid", NEXT_PUBLIC_SUPABASE_URL: "https://db.invalid", SUPABASE_SECRET_KEY: "fixture-only" } },
    fetch: async (url, init = {}) => {
      transports.push([url, init.method ?? "GET"]);
      if (init.method === "POST") {
        assert.equal(new URL(url).hostname, "db.invalid");
        assert.ok(url.includes("/commerce_operation_runs?"));
        const batch = JSON.parse(init.body); assert.equal(batch.length, 1);
        assert.equal(batch[0].operation_type, "PRODUCT_MASTER_SHOPLING_SALES_EVENT_REQUEST");
        writes.push(batch[0]); if (!options.loseReadback) rows.push(batch[0]);
        return Response.json([{ id: randomUUID() }]);
      }
      assert.equal(new URL(url).hostname, "master.invalid");
      return state === "STORAGE_NOT_READY"
        ? Response.json({ error: "SKU_SALES_EVENTS_STORAGE_NOT_READY" }, { status: 503 })
        : Response.json({ ok: true });
    },
  };
  const policy = load("src/lib/salesEventRefreshPolicy.ts");
  const deps = {
    "@/lib/supabase/admin": { createSupabaseAdminClient: async () => admin, createSupabaseAdminHeaders: () => ({}) },
    "@/lib/salesEventRefreshPolicy": policy,
    "@/lib/productMasterShoplingSalesEventEngine": { PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS: 360 },
    "@/lib/productDecisionLiveRefresh": { loadProductPlanningSnapshot: async () => {
      clockReads++;
      if (options.clockRegresses) wall = oldTime;
      if (options.planningFails) throw new Error("fixture planning failed");
      return { generatedAt: now, contentFingerprint: planningFp };
    } },
    "@/lib/shopling/shoplingReadClient": { shoplingReadConfigFromEnv: () => { if (options.notConfigured) throw new Error("fixture config missing"); return {}; }, splitShoplingDateRange: (start, end) => [{ start, end }] },
  };
  const guard = load("src/lib/salesEventMutationGuard.ts", deps, globals);
  deps["@/lib/salesEventMutationGuard"] = guard;
  const sync = load("src/lib/productMasterShoplingSalesEventSync.ts", deps, globals);
  const report = { state: "READY", generatedAt: now, resetCount: 1, rows: [{ barcode: "BGF1-3", resetEventId: "fixture-reset", resetAt: options.resetAt ?? resetAt, salesCoverageReady: options.coverageReady ?? false }] };
  const same = async (value) => value;
  Object.assign(deps, {
    "@/lib/productMasterShoplingSalesEventSync": sync,
    "@/lib/inventoryStockControl": { loadInventoryStockControlReport: async () => structuredClone(report), storeInventoryOperation: async () => assert.fail("inventory mutation forbidden"), normalizeStockoutResetInput: () => assert.fail("inventory mutation forbidden") },
    "@/lib/inventoryStockResetCorrections": { overlayInventoryStockControlReportWithResetCorrections: same },
    "@/lib/inventoryStockResetIdentity": {},
    "@/lib/inventoryStockSalesTail": { overlayInventoryStockControlReportWithTail: same },
    "@/lib/inventoryStockSalesTailCoverage": { ensureExactInventoryStockSalesTailCoverage: async () => ({ refreshed: false, ok: false }) },
    "@/lib/inventoryStockSyncResolution": { normalizeRetryableShoplingSyncReportWithEvidence: same },
    "@/lib/inventoryStocktakeBaselines": { overlayInventoryStockControlReportWithStocktakeBaselines: same },
    "@/lib/productMasterVerifiedInventoryBaselines": { loadProductMasterVerifiedZeroResetEvents: async () => [] },
    "@/lib/opsLoginBypass": { isSameOriginOpsRequest: (req) => req.headers.get("origin") === "https://ops.invalid" },
    "@/lib/opsAdaptiveDispatcher": { wakeOpsDispatchTask: async (task, delay) => { wakes.push([task, delay]); if (options.wakeFails) throw new Error("fixture wake failed"); return true; } },
  });
  const route = load("src/app/api/inventory-stock-control/route.ts", deps, globals);
  const get = async () => (await route.GET(new Request("https://ops.invalid/api/inventory-stock-control", { headers: { origin: "https://ops.invalid" } }))).json();
  return { sync, guard, route, get, rows, writes, wakes, transports, historical, planningReads: () => clockReads };
}
for (const state of ["QUEUED", "RUNNING", "READY_CANARY", "READY_FULL", "STORAGE_NOT_READY"]) {
  test(`P1 real inventory caller replaces stale ${state} under the shared guard`, async () => {
    const f = fixture(state);
    assert.equal((await f.sync.loadProductMasterShoplingSalesEventSyncStatus()).state, state);
    const result = (await f.get()).canonicalSalesRefresh;
    assert.equal(result.accepted, true, JSON.stringify(result));
    assert.equal(result.supersededStaleRequest, true);
    assert.equal(result.previousRequestId, oldId);
    assert.notEqual(result.requestId, oldId);
    assert.equal(result.analysisAsOf, now);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.rows.slice(0, f.historical.length), f.historical);
    const stored = f.writes[0];
    assert.equal(stored.input_snapshot.refreshReason, "INVENTORY_RESET_COVERAGE");
    assert.equal(stored.input_snapshot.coverageResetAt, resetAt);
    assert.equal(stored.input_snapshot.refreshesRequestId, oldId);
    assert.equal(stored.input_snapshot.supersedesRequestId, undefined, "fresh time must not reuse recovery chunks");
    assert.equal(stored.result_snapshot.canonicalWritesEnabled, false);
    assert.equal(stored.result_snapshot.sourceWritesEnabled, false);
    const second = (await f.get()).canonicalSalesRefresh;
    assert.equal(second.accepted, false); assert.equal(second.alreadyCovered, true);
    assert.equal(second.requestId, result.requestId); assert.equal(f.writes.length, 1);
    assert.equal((await f.sync.loadProductMasterShoplingSalesEventSyncStatus()).canaryVerified, false);
  });
}
for (const state of ["QUEUED", "RUNNING", "READY_CANARY", "READY_FULL", "STORAGE_NOT_READY"]) {
  test(`ordinary creator still refuses active ${state} without an inventory gap`, async () => {
    const f = fixture(state);
    await assert.rejects(f.sync.createProductMasterShoplingSalesEventSyncRequest(), { code: "SALES_EVENT_REQUEST_ALREADY_ACTIVE" });
    assert.equal(f.writes.length, 0);
  });
}
for (const state of ["IDLE", "FAILED", "BLOCKED", "COMPLETED"]) {
  test(`inventory coverage starts a new analysis for stale ${state} without promoting it`, async () => {
    const f = fixture(state); const result = (await f.get()).canonicalSalesRefresh;
    assert.equal(result.accepted, true); assert.equal(result.supersededStaleRequest, false);
    assert.equal(result.previousRequestId, state === "IDLE" ? null : oldId);
    assert.equal(f.writes.length, 1); assert.equal(result.state, "QUEUED");
  });
}
test("equal or newer analysis is reused under the guard, including an in-flight collector", async () => {
  for (const state of ["QUEUED", "RUNNING", "READY_CANARY", "READY_FULL", "STORAGE_NOT_READY", "COMPLETED", "FAILED"]) {
    for (const time of [resetAt, now]) {
      const f = fixture(state, { analysisAsOf: time }); const result = (await f.get()).canonicalSalesRefresh;
      assert.equal(result.accepted, false); assert.equal(result.alreadyCovered, true);
      assert.equal(result.requestId, oldId); assert.equal(result.analysisAsOf, time);
      assert.equal(result.state, state); assert.equal(result.supersededStaleRequest, false);
      assert.equal(result.followupRequired, state === "FAILED");
      assert.equal(f.writes.length, 0); assert.equal(f.planningReads(), 0);
      assert.equal(f.wakes.length, ["QUEUED", "RUNNING"].includes(state) ? 1 : 0);
    }
  }
});
test("invalid and future reset times cannot append or advance an analysis timestamp", async () => {
  for (const invalid of ["", "not-a-time", null, 1, "2026-09-15T00:00:00.001Z"]) {
    const f = fixture();
    await assert.rejects(f.sync.ensureProductMasterShoplingSalesEventCoverageRequest(invalid), { code: "CANONICAL_SALES_REFRESH_RESET_AT_INVALID" });
    assert.equal(f.writes.length, 0); assert.equal(f.planningReads(), 0);
  }
});
test("twelve competing inventory refreshes share one lease and create only one request", async () => {
  const f = fixture("RUNNING");
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => f.sync.ensureProductMasterShoplingSalesEventCoverageRequest(resetAt)));
  const successes = results.filter((x) => x.status === "fulfilled");
  assert.equal(successes.length, 1); assert.equal(successes[0].value.accepted, true);
  for (const result of results.filter((x) => x.status === "rejected")) assert.equal(result.reason.code, "SALES_EVENT_MUTATION_BUSY");
  assert.equal(f.writes.length, 1);
  const replay = await f.sync.ensureProductMasterShoplingSalesEventCoverageRequest(resetAt);
  assert.equal(replay.accepted, false); assert.equal(replay.alreadyCovered, true); assert.equal(f.writes.length, 1);
});
test("inventory supersession cannot run while canonical publication holds the same guard", async () => {
  const f = fixture();
  let release, started;
  const ready = new Promise((r) => { started = r; }), wait = new Promise((r) => { release = r; });
  const publication = f.guard.withSalesEventMutationGuard(async () => { started(); await wait; });
  await ready;
  const result = (await f.get()).canonicalSalesRefresh;
  assert.equal(result.accepted, false); assert.equal(result.state, "REFRESH_QUEUE_FAILED");
  assert.equal(result.followupRequired, true); assert.equal(f.writes.length, 0);
  release(); await publication;
  assert.equal((await f.get()).canonicalSalesRefresh.accepted, true); assert.equal(f.writes.length, 1);
});
test("wake failure preserves durable acceptance; a repeat inventory read does not duplicate", async () => {
  const f = fixture("READY_CANARY", { wakeFails: true });
  const first = (await f.get()).canonicalSalesRefresh;
  assert.equal(first.accepted, true); assert.equal(first.wakeRequested, false); assert.equal(first.state, "QUEUED");
  const second = (await f.get()).canonicalSalesRefresh;
  assert.equal(second.accepted, false); assert.equal(second.requestId, first.requestId); assert.equal(f.writes.length, 1);
});
test("missing lock/config/planning/readback fails closed without treating the source as ready", async () => {
  for (const flags of [{ lockUnavailable: true }, { notConfigured: true }, { planningFails: true }, { readFails: true }, { loseReadback: true }]) {
    const f = fixture("QUEUED", flags); const result = (await f.get()).canonicalSalesRefresh;
    assert.equal(result.accepted, false); assert.equal(result.state, "REFRESH_QUEUE_FAILED");
    assert.equal(result.followupRequired, true); assert.equal(f.wakes.length, 0);
    assert.equal(f.writes.length, flags.loseReadback ? 1 : 0);
  }
});
test("verified inventory without a sales gap and unauthorized inventory reads cannot queue refresh", async () => {
  const healthy = fixture("READY_CANARY", { coverageReady: true });
  assert.equal((await healthy.get()).canonicalSalesRefresh, null); assert.equal(healthy.writes.length, 0);
  const denied = fixture();
  const response = await denied.route.GET(new Request("https://ops.invalid/api/inventory-stock-control"));
  assert.equal(response.status, 401); assert.equal(denied.writes.length, 0); assert.equal(denied.transports.length, 0);
});
test("inventory-only supersession is not exposed as an unconfirmed public sales action", () => {
  const source = readFileSync("src/app/api/product-master/shopling-sales-events/route.ts", "utf8");
  assert.doesNotMatch(source, /ensureProductMasterShoplingSalesEventCoverageRequest/);
  assert.doesNotMatch(source, /INVENTORY_RESET_COVERAGE/);
});

test("a clock regression during planning is rejected before request persistence", async () => {
  const f = fixture("READY_CANARY", { clockRegresses: true });
  const result = (await f.get()).canonicalSalesRefresh;
  assert.equal(result.accepted, false); assert.equal(result.state, "REFRESH_QUEUE_FAILED");
  assert.equal(f.writes.length, 0); assert.equal(f.wakes.length, 0);
});
