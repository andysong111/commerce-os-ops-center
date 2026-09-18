import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [recovery, cron] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesEventRecovery.ts", "utf8"),
  readFile("src/app/api/cron/product-master-shopling-sales-events/route.ts", "utf8"),
]);

test("supported tiers retry up to three times, while legacy 30-day requests shrink without wasting the tier", () => {
  assert.match(recovery, /SALES_EVENT_MAX_REQUEST_ATTEMPTS_PER_TIER = 3/);
  assert.match(recovery, /tierAttemptCount/);
  assert.match(recovery, /legacyOversizedRange/);
  assert.match(recovery, /attemptsInTier >= SALES_EVENT_MAX_REQUEST_ATTEMPTS_PER_TIER/);
  assert.match(recovery, /RETRY_SAME_TIER/);
  assert.match(recovery, /SHRINK_RANGE/);
});

test("request lineage preserves the same analysis instant while shrinking legacy 30 to 7 to 2 days", () => {
  assert.match(recovery, /SALES_EVENT_LEGACY_CHUNK_DAYS = 30/);
  assert.match(recovery, /SALES_EVENT_DEFAULT_CHUNK_DAYS = SALES_EVENT_SOURCE_RANGE_DAYS/);
  assert.match(recovery, /SALES_EVENT_FALLBACK_CHUNK_DAYS = 2/);
  assert.match(recovery, /SALES_EVENT_MINIMUM_CHUNK_DAYS = 2/);
  assert.match(recovery, /supersedesRequestId: latest\.requestId/);
  assert.match(recovery, /analysisAsOf: latest\.analysisAsOf/);
  assert.match(recovery, /splitShoplingDateRange/);
  assert.match(recovery, /MINIMUM_RANGE_EXHAUSTED/);
});

test("legacy failed request without chunkDays is safely interpreted as 30 days", () => {
  assert.match(recovery, /function normalizeChunkDays/);
  assert.match(recovery, /: SALES_EVENT_LEGACY_CHUNK_DAYS/);
  assert.match(recovery, /hasTerminalFailure\(latest\.requestId\)/);
});

test("same-tier retries can hydrate exact prior successful ranges instead of rereading them", () => {
  assert.match(recovery, /hydrateProductMasterShoplingSalesEventRecovery/);
  assert.match(recovery, /function exactReuseContext/);
  assert.match(recovery, /reusableParentChunks/);
  assert.match(recovery, /reusedFromRequestId/);
  assert.match(recovery, /sales-event-recovery-chunk:/);
  assert.match(recovery, /operation_type: SALES_EVENT_CHUNK/);
  assert.match(recovery, /result_snapshot: chunk\.resultSnapshot/);
});

test("cron can recover terminal Shopling reads but never runs Product Master canary or full", () => {
  assert.match(cron, /recoverProductMasterShoplingSalesEventRequest/);
  assert.match(cron, /hydrateProductMasterShoplingSalesEventRecovery/);
  assert.match(cron, /current\.state === "FAILED"/);
  assert.match(cron, /30일[\s\S]*7일/);
  assert.match(cron, /7일[\s\S]*2일/);
  assert.match(cron, /2일 Shopling 주문 조회도 반복 실패/);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents/);
});

test("recovery writes only durable request and chunk evidence rows", () => {
  assert.match(recovery, /operation_type: SALES_EVENT_REQUEST/);
  assert.match(recovery, /operation_type: SALES_EVENT_CHUNK/);
  assert.match(recovery, /source_event_id: `sales-event-recovery-request:/);
  assert.doesNotMatch(recovery, /sku_sales_events|barcode-ledgers|inventory_movements|sku_receipt_costs|1688/i);
});
