import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock control uses recent reset-tail sales coverage before 360-day canonical fallback", async () => {
  const [tail, route, syncRoute] = await Promise.all([
    readFile("src/lib/inventoryStockSalesTail.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/route.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8"),
  ]);

  assert.match(tail, /INVENTORY_STOCK_SALES_TAIL_EVENT/);
  assert.match(tail, /TAIL_CHUNK_DAYS = 7/);
  assert.match(tail, /TAIL_MAX_WINDOW_DAYS = 31/);
  assert.match(tail, /BARCODE_PATTERN = \/\^B\[A-Z\]\{1,2\}/);
  assert.match(tail, /splitShoplingDateRange/);
  assert.match(tail, /client\.read\("orders", range\)/);
  assert.match(tail, /overlayInventoryStockControlReportWithTail/);
  assert.match(tail, /salesCoverageReady: true/);
  assert.match(tail, /quantityOnHand = Math\.max\(0, quantityOnHand \+ point\.delta\)/);

  assert.match(route, /ensureInventoryStockSalesTailCoverage/);
  assert.match(route, /tailSalesRefresh\.refreshed/);
  assert.match(route, /latestCanonicalCoverageGapResetAt\(report\)/);
  assert.match(route, /ensureCanonicalSalesCoverageAfterReset/);

  assert.match(syncRoute, /ensureInventoryStockSalesTailCoverage/);
  assert.match(syncRoute, /overlayInventoryStockControlReportWithTail/);
  assert.match(syncRoute, /tailSalesRefresh/);
});

test("tail identity accepts BZ one-letter and BCC two-letter barcode families", async () => {
  const tail = await readFile("src/lib/inventoryStockSalesTail.ts", "utf8");
  assert.ok(tail.includes("const BARCODE_PATTERN = /^B[A-Z]{1,2}\\d+-\\d+$/;"));
  assert.match(tail, /byOptionId/);
  assert.match(tail, /byGoodsKey/);
  assert.match(tail, /unitsPerOrder/);
});
