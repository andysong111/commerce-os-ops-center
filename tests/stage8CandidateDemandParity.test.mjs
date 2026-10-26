import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, api, page, salesSync] = await Promise.all([
  readFile("src/lib/stage8CandidateDemandParity.ts", "utf8"),
  readFile("src/app/api/stage8/candidate-demand-parity/route.ts", "utf8"),
  readFile("src/app/stage8-candidate-demand-parity/page.tsx", "utf8"),
  readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
]);

test("candidate parity rebuilds the frozen sales-event candidate before Product Master writes", () => {
  assert.match(engine, /SALES_EVENT_REQUEST/);
  assert.match(engine, /SALES_EVENT_CHUNK/);
  assert.match(engine, /SALES_EVENT_REPORT/);
  assert.match(engine, /combineProductMasterShoplingSalesEventChunks/);
  assert.match(engine, /candidateEventFingerprint/);
  assert.match(engine, /candidatePlanFingerprint/);
  assert.match(engine, /CANDIDATE_SALES_REPORT_REBUILD_MISMATCH/);
  assert.doesNotMatch(engine, /SALES_EVENT_CANARY|SALES_EVENT_FULL|applyProductMasterShoplingSalesEvents/);
  assert.match(engine, /identityResolverVersion !== PRODUCT_MASTER_SALES_IDENTITY_RESOLVER_VERSION/);
});

test("purchase preparation can read the immutable candidate pin without rebuilding 52 chunks", () => {
  const start = engine.indexOf("export async function loadLatestCandidateSalesPin");
  const end = engine.indexOf("export async function loadLatestCandidateSalesSnapshot", start);
  assert.ok(start >= 0 && end > start);
  const pinLoader = engine.slice(start, end);
  assert.match(pinLoader, /loadLatestCandidateSalesIdentity/);
  assert.match(pinLoader, /eventFingerprint: report\.eventFingerprint/);
  assert.match(pinLoader, /planFingerprint: report\.planFingerprint/);
  assert.doesNotMatch(pinLoader, /SALES_EVENT_CHUNK|combineProductMasterShoplingSalesEventChunks/);
});

test("exact candidate rebuild pages immutable chunk payloads instead of one oversized read", () => {
  assert.match(engine, /async function readSalesEventChunkOperations/);
  assert.match(engine, /const pageSize = 6/);
  assert.match(engine, /Promise\.all/);
  assert.match(engine, /\.select\("result_snapshot"\)/);
  assert.match(engine, /\.order\("source_event_id"/);
  assert.match(engine, /\.range\(from, Math\.min\(expectedRangeCount, from \+ pageSize\) - 1\)/);
  assert.match(engine, /readSalesEventChunkOperations\([\s\S]*request\.ranges\.length/);
});

test("candidate demand uses actual event timestamps in exact 12 by 30-day buckets", () => {
  assert.match(engine, /const BUCKET_DAYS = 30/);
  assert.match(engine, /const BUCKET_COUNT = 12/);
  assert.match(engine, /const age = end - timestamp/);
  assert.match(engine, /Math\.floor\(age \/ \(BUCKET_DAYS \* DAY_MS\)\)/);
  assert.match(engine, /event\.validSale/);
  assert.match(engine, /row\.monthlyUnits\[bucket\]/);
  assert.match(engine, /row\.monthlyRevenue\[bucket\]/);
});

test("same-time Shopling comparison is durable, read-only, and fingerprint pinned", () => {
  assert.match(engine, /splitShoplingDateRange\([\s\S]*RANGE_DAYS/);
  assert.match(engine, /new ShoplingReadClient/);
  assert.match(engine, /aggregateShoplingOrderChunk/);
  assert.match(engine, /request\.analysisAsOf/);
  assert.match(engine, /verifiedCandidate/);
  assert.match(engine, /CANDIDATE_DEMAND_PARITY_CANDIDATE_CHANGED/);
  assert.match(engine, /commerce_operation_runs/);
  assert.doesNotMatch(engine, /inventory_movements|sku_receipt_costs|1688|price change|purchase order/i);
});

test("candidate parity blocks promotion on any unresolved SKU-array difference", () => {
  assert.match(engine, /unitMismatchCount/);
  assert.match(engine, /revenueMismatchCount/);
  assert.match(engine, /missingDirectBarcodes/);
  assert.match(engine, /directOnlyManagedBarcodes/);
  assert.match(engine, /const blockerCount =[\s\S]*unitMismatchCount[\s\S]*revenueMismatchCount/);
  assert.match(page, /Product Master에 canary\/full 적재하지 않습니다/);
});

test("same-origin API can only start or advance the read-only pre-write gate", () => {
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /export const maxDuration = 300/);
  assert.match(api, /run-next/);
  assert.match(api, /createCandidateDemandParityRequest/);
  assert.doesNotMatch(api, /canary|full|applyProductMasterShoplingSalesEvents/i);
});

test("existing sales-event write gate remains explicit canary then full", () => {
  assert.match(salesSync, /mode: "canary" \| "full"/);
  assert.match(salesSync, /SALES_EVENT_CANARY_REQUIRED/);
  assert.match(salesSync, /expectedPlanFingerprint/);
});
