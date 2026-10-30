import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  patchShoplingStockHf42OptionResultWatcher,
  SHOPLING_STOCK_HF42_OPTION_RESULT_WATCH_MS,
} from "../src/lib/shoplingStockHf42Patch.ts";

test("HF42 accepts the exact option footer despite stale transmitting headings", async () => {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v055.js",
    "utf8",
  );
  assert.match(legacy, /probe\.processing \|\| !probe\.expectedFooter/);

  const patched = patchShoplingStockHf42OptionResultWatcher(legacy);
  new Function(patched);
  assert.match(patched, /const staleProcessingSignal =/);
  assert.match(patched, /const processing = staleProcessingSignal && !expectedFooter/);

  const staleHeading = true;
  const exactTerminalFooter = true;
  const processing = staleHeading && !exactTerminalFooter;
  assert.equal(processing, false);
});

test("HF42 preserves the active option result and recovers it after service-worker reload without resend", async () => {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v055.js",
    "utf8",
  );
  const patched = patchShoplingStockHf42OptionResultWatcher(legacy);
  assert.match(patched, /const WAIT_LIMIT_MS_V055 = 30 \* 60_000/);
  assert.doesNotMatch(patched, /const WAIT_LIMIT_MS_V055 = 180_000/);
  assert.match(patched, /runDefinitiveWatcherV055\("serviceWorkerBoot"\)/);
  assert.match(patched, /continueNextGoodsKey\(latest, sender, evidence\)/);
  assert.doesNotMatch(patched, /serviceWorkerBoot[\s\S]{0,300}dispatchCurrent\(/);
  assert.equal(SHOPLING_STOCK_HF42_OPTION_RESULT_WATCH_MS, 30 * 60_000);
});

test("HF42 publishes v0.6.10 and blocks the live-failed HF41 package", async () => {
  const [route, page, planner, queue, hiddenBrowserCheck, workflow] =
    await Promise.all([
      readFile(
        "src/app/api/shopling-stock-state-sync/download-hf42/route.ts",
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
  assert.match(route, /getHf41Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.9"/);
  assert.match(route, /const VERSION = "0\.6\.10"/);
  assert.match(route, /HF42_OPTION_TERMINAL_FOOTER_PRECEDENCE/);
  assert.match(page, /download-hf49/);
  assert.match(page, /v0\.6\.14 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 14\]/);
  assert.match(queue, /v0\.6\.14로 업데이트/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.14'/);
  assert.match(workflow, /shoplingStockStateHf42\.test\.mjs/);
});
