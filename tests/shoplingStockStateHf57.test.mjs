import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF57 completes Commerce OS responsibility at exact Shopling result navigation", async () => {
  const [background, route, direct, queue, page] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v079.js", "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download-hf57/route.ts", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
  ]);

  assert.match(background, /SHOPLING_DISPATCH_ACCEPTED_HF57/);
  assert.match(background, /shoplingDispatchAccepted: true/);
  assert.match(background, /commerceOsResponsibilityComplete: true/);
  assert.match(background, /marketplaceCompletionRequired: false/);
  assert.match(background, /finalOptionBatchSubmitted/);
  assert.match(background, /const ACK_DELAY_MS = 25/);
  assert.match(route, /const VERSION = "0\.6\.20"/);
  assert.match(route, /SHOPLING_RESULT_NAVIGATION_ACCEPTED/);
  assert.match(page, /download-hf57/);
  assert.match(page, /v0\.6\.20 다운로드/);

  for (const source of [direct, queue]) {
    assert.match(source, /stopAfterBatch/);
    assert.match(source, /이후 B코드 자동배정을 중지/);
    assert.match(source, /maxConcurrentLanes: (prepared|batch\.jobs)\.length/);
  }
});

test("HF57 regression: BCG5-2 failure stops BCG5-3 instead of burning the rest of the queue", async () => {
  const direct = await readFile(
    "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
    "utf8",
  );
  const operational = await readFile(
    "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
    "utf8",
  );
  assert.match(direct, /result\.outcome !== "SUCCEEDED"[\s\S]{0,120}batch\.stopAfterBatch = true/);
  assert.match(direct, /if \(batch\.stopAfterBatch\)[\s\S]{0,300}directQueue\.current = \[\]/);
  assert.match(operational, /result\.outcome !== "SUCCEEDED"[\s\S]{0,180}continueAfterBatch\.current = false/);
  assert.match(operational, /PAUSED_ON_FAILURE/);
});
