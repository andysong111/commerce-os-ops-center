import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  planShoplingStockLaunch,
  supportsOptionFirstParallel,
} from "../src/lib/shoplingStockLaunchPlan.ts";

const option = { jobId: "option-1", productKind: "OPTION" };
const single = { jobId: "single-1", productKind: "SINGLE" };

test("HF28/HF29 keep an OPTION-first queue in priority order and launch it serially", () => {
  for (const version of ["", "0.5.6", "0.5.7"]) {
    const plan = planShoplingStockLaunch([option, single], version);
    assert.equal(plan.mode, "SINGLE");
    assert.deepEqual(plan.jobs.map((job) => job.jobId), ["option-1"]);
    assert.equal(plan.compatibilitySerial, true);
  }
});

test("HF28/HF29 still overlap when their required first lane is SINGLE", () => {
  const plan = planShoplingStockLaunch([single, option], "0.5.7");
  assert.equal(plan.mode, "PARALLEL");
  assert.deepEqual(plan.jobs.map((job) => job.jobId), ["single-1", "option-1"]);
});

test("HF30 supports OPTION-first overlap without reordering B-code jobs", () => {
  assert.equal(supportsOptionFirstParallel("0.5.8"), true);
  assert.equal(supportsOptionFirstParallel("0.6.0"), true);
  const plan = planShoplingStockLaunch([option, single], "0.5.8");
  assert.equal(plan.mode, "PARALLEL");
  assert.deepEqual(plan.jobs.map((job) => job.jobId), ["option-1", "single-1"]);
  assert.equal(plan.compatibilitySerial, false);
});

test("launch planner never assigns more than two concurrent B-code jobs", () => {
  const third = { jobId: "single-2", productKind: "SINGLE" };
  const plan = planShoplingStockLaunch([option, single, third], "0.5.8");
  assert.equal(plan.jobs.length, 2);
  assert.deepEqual(plan.jobs.map((job) => job.jobId), ["option-1", "single-1"]);
});

test("HF30 extension gates OPTION detach to its final A21 batch and raises the exact batch cap to 200", async () => {
  const [parallel, optionBatch, release] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v069.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v071.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v072.js", "utf8"),
  ]);
  assert.match(parallel, /function supportsOptionFirstV069\(\)/);
  assert.match(parallel, /function canDetachFirstV069\(active\)/);
  assert.match(parallel, /batchStart \+ currentBatch\.length >= goodsKeys\.length/);
  assert.match(parallel, /active\.stage === "WAIT_A21_RESULT" && canDetachFirstV069\(active\)/);
  assert.match(optionBatch, /const OPTION_BATCH_MAX_HF30 = 200/);
  assert.match(optionBatch, /function optionBatchHardLimitV071\(\)/);
  assert.match(optionBatch, /popupPolicy: "NEW_A21_RESULT_WINDOW_PER_BATCH"/);
  assert.match(release, /importScripts\("background-v071\.js"\)/);
});

test("HF30 download route keeps the guarded v0.5.8 package contract", async () => {
  const [source, baseSource] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf30/route.ts", "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
  ]);
  assert.match(source, /getHf29Download/);
  assert.match(source, /const BASE_VERSION = "0\.5\.7"/);
  assert.match(source, /const VERSION = "0\.5\.8"/);
  assert.match(source, /optionA21BatchMax: 200/);
  assert.match(source, /optionA21PopupPolicy: "NEW_A21_RESULT_WINDOW_PER_BATCH"/);
  assert.match(source, /optionFirstLaneSupported: true/);
  assert.match(source, /optionLane1DetachPolicy: "FINAL_BATCH_ONLY"/);
  assert.match(source, /liveShoplingVerified: false/);
  assert.match(baseSource, /\.replace\(\/\\r\\n\?\/g, "\\n"\)/);
});

test("both stock-control launch surfaces use the shared version-aware planner", async () => {
  const [direct, queue, page] = await Promise.all([
    readFile("src/components/china-order-manager/InventoryStockoutOperatorPanel.tsx", "utf8"),
    readFile("src/components/china-order-manager/StockSyncOperationalQueuePanel.tsx", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
  ]);
  for (const source of [direct, queue]) {
    assert.match(source, /planShoplingStockLaunch/);
    assert.match(source, /extensionVersionRef\.current/);
    assert.match(source, /const version = String\(data\.extensionVersion \|\| ""\)/);
  }
  assert.match(page, /download-hf30/);
  assert.match(page, /v0\.5\.8 다운로드/);
});
