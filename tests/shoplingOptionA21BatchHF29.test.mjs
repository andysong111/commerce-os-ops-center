import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stockRoot = "public/shopling-stock-state-sync";
const canonicalPath = "public/shopling-a21-price-option-resend/content-a21.js";

test("HF29 batches OPTION A21 goods keys without changing pre-A21 API mutation", async () => {
  const source = await readFile(`${stockRoot}/background-v071.js`, "utf8");
  assert.match(source, /importScripts\("background-v070\.js"\)/);
  assert.match(source, /const OPTION_BATCH_MAX_V071 = 20/);
  assert.match(source, /active\.job\?\.productKind === "OPTION"/);
  assert.match(source, /active\.job\?\.optionApiApplied === true/);
  assert.match(source, /goodsKeys: batch/);
  assert.match(source, /const searchToken = batch\.join\(","\)/);
  assert.match(source, /batchMode: "A21_COMMA_MULTI_GOODS_KEY"/);
  assert.match(source, /optionApiMutation: "ALREADY_VERIFIED_PER_GOODS_KEY"/);
  assert.match(source, /optionApiMutation: "UNCHANGED_PER_GOODS_KEY_EXACT_BEFORE_A21"/);
});

test("HF29 advances OPTION completion by the whole transmitted batch", async () => {
  const source = await readFile(`${stockRoot}/background-v071.js`, "utf8");
  assert.match(source, /const nextStart = batchStart \+ currentBatch\.length/);
  assert.match(source, /active\.goodsKeyIndex = nextStart/);
  assert.match(source, /active\.optionCurrentBatchKeys = \[\]/);
  assert.match(source, /active\.optionCompletedBatches = Number\(active\.optionCompletedBatches \|\| 0\) \+ 1/);
  assert.match(source, /finish\(\s*active,\s*"SUCCEEDED"/s);
  assert.match(source, /SHOPLING_OPTION_BATCH_NEXT_DISPATCH_LOST_HF29/);
});

test("proven canonical A21 engine really performs comma multi-search and exact fail-closed row verification", async () => {
  const source = await readFile(canonicalPath, "utf8");
  assert.match(source, /assignment\.goodsKeys\.join\(","\)/);
  assert.match(source, /assignment\.goodsKeys\.length > 200/);
  assert.match(source, /A21_GOODSKEY_RESULT_MISSING/);
  assert.match(source, /A21_VISIBLE_ROW_COUNT_MISMATCH/);
  assert.match(source, /A21_ROW_SELECTION_MISMATCH/);
  assert.match(source, /A21_SPLIT_REQUIRED/);
});

test("HF29 download wraps v0.5.6 HF28 instead of replacing its safety layers", async () => {
  const source = await readFile("src/app/api/shopling-stock-state-sync/download-hf29/route.ts", "utf8");
  assert.match(source, /getHf28Download/);
  assert.match(source, /const BASE_VERSION = "0\.5\.6"/);
  assert.match(source, /const VERSION = "0\.5\.7"/);
  assert.match(source, /background-v070\.js/);
  assert.match(source, /background-v071\.js/);
  assert.match(source, /optionA21SearchMode: "COMMA_MULTI_GOODS_KEY"/);
  assert.match(source, /optionA21BatchMax: 20/);
  assert.match(source, /optionA21SilentSingleKeyFallback: false/);
  assert.match(source, /hf28TwoLanePreserved: true/);
  assert.match(source, /hf28HeartbeatPreserved: true/);
  assert.match(source, /liveShoplingVerified: false/);
});
