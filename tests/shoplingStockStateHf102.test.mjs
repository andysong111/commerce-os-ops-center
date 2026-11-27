import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { strFromU8, unzipSync } from "fflate";
import { patchMarketPlanGrouping, patchMarketPlanOps, patchMarketResultWatcher } from "../src/lib/shoplingStockHf102Patch.ts";
import { patchHf99EndedProductSkip } from "../src/lib/shoplingStockHf99Patch.ts";

const base = "public/shopling-stock-state-sync/";
const fixture = unzipSync(await readFile(base + "fixtures/commerce-os-shopling-stock-state-v0.6.48-hf85.zip"));
const grouped = patchMarketPlanGrouping(strFromU8(fixture["background-v092.js"]), await readFile(base + "market-plan-hf102.js", "utf8"));
const terminal = await readFile(base + "market-receipts-hf102.js", "utf8");
const bridge = patchMarketPlanOps(patchHf99EndedProductSkip(await readFile(base + "content-ops-v025.js", "utf8")));
const option = (key, desiredStatus = "ON_SALE") => ({
  goodsKey: key, optionCount: 2, effectiveProductKind: "OPTION", transmissionKind: "OPTION_SEND", desiredStatus,
});
const parent = (key, desiredStatus = "ON_SALE") => ({
  goodsKey: key, optionCount: 2, effectiveProductKind: "SINGLE", transmissionKind: "PRODUCT_SALE_STATUS_SEND", desiredStatus,
});
function job(rows, target = "ON_SALE") {
  const keys = [...new Set(rows.map(row => row.goodsKey))];
  return {
    jobId: "ops-BCD8-2", barcode: "BCD8-2", desiredStatus: target, logicalProductKind: "OPTION", productKind: "OPTION",
    stockPlanVersion: 2, stockPlanOwnerId: "ops-BCD8-2", goodsKeys: keys, stockStateApiApplied: true,
    stockStateTransmissions: rows, stockStateApiEvidence: keys.map(key => ({ matchedGoodsKey: key })),
  };
}
function harness() {
  const storage = {};
  const timers = [];
  const dispatches = [];
  const results = [];
  const ctx = vm.createContext({
    setTimeout: (callback) => timers.push(callback), importScripts() {}, console: { log() {} }, norm: value => String(value || "").trim(), structuredClone,
    currentGoodsKey: active => active.job.goodsKeys[active.goodsKeyIndex], sleep: async () => {},
    start: async () => { throw Error("unplanned start"); }, dispatchToTarget: async () => true,
    async dispatchCurrent(active) {
      const kind = active.job.productKind;
      const keys = [...active.job.goodsKeys];
      dispatches.push([kind, active.job.desiredStatus, keys]);
      active[kind === "OPTION" ? "optionCurrentBatchKeys" : "singleCurrentBatchKeys"] = keys;
      await ctx.saveActive(active);
      return true;
    },
    continueNextGoodsKey() { throw Error("legacy ungrouped completion"); },
    loadActive: async () => structuredClone(storage.active),
    saveActive: async active => { storage.active = structuredClone(active); return active; },
    async finish(active, outcome, message, evidence) {
      const result = { outcome, job: active.job, message, evidence, finishedAt: Date.now() };
      results.push(result);
      storage.last = structuredClone(result);
      await ctx.saveActive(null);
      return result;
    },
    findExactRoleTarget: async () => ({ tabId: 1, frameId: 0 }), progress: async () => {},
    STATE_KEY: "active", LAST_RESULT_KEY: "last", ALARM_NAME: "watch",
    chrome: { runtime: { getManifest: () => ({ version: "0.6.62" }) }, alarms: { create: async () => {} },
      storage: { local: { get: async () => structuredClone(storage) } },
      tabs: { query: async () => [], get: async id => ({ id }) } },
  });
  vm.runInContext(grouped + "\n" + terminal, ctx);
  async function submitted(popup, modify = () => {}) {
    const active = await ctx.loadActive();
    const { productKind, desiredStatus, jobId, executionId } = active.job;
    const query = active.job.goodsKeys.join(",");
    const receiptKey = [jobId, executionId || jobId, productKind, query].join(":");
    active.stage = "WAIT_A21_RESULT";
    active.workTabs.A21_POPUP = { tabId: popup, frameId: 0 };
    active.a21PopupOwnershipHf81 = { claimedTabId: popup, listTabId: 1, claimedFrameId: 0, assignmentOwnerKey: receiptKey };
    active.lastMileReceiptHf84 = { productKind, desiredStatus, goodsKeyQuery: query, popupTabId: popup, popupFrameId: 0,
      receiptKey, assignmentOwnerKey: receiptKey, submitDispatchMethod: "ORIGINAL_SHOPLING_FUNCTION",
      shoplingSubmitInvoked: true, submitConfirmSeen: true, submitControlVerified: true, targetChecked: true, topChecked: true };
    modify(active.lastMileReceiptHf84);
    await ctx.saveActive(active);
    return active;
  }
  return { ctx, storage, dispatches, results, submitted, timers };
}

