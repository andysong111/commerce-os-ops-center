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
  assert.match(page, /download-hf69/);
  assert.match(page, /v0\.6\.32 다운로드/);

  for (const source of [direct, queue]) {
    assert.doesNotMatch(source, /batch\.stopAfterBatch = true/);
    assert.match(source, /maxConcurrentLanes: (prepared|batch\.jobs)\.length/);
  }
});

test("HF62 replacement policy isolates a BCG5-2 failure and still attempts BCG5-3", async () => {
  const direct = await readFile(
    "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
    "utf8",
  );
  const operational = await readFile(
    "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
    "utf8",
  );
  assert.doesNotMatch(direct, /batch\.stopAfterBatch = true/);
  assert.match(direct, /실패 건만 기록하고 나머지 B코드 전송을 계속합니다/);
  assert.doesNotMatch(operational, /batch\.stopAfterBatch = true/);
  assert.match(operational, /해당 건만 예외로 남기고 다음 B코드 전송을 계속합니다/);
  assert.match(operational, /excludedThisRun\.current\.add\(job\.jobId\)/);
});
