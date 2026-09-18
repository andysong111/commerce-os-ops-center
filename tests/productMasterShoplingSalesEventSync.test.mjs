import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sync, recovery, route, cron, scheduler] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesEventRecovery.ts", "utf8"),
  readFile("src/app/api/product-master/shopling-sales-events/route.ts", "utf8"),
  readFile("src/app/api/cron/product-master-shopling-sales-events/route.ts", "utf8"),
  readFile("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql", "utf8"),
]);

test("360-day request pins one Product Master planning fingerprint and proven seven-day source ranges", () => {
  assert.match(sync, /const ANALYSIS_DAYS = PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS/);
  assert.match(sync, /SALES_EVENT_SOURCE_RANGE_DAYS = 7/);
  assert.match(sync, /analysisAsOf: asOf\.toISOString\(\)/);
  assert.match(sync, /chunkDays: SALES_EVENT_SOURCE_RANGE_DAYS/);
  assert.match(sync, /planningContentFingerprint: planning\.contentFingerprint/);
  assert.match(sync, /splitShoplingDateRange\([\s\S]*SALES_EVENT_SOURCE_RANGE_DAYS/);
  assert.match(sync, /SALES_EVENT_PLANNING_CHANGED/);
});

test("each source chunk applies the one pinned analysisAsOf instead of its fetch partition", () => {
  assert.match(sync, /aggregateProductMasterShoplingSalesEventChunk\([\s\S]*analysisAsOf: request\.analysisAsOf/);
  assert.doesNotMatch(sync, /aggregateProductMasterShoplingSalesEventChunk\([\s\S]*inDateRange/);
});

test("collection is read-only and business write waits for explicit canary/full", () => {
  assert.match(sync, /ShoplingReadClient/);
  assert.match(sync, /mode: "canary" \| "full"/);
  assert.match(sync, /SALES_EVENT_CANARY_REQUIRED/);
  assert.match(sync, /SALES_EVENT_PLAN_CHANGED/);
  assert.match(route, /confirmation/);
  assert.match(route, /CANARY/);
  assert.match(route, /FULL/);
});

test("explicit canary/full route has bounded time for persisted verification", () => {
  assert.match(route, /export const maxDuration = 300/);
});

test("Product Master storage migration gate is preserved before any event write", () => {
  const storageCheck = sync.indexOf("const storage = await productMasterSnapshot(request)");
  const eventPost = sync.indexOf("await postProductMasterEvents(batch)");
  assert.ok(storageCheck >= 0);
  assert.ok(eventPost > storageCheck);
  assert.match(sync, /storageReady: false/);
  assert.match(sync, /migration/);
});

test("Product Master responses are checked for persisted readback rows", () => {
  assert.match(sync, /payload\.verifiedRows/);
  assert.doesNotMatch(sync, /payload\.verifiedRows === undefined/);
  assert.match(sync, /verifiedRows === expected/);
  assert.match(sync, /SALES_EVENT_WRITE_VERIFY_FAILED/);
});

test("new reads start at 7 days, legacy 30-day failures shrink immediately, and 7 can fall back to 2", () => {
  assert.match(recovery, /SALES_EVENT_LEGACY_CHUNK_DAYS = 30/);
  assert.match(recovery, /SALES_EVENT_DEFAULT_CHUNK_DAYS = SALES_EVENT_SOURCE_RANGE_DAYS/);
  assert.match(recovery, /SALES_EVENT_FALLBACK_CHUNK_DAYS = 2/);
  assert.match(recovery, /SALES_EVENT_MINIMUM_CHUNK_DAYS = 2/);
  assert.match(recovery, /SALES_EVENT_MAX_REQUEST_ATTEMPTS_PER_TIER = 3/);
  assert.match(recovery, /legacyOversizedRange/);
  assert.match(recovery, /tierAttemptCount/);
  assert.match(recovery, /supersedesRequestId: latest\.requestId/);
  assert.match(recovery, /analysisAsOf: latest\.analysisAsOf/);
  assert.match(recovery, /MINIMUM_RANGE_EXHAUSTED/);
  assert.match(cron, /recoverProductMasterShoplingSalesEventRequest/);
  assert.match(cron, /current\.state === "FAILED"/);
  assert.match(cron, /30일[\s\S]*7일/);
  assert.match(cron, /7일[\s\S]*2일/);
});

test("same-tier retry reuses completed chunks only when the pinned source context is identical", () => {
  assert.match(recovery, /function exactReuseContext/);
  assert.match(recovery, /child\.chunkDays === parent\.chunkDays/);
  assert.match(recovery, /child\.analysisAsOf === parent\.analysisAsOf/);
  assert.match(recovery, /child\.analysisStartDate === parent\.analysisStartDate/);
  assert.match(recovery, /child\.analysisEndDate === parent\.analysisEndDate/);
  assert.match(recovery, /child\.planningContentFingerprint === parent\.planningContentFingerprint/);
  assert.match(recovery, /reusableParentChunks/);
  assert.match(recovery, /sales-event-recovery-chunk:/);
  assert.match(recovery, /reusedFromRequestId/);
  assert.match(recovery, /reusedChunkCount/);
  assert.match(cron, /hydrateProductMasterShoplingSalesEventRecovery/);
});

test("reused chunks remain operation-ledger evidence and never become a hidden business write", () => {
  assert.match(recovery, /operation_type: SALES_EVENT_CHUNK/);
  assert.match(recovery, /commerce_operation_runs/);
  assert.doesNotMatch(recovery, /sku_sales_events|inventory_movements|sku_receipt_costs|1688/i);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents/);
});

test("cron only collects or recovers requests and is an operational dispatcher task", () => {
  assert.match(cron, /runProductMasterShoplingSalesEventSyncStep/);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents/);
  assert.match(
    scheduler,
    /'product-master-shopling-sales-events', '\/api\/cron\/product-master-shopling-sales-events', 'operational', 130, true, 3600, 300, 21600/,
  );
});

test("full apply keeps Product Master writes in bounded verified batches", () => {
  assert.match(sync, /commerce-os-sales-events-v1|PRODUCT_MASTER_SALES_EVENT_FORMAT/);
  assert.match(sync, /shopling_orders_event_v1|PRODUCT_MASTER_SALES_EVENT_SOURCE/);
  assert.match(sync, /APPLY_BATCH_SIZE = 2_000/);
  assert.match(sync, /AbortSignal\.timeout\(120_000\)/);
  assert.doesNotMatch(sync, /1688|price change|Shopling write/i);
});