test("BCD8 revival keeps every channel key, waits for the exact option receipt, then submits product on-sale once", async () => {
  const h = harness();
  const spec = job([parent("122445"), option("122445"), option("122446"), parent("122446")]);
  assert.equal((await h.ctx.start(spec)).ok, true);
  assert.deepEqual(h.dispatches.map(r => r[0]), ["OPTION"]);
  const beforeSubmit = await h.ctx.loadActive();
  const first = await h.submitted(91);
  await h.ctx.saveActive(beforeSubmit);
  assert.equal(h.storage.active.lastMileReceiptHf84.popupTabId, 91);
  const warning = { code: "SHOPLING_HF87_RESULT_TABLE_FAILURE", resultTabId: 91,
    result: { exactOwnerA21PopupTabId: 91, terminal: true, resultHeading: true,
      rowsBalanced: true, totalCount: 34, successCount: 29, failureCount: 5 } };
  await Promise.all([
    h.ctx.finish(first, "UNCERTAIN", "5/34", warning),
    h.ctx.finish(first, "UNCERTAIN", "duplicate watcher", warning),
  ]);
  assert.deepEqual(h.dispatches.map(r => r.slice(0, 2)), [["OPTION", "ON_SALE"], ["SINGLE", "ON_SALE"]]);
  assert.equal(h.results.length, 0);
  await h.ctx.saveActive(first); // A delayed event from the old popup cannot overwrite the next assignment.
  assert.equal(h.storage.active.job.productKind, "SINGLE");
  await h.ctx.finish(first, "UNCERTAIN", "late", warning);
  const second = await h.submitted(92);
  await h.ctx.continueNextGoodsKey(second, { tab: { id: 92 } }, { exactOwnerA21PopupTabId: 92 });
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].outcome, "SUCCEEDED");
  assert.equal(h.results[0].evidence.stockPlanComplete, true);
  assert.equal(h.results[0].evidence.marketFailureCount, 5);
  assert.deepEqual(Array.from(h.results[0].evidence.stockStateGroupReceipts, r => r.acceptedPopupTabId), [91, 92]);
});

