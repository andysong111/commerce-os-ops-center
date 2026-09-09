import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF18 accepts terminal result counts, keeps market failures advisory, and auto-closes SINGLE result windows", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf18/route.ts", "utf8");
  assert.match(route, /HF18_SINGLE_RESULT_COUNTS_AUTOCLOSE_AND_MARKET_FAILURE_ADVISORY/);
  assert.match(route, /singleResultAutoClose: true/);
  assert.match(route, /perMarketFailures: "ADVISORY_NOT_BATCH_FAILURE"/);
  assert.match(route, /singleCompletionStabilityMs: 2500/);
  assert.match(route, /total === successes\[index\] \+ failures\[index\]/);
  assert.match(route, /const handled = await continueNextGoodsKey\(latest, sender, completionEvidence\)/);
  assert.match(route, /marketFailuresAdvisory/);
});

test("HF18 preserves no-A4 SINGLE flow and ON_SALE mapping from the dedicated popup worker", async () => {
  const hf17 = await readFile("public/shopling-stock-state-sync/content-stock-single-popup-v012.js", "utf8");
  const hf18 = await readFile("src/app/api/shopling-stock-state-sync/download-hf18/route.ts", "utf8");
  assert.match(hf18, /singleFlow: "A6_READ_ONLY_TO_A21_EXISTING_ROWS_ONLY"/);
  assert.match(hf18, /singleA4Used: false/);
  assert.match(hf17, /desiredStatus === "SOLD_OUT" \? "품절" : desiredStatus === "ON_SALE" \? "판매중"/);
  assert.match(hf17, /statusRadio\(targetLabel\)/);
});
