import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock control uses exact-identity reset-tail coverage before 360-day canonical fallback", async () => {
  const [tail, coverage, route, syncRoute] = await Promise.all([
    readFile("src/lib/inventoryStockSalesTail.ts", "utf8"),
    readFile("src/lib/inventoryStockSalesTailCoverage.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/route.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8"),
  ]);

  assert.match(tail, /INVENTORY_STOCK_SALES_TAIL_EVENT/);
  assert.match(tail, /overlayInventoryStockControlReportWithTail/);
  assert.match(tail, /salesCoverageReady: true/);
  assert.match(tail, /quantityOnHand = Math\.max\(0, quantityOnHand \+ point\.delta\)/);

  assert.match(coverage, /TAIL_CHUNK_DAYS = 7/);
  assert.match(coverage, /TAIL_MAX_WINDOW_DAYS = 31/);
  assert.match(coverage, /SHOPLING_STOCK_CANARY_PREPARATION/);
  assert.match(coverage, /A6_UNIQUENESS_CONFIRMED/);
  assert.match(coverage, /EXACT_ONE_ROW_CONFIRMED/);
  assert.match(coverage, /knownBarcodes/);
  assert.match(coverage, /TAIL_IDENTITY_REQUIRED/);
  assert.match(coverage, /splitShoplingDateRange/);
  assert.match(coverage, /client\.read\("orders", range\)/);
  assert.match(coverage, /a6MatchedShoplingOptionId/);
  assert.match(coverage, /a6MatchedShoplingProductId/);

  assert.match(route, /ensureExactInventoryStockSalesTailCoverage/);
  assert.match(route, /tailSalesRefresh\.refreshed/);
  assert.match(route, /latestCanonicalCoverageGapResetAt\(report\)/);
  assert.match(route, /ensureCanonicalSalesCoverageAfterReset/);

  assert.match(syncRoute, /ensureExactInventoryStockSalesTailCoverage/);
  assert.match(syncRoute, /overlayInventoryStockControlReportWithTail/);
  assert.match(syncRoute, /tailSalesRefresh/);
});

test("30-second operational queue GET stays read-only while real result POST may refresh Tail coverage", async () => {
  const syncRoute = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );
  const getSection = syncRoute
    .split("export async function GET")[1]
    .split("export async function POST")[0];
  const postSection = syncRoute.split("export async function POST")[1];

  assert.match(syncRoute, /refreshTail = false/);
  assert.match(getSection, /loadRetryableReport\(\)/);
  assert.doesNotMatch(getSection, /refreshTail:\s*true/);
  assert.match(postSection, /refreshTail:\s*true/);
  assert.match(
    syncRoute,
    /Polling must\s+remain read-only/,
  );
});

test("tail identity accepts both B+one-letter and B+two-letter barcode families but only promotes mapped codes", async () => {
  const coverage = await readFile(
    "src/lib/inventoryStockSalesTailCoverage.ts",
    "utf8",
  );
  assert.ok(
    coverage.includes("const BARCODE_PATTERN = /^B[A-Z]{1,2}\\d+-\\d+$/;"),
  );
  assert.match(coverage, /byOptionId/);
  assert.match(coverage, /byGoodsKey/);
  assert.match(coverage, /byBarcode/);
  assert.match(coverage, /unitsPerOrder/);
  assert.match(coverage, /index\.knownBarcodes\.has\(row\.barcode\)/);
  assert.match(coverage, /unmappedBarcodes/);
});

test("exact A6 preparation can recover a pending ledger row only with strict one-row evidence", async () => {
  const coverage = await readFile(
    "src/lib/inventoryStockSalesTailCoverage.ts",
    "utf8",
  );
  assert.match(
    coverage,
    /EXACT_PREPARATION_LEDGER_STATUSES = new Set\(\["SUCCEEDED", "PENDING"\]\)/,
  );
  assert.match(coverage, /\.in\("status", \[\.\.\.EXACT_PREPARATION_LEDGER_STATUSES\]\)/);
  assert.match(coverage, /truthy\(input\.preparationOnly\)/);
  assert.match(coverage, /A6_UNIQUENESS_CONFIRMED/);
  assert.match(coverage, /Number\(output\.a6SearchResultCount\) === 1/);
  assert.match(coverage, /EXACT_ONE_ROW_CONFIRMED/);
  assert.match(coverage, /if \(!optionIds\.length && !goodsKeys\.length\) return null/);
});

test("Shopling tail fetch uses KST calendar dates instead of UTC date slices", async () => {
  const coverage = await readFile(
    "src/lib/inventoryStockSalesTailCoverage.ts",
    "utf8",
  );
  assert.match(coverage, /SHOPLING_KST_OFFSET_MS = 9 \* 60 \* 60 \* 1000/);
  assert.match(
    coverage,
    /new Date\(parsed \+ SHOPLING_KST_OFFSET_MS\)\.toISOString\(\)\.slice\(0, 10\)/,
  );
  assert.match(coverage, /shoplingCalendarDate\(oldestResetAt\)/);
  assert.match(coverage, /shoplingCalendarDate\(nowIso\)/);
  assert.doesNotMatch(coverage, /nowIso\.slice\(0, 10\)/);
});

test("tail refuses success when a target managed Shopling order cannot be mapped", async () => {
  const coverage = await readFile(
    "src/lib/inventoryStockSalesTailCoverage.ts",
    "utf8",
  );
  assert.match(coverage, /ptn_goods_cd/);
  assert.match(coverage, /buying_cd/);
  assert.match(coverage, /mall_ptn_goods_cd/);
  assert.match(coverage, /mall_opt_cd/);
  assert.match(coverage, /potentialTargetManagedOrder/);
  assert.match(coverage, /managedUnmappedRows \+= 1/);
  assert.match(coverage, /if \(managedUnmappedRows > 0\)/);
  assert.match(coverage, /TAIL_MANAGED_ORDER_UNMAPPED/);
  assert.match(coverage, /refreshed: false/);
  assert.match(coverage, /exact-identity-tail-v2-kst-safe/);
});
