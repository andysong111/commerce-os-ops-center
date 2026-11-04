import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HF52 packages the stale STARTING_FIRST recovery as v0.6.17", async () => {
  const [route, background, page, planner] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf52/route.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v076.js", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  assert.match(route, /getHf51Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.16"/);
  assert.match(route, /const VERSION = "0\.6\.17"/);
  assert.match(route, /recoveryRequiresNoActiveJob: true/);
  assert.match(route, /recoveryRequiresNoTerminalResult: true/);
  assert.match(background, /importScripts\("background-v075\.js"\)/);
  assert.match(background, /STARTING_FIRST_STALE_MS = 3 \* 60 \* 1000/);
  assert.match(background, /await loadActive\(\)/);
  assert.match(background, /await loadLastResult\(\)/);
  assert.match(background, /const response = await start\(state\.jobs\[0\]\)/);
  assert.match(background, /shoplingMutationBeforeRecovery: false/);
  assert.match(page, /download-hf64/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 27\]/);
});

test("HF52 resumes exactly once only after STARTING_FIRST is stale and has no active or terminal owner", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v076.js",
    "utf8",
  );
  const key = "commerceOsShoplingStockParallelV028";
  const alarmName = "commerce-os-shopling-stock-parallel-resume-hf51";
  const firstJob = {
    jobId: "stock-resend:incident:BAE4-1:SOLD_OUT",
    barcode: "BAE4-1",
    productKind: "SINGLE",
    desiredStatus: "SOLD_OUT",
  };
  let state = {
    batchId: "stock-sync-ops-batch:incident",
    status: "RUNNING",
    phase: "STARTING_FIRST",
    startedAt: Date.now() - 4 * 60 * 1000,
    jobs: [firstJob, { ...firstJob, jobId: "stock-resend:incident:BBC3-3:SOLD_OUT", barcode: "BBC3-3" }],
    firstJobId: firstJob.jobId,
    secondJobId: "stock-resend:incident:BBC3-3:SOLD_OUT",
    secondStarted: false,
    results: {},
  };
  let active = null;
  let last = null;
  const alarmListeners = [];
  const statuses = [];
  const starts = [];
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.17" }) },
    storage: {
      local: {
        get: async () => ({ [key]: state }),
        set: async (value) => { state = value[key]; },
      },
    },
    alarms: {
      onAlarm: { addListener: (listener) => alarmListeners.push(listener) },
    },
  };
  const broadcast = async (type, payload) => statuses.push({ type, payload });
  const loadActive = async () => active;
  const loadLastResult = async () => last;
  const start = async (job) => {
    starts.push(job.jobId);
    active = { status: "RUNNING", job };
    return { ok: true, active };
  };
  new Function(
    "chrome",
    "importScripts",
    "setTimeout",
    "broadcast",
    "loadActive",
    "loadLastResult",
    "start",
    source,
  )(chrome, () => {}, () => 1, broadcast, loadActive, loadLastResult, start);
  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  alarmListeners.at(-1)?.({ name: alarmName });
  await flush();
  assert.deepEqual(starts, [firstJob.jobId]);
  assert.equal(state.phase, "FIRST_RUNNING_UNTIL_RESULT_WAIT");
  assert.equal(state.firstRecoveryAttempts, 1);
  assert.equal(state.firstRecoveredBy, "HF52_STARTING_FIRST_CHECKPOINT");
  assert.equal(statuses.at(-1)?.payload?.shoplingMutationBeforeRecovery, false);

  alarmListeners.at(-1)?.({ name: alarmName });
  await flush();
  assert.equal(starts.length, 1);

  active = null;
  state = {
    ...state,
    phase: "STARTING_FIRST",
    startedAt: Date.now(),
    firstRecoveryLeaseAt: 0,
  };
  alarmListeners.at(-1)?.({ name: alarmName });
  await flush();
  assert.equal(starts.length, 1);

  state = {
    ...state,
    startedAt: Date.now() - 4 * 60 * 1000,
  };
  last = { jobId: firstJob.jobId, outcome: "SUCCEEDED" };
  alarmListeners.at(-1)?.({ name: alarmName });
  await flush();
  assert.equal(starts.length, 1);
});
