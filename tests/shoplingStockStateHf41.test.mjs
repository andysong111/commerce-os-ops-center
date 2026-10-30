import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  patchShoplingStockHf41ResultWatcher,
  SHOPLING_STOCK_HF41_RESULT_WATCH_MS,
} from "../src/lib/shoplingStockHf41Patch.ts";

const LIVE_BBB43_RESULT_DURATION_MS = 125_000;

test("HF41 keeps the SINGLE terminal-result watcher alive beyond the live BBB4-3 delay", async () => {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v066.js",
    "utf8",
  );
  assert.match(legacy, /const WAIT_MS = 95_000/);
  assert.ok(LIVE_BBB43_RESULT_DURATION_MS > 95_000);

  const patched = patchShoplingStockHf41ResultWatcher(legacy);
  new Function(patched);
  assert.match(patched, /const WAIT_MS = 30 \* 60_000/);
  assert.doesNotMatch(patched, /const WAIT_MS = 95_000/);
  assert.ok(SHOPLING_STOCK_HF41_RESULT_WATCH_MS > LIVE_BBB43_RESULT_DURATION_MS);
});

test("HF41 recovers an already-completed exact result tab without another Shopling submission", async () => {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v066.js",
    "utf8",
  );
  const patched = patchShoplingStockHf41ResultWatcher(legacy);
  assert.match(patched, /runWatcher\("serviceWorkerBoot", null\)/);
  assert.match(patched, /상품상태 변경 전송이 완료되었습니다/);
  assert.match(patched, /stableCompletionVerified: true/);
  assert.match(patched, /marketFailuresAdvisory/);
  assert.match(patched, /ACK\/advance first/);
  assert.doesNotMatch(patched, /dispatchCurrent\(/);
});

test("HF41 publishes v0.6.9 and blocks the live-failed HF40 package", async () => {
  const [route, page, planner, queue, hiddenBrowserCheck, workflow] =
    await Promise.all([
      readFile(
        "src/app/api/shopling-stock-state-sync/download-hf41/route.ts",
        "utf8",
      ),
      readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
      readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
      readFile(
        "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
        "utf8",
      ),
      readFile("scripts/inventory-ui-hidden-check.mjs", "utf8"),
      readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
    ]);
  assert.match(route, /getHf40Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.8"/);
  assert.match(route, /const VERSION = "0\.6\.9"/);
  assert.match(route, /HF41_LONG_SINGLE_RESULT_RECOVERY/);
  assert.match(page, /download-hf46/);
  assert.match(page, /v0\.6\.11 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 11\]/);
  assert.match(queue, /v0\.6\.11으로 업데이트/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.11'/);
  assert.match(workflow, /shoplingStockStateHf41\.test\.mjs/);
});
