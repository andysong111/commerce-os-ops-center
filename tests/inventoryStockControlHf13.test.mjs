import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF13 SINGLE bypasses A4 and uses A6 read-only discovery before A21", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v057.js", "utf8");
  assert.match(background, /importScripts\("background-v056\.js"\)/);
  assert.match(background, /productKind === "SINGLE" \? \["A6", "A21_LIST"\]/);
  assert.match(background, /singleA4Bypassed: true/);
  assert.match(background, /goodsKeySource: "A6_LIVE_SINGLE_BARCODE"/);
  assert.match(background, /a6Mutation: "NONE_READ_ONLY_RESOLVER"/);
  assert.doesNotMatch(background, /stage: "A4"/);
  assert.doesNotMatch(background, /preflight\.targets\.A4/);
});

test("HF13 SINGLE A21 sends live goods keys in <=200-key batches through the canonical price list engine", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v057.js", "utf8");
  assert.match(background, /const SINGLE_BATCH_MAX = 200/);
  assert.match(background, /active\.job\.goodsKeys\.slice\(start, start \+ limit\)/);
  assert.match(background, /type: CANONICAL_ASSIGN/);
  assert.match(background, /mode: "OPTION"/);
  assert.match(background, /goodsKeys: batch/);
  assert.match(background, /content-a21-canonical-v014\.js/);
});

test("HF13 adapts batches when A21 visible rows exceed 500 and continues at A21 instead of returning to A4", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v057.js", "utf8");
  assert.match(background, /A21_SPLIT_REQUIRED/);
  assert.match(background, /SINGLE_A21_BATCH_ADAPTIVE_SPLIT/);
  assert.match(background, /Math\.max\(1, Math\.floor\(currentBatch\.length \/ 2\)\)/);
  assert.match(background, /active\.stage = "A21_LIST"/);
  assert.match(background, /nextStart = batchStart \+ currentBatch\.length/);
});

test("HF13 download wraps HF12 and exposes the no-A4 single flow without changing HF10 option core", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download-hf13/route.ts", "utf8");
  assert.match(route, /getHf12Download/);
  assert.match(route, /HF13_SINGLE_A6_READONLY_TO_A21_BATCH_SALE_STATUS_NO_A4/);
  assert.match(route, /singleA4Used: false/);
  assert.match(route, /singleA6Mutation: false/);
  assert.match(route, /singleGoodsKeyBatchMax: 200/);
  assert.match(route, /optionFlow: "HF10_UNCHANGED"/);
  assert.match(route, /parallelLargeSetWindows: false/);
});
