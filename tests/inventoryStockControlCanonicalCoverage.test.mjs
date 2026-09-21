import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock control self-heals canonical sales coverage gaps without waiting on stale analysis", async () => {
  const route = await readFile(
    "src/app/api/inventory-stock-control/route.ts",
    "utf8",
  );

  assert.match(route, /latestCanonicalCoverageGapResetAt/);
  assert.match(
    route,
    /\.filter\(\(row\) => !row\.salesCoverageReady && row\.manualStatusOnly !== true\)/,
  );
  const sync = await readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8");
  assert.match(route, /ensureProductMasterShoplingSalesEventCoverageRequest\(resetAt\)/);
  assert.match(sync, /ensureProductMasterShoplingSalesEventCoverageRequest[\s\S]*withSalesEventMutationGuard/);
  assert.match(sync, /createdAnalysisMs < resetMs/);
  assert.match(sync, /supersededStaleRequest: staleRequestWasActive/);
  assert.match(route, /previousRequestId/);
  assert.match(route, /canonicalSalesRefresh = coverageGapResetAt/);
  assert.match(route, /ensureCanonicalSalesCoverageAfterReset\(coverageGapResetAt\)/);
  assert.match(route, /WORKER_RUNNABLE_SALES_EVENT_STATES/);
  assert.doesNotMatch(
    route,
    /현재 작업을 우선 완료하고 새 범위가 필요합니다/,
  );
});
