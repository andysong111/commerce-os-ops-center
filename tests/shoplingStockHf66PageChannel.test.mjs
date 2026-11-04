import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF66 restores the exact HF27 page channel expected by the Commerce OS bridge", async () => {
  const [ops, bridge, route] = await Promise.all([
    readFile("public/shopling-stock-state-sync/content-ops-v023.js", "utf8"),
    readFile("src/components/china-order-manager/StockSyncHF15Bridge.tsx", "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download-hf66/route.ts", "utf8"),
  ]);

  for (const suffix of [
    "EXTENSION_READY_HF27",
    "EXTENSION_PING_HF27",
    "START_HF27",
    "RESULT_HF27",
    "PROGRESS_HF27",
    "STATUS_HF27",
  ]) {
    assert.match(ops, new RegExp(`COMMERCE_OS_SHOPLING_STOCK_SYNC_${suffix}`));
    assert.match(bridge, new RegExp(`COMMERCE_OS_SHOPLING_STOCK_SYNC_${suffix}`));
  }
  assert.match(ops, /stockSyncChannel: "HF27"/);
  assert.match(ops, /stockStateApiApplied: true/);
  assert.match(route, /const BASE_VERSION = "0\.6\.28"/);
  assert.match(route, /const VERSION = "0\.6\.29"/);
  assert.match(route, /HF65_REPLACED_HF27_TRANSFORMED_OPS_WITH_LEGACY_CHANNEL_SOURCE/);
});
