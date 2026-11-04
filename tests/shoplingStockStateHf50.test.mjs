import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF50 packages read-only login preflight as v0.6.15", async () => {
  const [route, background, page, planner] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf50/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v074.js", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  assert.match(route, /getHf49Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.14"/);
  assert.match(route, /const VERSION = "0\.6\.15"/);
  assert.match(route, /loginPreflightBeforeStarted: true/);
  assert.match(background, /No Shopling navigation, click, or write/);
  assert.match(background, /SHOPLING_LOGIN_REQUIRED_BEFORE_START/);
  assert.doesNotMatch(background, /chrome\.tabs\.update/);
  assert.doesNotMatch(background, /\.click\(/);
  assert.match(page, /download-hf63/);
  assert.match(page, /v0\.6\.26 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 26\]/);
});

test("both execution paths preflight before STARTED is recorded", async () => {
  const [queue, direct] = await Promise.all([
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
  ]);
  for (const source of [queue, direct]) {
    const preflight = source.indexOf("await requireShoplingAuthenticatedSession()");
    const started = source.indexOf('"STARTED"', preflight);
    assert.notEqual(preflight, -1);
    assert.ok(started > preflight);
  }
});
