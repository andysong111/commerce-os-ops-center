import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { patchShoplingStockHf46OptionBatch } from "../src/lib/shoplingStockHf46Patch.ts";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

test("HF46 waits for a fresh OPTION A21 worker and injects it at most once", async () => {
  const legacy = await readFile(
    "public/shopling-stock-state-sync/background-v071.js",
    "utf8",
  );
  assert.match(legacy, /await sleep\(140\)/);
  const patched = patchShoplingStockHf46OptionBatch(legacy);
  new Function(patched);
  const source = extractFunction(
    patched,
    "async function ensureCanonicalListWorkerV071(target)",
  );

  let probes = 0;
  let injections = 0;
  const chrome = {
    tabs: {
      sendMessage: async () => {
        probes += 1;
        return probes >= 4 ? { ok: true, role: "A21_LIST" } : null;
      },
    },
    scripting: {
      executeScript: async () => {
        injections += 1;
      },
    },
  };
  const factory = new Function(
    "chrome",
    "sleep",
    "CANONICAL_IDENTIFY_V071",
    "CANONICAL_LIST_SCRIPT_V071",
    `${source}; return ensureCanonicalListWorkerV071;`,
  );
  const ensureWorker = factory(chrome, async () => {}, "IDENTIFY", "worker.js");
  const ready = await ensureWorker({ tabId: 649, frameId: 0 });

  assert.equal(ready, true);
  assert.equal(probes, 4);
  assert.equal(injections, 1);
  assert.doesNotMatch(source, /sleep\(140\)/);
});

test("HF46 packages v0.6.11 and blocks BDE7-3 from using the live-failed v0.6.10 path", async () => {
  const [route, page, planner, queue, direct, hiddenBrowserCheck, workflow] =
    await Promise.all([
      readFile(
        "src/app/api/shopling-stock-state-sync/download-hf46/route.ts",
        "utf8",
      ),
      readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
      readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
      readFile(
        "src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx",
        "utf8",
      ),
      readFile(
        "src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx",
        "utf8",
      ),
      readFile("scripts/inventory-ui-hidden-check.mjs", "utf8"),
      readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
    ]);
  assert.match(route, /getHf42Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.10"/);
  assert.match(route, /const VERSION = "0\.6\.11"/);
  assert.match(route, /HF46_OPTION_A21_CANONICAL_WORKER_READY/);
  assert.match(route, /BDE7-3_OPTION_API_SUCCEEDED_THEN_FRESH_A21_WORKER_MISSED_AFTER_140MS/);
  assert.match(page, /download-hf47/);
  assert.match(page, /v0\.6\.12 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 12\]/);
  assert.match(queue, /v0\.6\.12로 업데이트/);
  assert.match(direct, /v0\.6\.12/);
  assert.match(hiddenBrowserCheck, /extensionVersion: '0\.6\.12'/);
  assert.match(workflow, /shoplingStockStateHf46\.test\.mjs/);
});