test("sold-out and on-sale parent directions stay in separate popups after options; malformed proof and foreign popup do not advance", async () => {
  const h = harness();
  const spec = job([option("1","SOLD_OUT"), option("2","SOLD_OUT"), parent("1","SOLD_OUT"), parent("2")], "SOLD_OUT");
  const lanes = h.ctx.shoplingMarketPlanHf102.groups(spec);
  assert.deepEqual(Array.from(lanes, r => [r.transmissionKind, r.desiredStatus]), [
    ["OPTION_SEND","SOLD_OUT"], ["PRODUCT_SALE_STATUS_SEND","ON_SALE"], ["PRODUCT_SALE_STATUS_SEND","SOLD_OUT"],
  ]);
  assert.equal((await h.ctx.start(spec)).ok, true);
  let active = await h.submitted(93, r => { r.submitConfirmSeen = false; });
  await h.ctx.finish(active, "SUCCEEDED", "HF58", { resultTabId: 93 });
  active = await h.submitted(93);
  await h.ctx.finish(active, "SUCCEEDED", "foreign", { resultTabId: 94 });
  assert.equal(h.dispatches.length, 1);
  await h.ctx.finish(active, "SUCCEEDED", "processing", { resultTabId: 93 });
  assert.equal(h.dispatches.length, 2);
  await h.ctx.finish(h.storage.active, "FAILED", "parent popup error", { code: "HF92_ERROR", retrySafe: true });
  assert.equal(h.results[0].outcome, "UNCERTAIN");
  assert.equal(h.results[0].evidence.retrySafe, false);
  assert.equal(h.results[0].evidence.stockPlanComplete, false);
  assert.equal(h.results[0].evidence.completedStockPlanLegs.length, 1);
});

test("one-option-only plan, conflicting duplicate, missing key and 201-key plan boundaries", () => {
  const p = harness().ctx.shoplingMarketPlanHf102;
  assert.equal(p.groups(job([option("1")])).length, 1);
  assert.throws(() => p.groups(job([parent("1"), parent("1","SOLD_OUT")])), /CONFLICTING/);
  assert.throws(() => p.groups({ ...job([option("1")]), goodsKeys: ["1","2"] }), /MISSING_GOODS_KEY/);
  const rows = Array.from({length:201}, (_, i) => parent(String(i + 1)));
  assert.deepEqual(Array.from(p.groups(job(rows)), r => r.goodsKeys.length), [200,1]);
});

function bridgeHarness({ lock = true, idle = true, ended = false, unsigned = false, outdated = false } = {}) {
  const messages = [];
  const api = [];
  const starts = [];
  const spec = job([option("122445"), parent("122445")]);
  const origin = "https://commerce-os-ops-center.vercel.app";
  const ctx = vm.createContext({
    __COMMERCE_OS_EXPOSE_STOCK_HF87_OPS_TEST_HOOKS__: true,
    location: { origin }, window: { addEventListener() {}, postMessage(message) { messages.push(message); } },
    navigator: { locks: { request: async (_name, _options, callback) => callback(lock ? {} : null) } },
    chrome: { runtime: {
      getManifest: () => ({ version: "0.6.62" }), onMessage: { addListener() {} },
      async sendMessage(request) {
        if (request.type === "STOCK_SYNC_GET_IDLE_STATUS_HF94") return { ok: true, idleConfirmed: idle };
        starts.push(request.job); return { ok: true };
      },
    } },
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      api.push(body);
      const result = body.mode === "PREFLIGHT_BATCH"
        ? { planVersion: 2, items: [{ ...body.items[0], dependencies: [], stockBatchPlan: "signed-fixture" }] }
        : ended ? { planVersion: 2, noActionableGoodsKeys: true, goodsKeys: [], receipts: [], transmissions: [],
          skippedEndedCount: 1, skippedEndedGoodsKeys: ["122445"] }
        : { planVersion: outdated ? 1 : 2, goodsKeys: spec.goodsKeys, receipts: spec.stockStateApiEvidence, transmissions: spec.stockStateTransmissions };
      return { ok: true, json: async () => ({ ok: true, result }) };
    },
  });
  vm.runInContext(bridge, ctx);
  const input = { jobId: spec.jobId, barcode: spec.barcode, productKind: "OPTION", desiredStatus: spec.desiredStatus,
    goodsKeys: spec.goodsKeys, ...(unsigned ? {} : { stockBatchPlan: "signed-fixture" }) };
  const run = () => ctx.__commerceOsStockHf87OpsTestHooks.startFromOps(input);
  return { api, starts, messages, run };
}

