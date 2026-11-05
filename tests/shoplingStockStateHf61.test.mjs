import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadHarness({
  phase = "FIRST_RUNNING_UNTIL_RESULT_WAIT",
  secondStarted = false,
  firstOutcome = null,
  lastResult = null,
  activeJob = null,
  leaseAgeMs = null,
} = {}) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v083.js",
    "utf8",
  );
  const firstJob = {
    jobId: "stock-resend:incident:BCC5-2:ON_SALE",
    barcode: "BCC5-2",
    productKind: "OPTION",
    desiredStatus: "ON_SALE",
    parallelBatchId: "stockout-direct-batch:incident-3-of-20",
    parallelLane: 1,
  };
  const secondJob = {
    jobId: "stock-resend:incident:BCC5-3:SOLD_OUT",
    barcode: "BCC5-3",
    productKind: "OPTION",
    desiredStatus: "SOLD_OUT",
    parallelBatchId: firstJob.parallelBatchId,
    parallelLane: 2,
  };
  let state = {
    batchId: firstJob.parallelBatchId,
    status: "RUNNING",
    phase,
    jobs: [firstJob, secondJob],
    firstJobId: firstJob.jobId,
    secondJobId: secondJob.jobId,
    secondStarted,
    results: firstOutcome
      ? {
          [firstJob.jobId]: {
            outcome: firstOutcome,
            finishedAt: Date.now() - 1_000,
          },
        }
      : {},
    ...(leaseAgeMs == null
      ? {}
      : { secondRecoveryLeaseAt: Date.now() - leaseAgeMs }),
  };
  let active = activeJob ? { status: "RUNNING", job: activeJob } : null;
  let last = lastResult;
  const starts = [];
  const broadcasts = [];
  const createdAlarms = [];
  const clearedAlarms = [];
  const alarmListeners = [];
  const storageListeners = [];
  const createdWindows = [];
  let nextTabId = 901;

  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.24" }),
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: state }),
        set: async (value) => {
          state = value.commerceOsShoplingStockParallelV028 || state;
        },
        remove: async () => undefined,
      },
      onChanged: {
        addListener: (listener) => storageListeners.push(listener),
      },
    },
    alarms: {
      create: async (name, options) => createdAlarms.push({ name, options }),
      clear: async (name) => {
        clearedAlarms.push(name);
        return true;
      },
      onAlarm: {
        addListener: (listener) => alarmListeners.push(listener),
      },
    },
    tabs: {
      get: async () => null,
      update: async () => null,
    },
    windows: {
      create: async () => {
        const created = {
          id: 71 + createdWindows.length,
          tabs: [{ id: nextTabId++, windowId: 71 + createdWindows.length }],
        };
        createdWindows.push(created);
        return created;
      },
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
    last = result;
    active = null;
    state.results = {
      ...(state.results || {}),
      [result.jobId]: {
        outcome,
        message,
        finishedAt: result.finishedAt,
      },
    };
    return result;
  };
  const start = async (job) => {
    starts.push(job.jobId);
    active = { status: "RUNNING", job };
    return { ok: true, active };
  };
  const loadActive = async () => active;
  const loadLastResult = async () => last;
  const broadcast = async (type, payload) => {
    broadcasts.push({ type, payload });
  };
  const factory = new Function(
    "chrome",
    "importScripts",
    "finish",
    "start",
    "loadActive",
    "loadLastResult",
    "broadcast",
    `${source}\nreturn { finish };`,
  );
  const api = factory(
    chrome,
    () => {},
    legacyFinish,
    start,
    loadActive,
    loadLastResult,
    broadcast,
  );
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  await flush();

  return {
    api,
    firstJob,
    secondJob,
    getState: () => state,
    getActive: () => active,
    starts,
    broadcasts,
    createdAlarms,
    clearedAlarms,
    alarmListeners,
    storageListeners,
    createdWindows,
    flush,
  };
}

