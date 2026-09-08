import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF16 marks every SINGLE A21 assignment immutably instead of relying on mutable canonical stage", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf16/route.ts", "utf8");
  assert.match(route, /stockSingleBatch: true/);
  assert.match(route, /assignment\?\.stockSingleBatch === true \|\| \/\^SINGLE_/);
  assert.match(route, /mutableA21StageCanReclassifySingle: false/);
});

test("HF16 keeps missing requested goods keys advisory only for marked SINGLE batches while preserving returned-row safety", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf16/route.ts", "utf8");
  assert.match(route, /if \(missing\.length && !singleStockBatch\) return fail/);
  assert.match(route, /missingGoodsKeysIgnored: Boolean\(singleStockBatch && missing\.length\)/);
  assert.match(route, /EVERY_RETURNED_ROW_MUST_MATCH_A6_DERIVED_GOODSKEY/);
  assert.match(route, /A21_GOODSKEY_RESULT_MISSING_NOT_APPLIED_TO_MARKED_SINGLE_BATCH/);
});