test("signed OPS job reaches worker with both same-key rows, unresolved legacy API version and busy tab perform no market sends", async () => {
  for (const mode of [{ lock: false }, { idle: false }]) {
    const h = bridgeHarness(mode);
    await h.run();
    assert.equal(h.api.length, 0);
    assert.equal(h.starts.length, 0);
    assert.equal(h.messages.at(-1).evidence.browserMutationStarted, false);
  }
  const standalone = bridgeHarness({ unsigned: true });
  await standalone.run();
  assert.equal(standalone.api.length, 2);
  assert.equal(standalone.api[0].mode, "PREFLIGHT_BATCH");
  assert.equal(standalone.api[1].stockBatchPlan, "signed-fixture");
  const h = bridgeHarness();
  await h.run();
  assert.equal(h.api.length, 1);
  assert.equal(h.api[0].stockBatchPlan, "signed-fixture");
  assert.equal(h.api[0].planVersion, 2);
  assert.deepEqual(Array.from(h.starts[0].stockStateTransmissions, row => row.transmissionKind),
    ["OPTION_SEND", "PRODUCT_SALE_STATUS_SEND"]);
  const ended = bridgeHarness({ ended: true });
  await ended.run();
  assert.equal(ended.starts.length, 0);
  assert.equal(ended.messages.at(-1).evidence.stockPlanComplete, true);
  const outdated = bridgeHarness({ outdated: true });
  await outdated.run();
  assert.equal(outdated.starts.length, 0);
  assert.equal(outdated.messages.at(-1).outcome, "FAILED");
});

test("HF87 mixed table leaves the exact popup open until the delayed native submit receipt can be reconciled", async () => {
  const watcher = patchMarketResultWatcher(await readFile(base + "background-v097.js","utf8"));
  const start = watcher.indexOf("        const mayClose =");
  const end = watcher.indexOf("          await closeCompletedWindowsHf87", start);
  assert.ok(start > 0 && end > start);
  const mayClose = new Function("latest","advanced",watcher.slice(start,end) + "return true; } return false;");
  const h = harness();
  await h.ctx.start(job([option("1"), parent("1")]));
  const active = await h.submitted(99, r => { r.submitControlVerified = false; });
  const table = {code:"SHOPLING_HF87_RESULT_TABLE_FAILURE",resultTabId:99,result:{
    exactOwnerA21PopupTabId:99,terminal:true,resultHeading:true,rowsBalanced:true,totalCount:5,successCount:4,failureCount:1 }};
  const pending = await h.ctx.finish(active, "UNCERTAIN", "market warning", table);
  assert.equal(mayClose(active,{ok:true,result:pending}), false);
  // Simulate the exact native callback completing its record in the original popup.
  const proven = await h.submitted(99);
  const accepted = await h.ctx.finish(proven, "UNCERTAIN", "market warning", table);
  assert.equal(accepted.stockPlanLegAccepted, true);
  assert.equal(mayClose(proven,{ok:true,result:accepted}), true);
  assert.equal(h.dispatches.length, 2);
  assert.equal(h.results.length, 0);
});

test("HF58 navigation before original receipt reconciles without another tab event or second option submit", async () => {
  const h = harness();
  await h.ctx.start(job([option("1"), parent("1")]));
  const active = await h.submitted(104, receipt => { receipt.submitConfirmSeen = false; });
  const nav = await h.ctx.finish(active, "SUCCEEDED", "processing", { resultTabId: 104 });
  assert.equal(nav.stockPlanLegAccepted, false);
  assert.equal(h.storage.active.stockPlanPendingResult.resultTabId, 104);
  await h.submitted(104);
  for (const callback of h.timers.splice(0)) callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.dispatches.map(r => r[0]), ["OPTION", "SINGLE"]);
  assert.equal(h.storage.active.stockPlanPendingResult, undefined);
  assert.equal(h.results.length, 0);
});
