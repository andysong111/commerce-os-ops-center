import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backgroundPath =
  "public/shopling-stock-state-sync/background-v085.js";

async function loadOwnerHarness({ oldOwnerHealthy = false } = {}) {
  const [hf36Source, source] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v073.js", "utf8"),
    readFile(backgroundPath, "utf8"),
  ]);
  let active = {
    status: "RUNNING",
    stage: "A6",
    job: { jobId: "hf63-bcd8-2", barcode: "BCD8-2" },
    workTabs: { A6: { tabId: 101, windowId: 12, frameId: 7 } },
  };
  const saves = [];
  const legacyCalls = [];
  const broadcasts = [];
  const probeCalls = [];
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.26" }) },
    tabs: {
      sendMessage: async (tabId, message, options) => {
        probeCalls.push({ tabId, message, options });
        return oldOwnerHealthy
          ? { ok: true, page: { role: "A6" }, version: "0.2.3" }
          : null;
      },
    },
  };
  const factory = new Function(
    "chrome",
    "importScripts",
    "handlePageReady",
    "handleStepResult",
    "finish",
    "loadActive",
    "saveActive",
    "broadcast",
    "start",
    `${hf36Source}\n${source}\nreturn { handlePageReady, finish };`,
  );
  const api = factory(
    chrome,
    () => {},
    async (message, sender) => {
      legacyCalls.push({ message, sender });
      return { ok: true, dispatched: true };
    },
    async () => ({ ok: true }),
    async () => ({ outcome: "SUCCEEDED" }),
    async () => active,
    async (value) => {
      active = value;
      saves.push(structuredClone(value));
    },
    async (type, payload) => broadcasts.push({ type, payload }),
    async () => ({ ok: true }),
  );
  return {
    api,
    getActive: () => active,
    saves,
    legacyCalls,
    broadcasts,
    probeCalls,
  };
}

test("HF63 resumes BCD8-2 on the replacement A6 frame only after the old search document is gone", async () => {
  const harness = await loadOwnerHarness();
  const result = await harness.api.handlePageReady(
    { page: { role: "A6", href: "https://a.shopling.co.kr/prod/a6" } },
    { tab: { id: 101, windowId: 12 }, frameId: 11 },
  );

  assert.equal(result.dispatched, true);
  assert.equal(harness.probeCalls.length, 1);
  assert.deepEqual(harness.probeCalls[0].options, { frameId: 7 });
  assert.equal(harness.getActive().workTabs.A6.frameId, 11);
  assert.equal(harness.getActive().shoplingFrameId, 11);
  assert.equal(
    harness.getActive().watchdogHeartbeatSource,
    "HF63_EXACT_A6_NAVIGATION_OWNER_REBOUND",
  );
  assert.equal(harness.legacyCalls.length, 1);
  assert.ok(
    harness.broadcasts.some(
      (entry) =>
        entry.type === "STOCK_SYNC_PROGRESS" &&
        entry.payload.evidence.code ===
          "HF63_A6_OWNER_REBOUND_AFTER_NAVIGATION",
    ),
  );
});

test("HF63 preserves HF36 exact ownership while the assigned A6 frame is still alive", async () => {
  const harness = await loadOwnerHarness({ oldOwnerHealthy: true });
  await harness.api.handlePageReady(
    { page: { role: "A6" } },
    { tab: { id: 101, windowId: 12 }, frameId: 11 },
  );

  assert.equal(harness.getActive().workTabs.A6.frameId, 7);
  assert.equal(harness.saves.length, 0);
  assert.equal(harness.broadcasts.length, 0);
  assert.equal(harness.legacyCalls.length, 0);
});

test("HF63 never transfers A6 ownership across tabs or for an A21 write page", async () => {
  const otherTab = await loadOwnerHarness();
  await otherTab.api.handlePageReady(
    { page: { role: "A6" } },
    { tab: { id: 999, windowId: 12 }, frameId: 11 },
  );
  assert.equal(otherTab.getActive().workTabs.A6.frameId, 7);
  assert.equal(otherTab.probeCalls.length, 0);

  const writeStage = await loadOwnerHarness();
  writeStage.getActive().stage = "A21_LIST";
  writeStage.getActive().workTabs.A21_LIST = {
    tabId: 101,
    windowId: 12,
    frameId: 7,
  };
  await writeStage.api.handlePageReady(
    { page: { role: "A21" } },
    { tab: { id: 101, windowId: 12 }, frameId: 11 },
  );
  assert.equal(writeStage.getActive().workTabs.A21_LIST.frameId, 7);
  assert.equal(writeStage.probeCalls.length, 0);
});

