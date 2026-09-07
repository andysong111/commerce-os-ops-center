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
  assert.match(coverage, /unitsPerOrder/);
  assert.match(coverage, /index\.knownBarcodes\.has\(row\.barcode\)/);
  assert.match(coverage, /unmappedBarcodes/);
});