test("HF61 reproduces the live 3/20 gap and starts the saved second lane immediately after Lane 1 acceptance", async () => {
  const harness = await loadHarness();
  await harness.api.finish(
    { status: "RUNNING", job: harness.firstJob },
    "SUCCEEDED",
    "BCC5-2 Shopling 판매중 전송 접수 완료",
    { commerceOsResponsibilityComplete: true },
  );

  assert.deepEqual(harness.starts, [harness.secondJob.jobId]);
  assert.equal(harness.getActive()?.job?.jobId, harness.secondJob.jobId);
  assert.equal(harness.getState().secondStarted, true);
  assert.equal(harness.getState().phase, "PARALLEL_RUNNING");
  assert.equal(
    harness.getState().secondRecoveredBy,
    "HF61_DURABLE_SECOND_LANE_RESUME",
  );
  assert.equal(harness.createdWindows.length, 1);
  assert.ok(
    harness.broadcasts.some(
      (entry) =>
        entry.type === "STOCK_SYNC_PARALLEL_STATUS" &&
        entry.payload.secondStarted === true &&
        entry.payload.activeJobId === harness.secondJob.jobId,
    ),
  );
});

test("HF61 alarm actively resumes a first-success checkpoint instead of merely waking the worker", async () => {
  const harness = await loadHarness({ firstOutcome: "SUCCEEDED" });
  const legacyResumeAlarm =
    "commerce-os-shopling-stock-parallel-resume-hf51";

  harness.alarmListeners.at(-1)?.({ name: legacyResumeAlarm });
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await harness.flush();

  assert.deepEqual(harness.starts, [harness.secondJob.jobId]);
  assert.equal(harness.getState().phase, "PARALLEL_RUNNING");
  assert.equal(harness.getState().secondStarted, true);
});

test("HF61 resumes an interrupted persisted second-lane claim exactly once after worker restart", async () => {
  const harness = await loadHarness({
    phase: "STARTING_SECOND_HF61",
    secondStarted: true,
    firstOutcome: "SUCCEEDED",
    leaseAgeMs: 30_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await harness.flush();

  assert.deepEqual(harness.starts, [harness.secondJob.jobId]);
  assert.equal(harness.getState().phase, "PARALLEL_RUNNING");
  assert.equal(harness.getState().secondStarted, true);

  const secondResumeAlarm =
    "commerce-os-shopling-stock-second-lane-resume-hf61";
  harness.alarmListeners.at(-1)?.({ name: secondResumeAlarm });
  await harness.flush();
  assert.equal(harness.starts.length, 1);
});

test("HF61 never starts Lane 2 while a different exact job is active", async () => {
  const foreign = {
    jobId: "stock-resend:foreign:BBB8-1:ON_SALE",
    barcode: "BBB8-1",
  };
  const harness = await loadHarness({
    firstOutcome: "SUCCEEDED",
    activeJob: foreign,
  });
  harness.alarmListeners.at(-1)?.({
    name: "commerce-os-shopling-stock-parallel-resume-hf51",
  });
  await harness.flush();

  assert.equal(harness.starts.length, 0);
  assert.equal(harness.getState().secondStarted, false);
  assert.equal(harness.getActive()?.job?.jobId, foreign.jobId);
});

test("HF61 download route publishes v0.6.24 and the durable second-lane checkpoint", async () => {
  const [route, page, planner, worker] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf61/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(
      "public/shopling-stock-state-sync/background-v083.js",
      "utf8",
    ),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.23"/);
  assert.match(route, /const VERSION = "0\.6\.24"/);
  assert.match(route, /durableSecondLaneResume: true/);
  assert.match(route, /persistedSecondLaneClaim: true/);
  assert.match(page, /download-hf73/);
  assert.match(page, /v0\.6\.36 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 36\]/);
  assert.match(worker, /STARTING_SECOND_HF61/);
  assert.match(worker, /FIRST_FINISH_HF61/);
});