async function loadContinuationHarness() {
  const source = await readFile(backgroundPath, "utf8");
  const firstJob = {
    jobId: "incident:BCD8-2:SOLD_OUT",
    barcode: "BCD8-2",
    desiredStatus: "SOLD_OUT",
    productKind: "OPTION",
    parallelBatchId: "hf63-real-incident-pair",
    parallelLane: 1,
  };
  const secondJob = {
    jobId: "incident:BCD8-1:SOLD_OUT",
    barcode: "BCD8-1",
    desiredStatus: "SOLD_OUT",
    productKind: "OPTION",
    parallelBatchId: firstJob.parallelBatchId,
    parallelLane: 2,
  };
  let state = {
    batchId: firstJob.parallelBatchId,
    status: "RUNNING",
    phase: "FIRST_RUNNING_UNTIL_RESULT_WAIT",
    jobs: [firstJob, secondJob],
    firstJobId: firstJob.jobId,
    secondJobId: secondJob.jobId,
    secondStarted: false,
    results: {},
  };
  let active = { status: "RUNNING", stage: "A6", job: firstJob };
  const starts = [];
  const broadcasts = [];
  const removedKeys = [];
  const createdAlarms = [];
  const clearedAlarms = [];
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.26" }) },
    storage: {
      local: {
        get: async (key) => ({ [key]: state }),
        set: async (value) => {
          state = value.commerceOsShoplingStockParallelV028 || state;
        },
        remove: async (key) => removedKeys.push(key),
      },
    },
    alarms: {
      create: async (name, options) => createdAlarms.push({ name, options }),
      clear: async (name) => {
        clearedAlarms.push(name);
        return true;
      },
    },
    tabs: {
      get: async () => null,
      update: async () => null,
      sendMessage: async () => null,
    },
    windows: {
      create: async () => ({ id: 71, tabs: [{ id: 901, windowId: 71 }] }),
      update: async () => null,
    },
  };
  const legacyFinish = async (jobActive, outcome, message, evidence) => {
    const result = {
      jobId: jobActive.job.jobId,
      job: jobActive.job,
      outcome,
      message,
      evidence,
      finishedAt: Date.now(),
    };
    state.results = {
      ...state.results,
      [result.jobId]: {
        outcome,
        message,
        finishedAt: result.finishedAt,
      },
    };
    active = null;
    return result;
  };
  const start = async (job) => {
    starts.push(job.jobId);
    active = { status: "RUNNING", stage: "A6", job };
    return { ok: true, active };
  };
  const factory = new Function(
    "chrome",
    "importScripts",
    "handlePageReady",
    "finish",
    "loadActive",
    "saveActive",
    "broadcast",
    "start",
    "setTimeout",
    `${source}\nreturn { handlePageReady, finish };`,
  );
  const api = factory(
    chrome,
    () => {},
    async () => ({ ok: true }),
    legacyFinish,
    async () => active,
    async (value) => {
      active = value;
    },
    async (type, payload) => broadcasts.push({ type, payload }),
    start,
    (callback) => {
      callback();
      return 1;
    },
  );
  return {
    api,
    firstJob,
    secondJob,
    getState: () => state,
    getActive: () => active,
    starts,
    broadcasts,
    removedKeys,
    createdAlarms,
    clearedAlarms,
  };
}

test("HF63 attempts BCD8-1 even when paired BCD8-2 fails before A21", async () => {
  const harness = await loadContinuationHarness();
  const result = await harness.api.finish(
    { status: "RUNNING", stage: "A6", job: harness.firstJob },
    "FAILED",
    "BCD8-2 A6 exact-search continuation failed",
    { code: "STOCK_SYNC_IDLE_TIMEOUT" },
  );

  assert.equal(result.outcome, "FAILED");
  assert.deepEqual(harness.starts, [harness.secondJob.jobId]);
  assert.equal(harness.getActive()?.job?.jobId, harness.secondJob.jobId);
  assert.equal(harness.getState().phase, "PARALLEL_RUNNING");
  assert.equal(harness.getState().secondStarted, true);
  assert.equal(
    harness.getState().results[harness.firstJob.jobId].outcome,
    "FAILED",
  );
  assert.equal(
    harness.getState().secondRecoveredBy,
    "HF63_CONTINUE_AFTER_FIRST_FAILURE",
  );
  assert.deepEqual(harness.removedKeys, ["commerceStockWorkspaceV030"]);
  assert.ok(harness.createdAlarms.length >= 1);
  assert.ok(harness.clearedAlarms.length >= 1);
  assert.ok(
    harness.broadcasts.some(
      (entry) =>
        entry.type === "STOCK_SYNC_PARALLEL_STATUS" &&
        entry.payload.activeJobId === harness.secondJob.jobId,
    ),
  );
});

test("HF63 package remains reproducible while HF64 becomes the required stock-sync build", async () => {
  const [route, page, planner, background] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf63/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(backgroundPath, "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.25"/);
  assert.match(route, /const VERSION = "0\.6\.26"/);
  assert.match(route, /background-v085\.js/);
  assert.match(route, /everySavedBcodeGetsIndependentAttempt: true/);
  assert.match(page, /download-hf64/);
  assert.match(page, /v0\.6\.27 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 27\]/);
  assert.match(background, /HF63_EXACT_A6_NAVIGATION_OWNER_REBOUND/);
  assert.match(background, /HF63_CONTINUE_AFTER_FIRST_FAILURE/);
});
