import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF18 treats fully terminal Shopling count blocks as SINGLE completion and auto-closes", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf18/route.ts", "utf8");
  assert.match(route, /HF18_SINGLE_RESULT_COUNTS_AUTOCLOSE_AND_MARKET_FAILURE_ADVISORY/);
  assert.match(route, /총건수/);
  assert.match(route, /성공건수/);
  assert.match(route, /실패건수/);
  assert.match(route, /total === successes\[index\] \+ failures\[index\]/);
  assert.match(route, /shoplingBatchComplete: true/);
  assert.match(route, /marketFailuresAdvisory/);
  assert.match(route, /explicitFailure: false/);
  assert.match(route, /continueNextGoodsKey\(latest, sender, completionEvidence\)/);
  assert.match(route, /singleResultAutoClose: true/);
});

test("HF18 preserves existing-row-only SINGLE scope and isolates the current page channel", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf18/route.ts", "utf8");
  const bridge = await readFile("src/components/china-order-manager/StockSyncHF15Bridge.tsx", "utf8");
  assert.match(route, /getHf17Download/);
  assert.match(route, /singleMissingRequestedGoodsKeys: "IGNORE_AS_DELETED_OR_STALE"/);
  assert.match(route, /singleA4Used: false/);
  assert.match(route, /optionFlow: "HF10_UNCHANGED"/);
  assert.match(route, /COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF18/);
  assert.match(bridge, /COMMERCE_OS_SHOPLING_STOCK_SYNC_START_HF18/);
  assert.doesNotMatch(bridge, /_HF17/);
});
