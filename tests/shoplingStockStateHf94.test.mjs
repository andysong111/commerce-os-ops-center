import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ACTIVE_KEY = "commerceOsShoplingStockStateSyncV013";
const LAST_RESULT_KEY = "commerceOsShoplingStockStateSyncLastResultV013";

async function backgroundHarness(initial = {}) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v100.js",
    "utf8",
  );
  const storage = new Map(Object.entries(initial));
  const listeners = [];
  const clearedAlarms = [];
  const context = {
    importScripts() {},
    console,
    setTimeout,
    clearTimeout,
    URL,
    __COMMERCE_OS_EXPOSE_STOCK_HF94_TEST_HOOKS__: true,
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.6.56" }),
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
      },
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(
              names.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)]),
            );
          },
          async remove(key) {
            storage.delete(key);
          },
        },
      },
      alarms: {
        async clear(name) {
          clearedAlarms.push(name);
          return true;
        },
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "background-v100.js" });
  assert.equal(listeners.length, 1);

  async function request() {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("HF94 idle probe did not respond")),
        100,
      );
      const keepAlive = listeners[0](
        { type: "STOCK_SYNC_GET_IDLE_STATUS_HF94" },
        {},
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
      );
      assert.equal(keepAlive, true);
    });
  }

  return { source, storage, clearedAlarms, request };
}

test("HF94 returns a small explicit idle receipt when no job owns the extension", async () => {
  const harness = await backgroundHarness();
  const result = await harness.request();
  assert.equal(result.ok, true);
  assert.equal(result.idleConfirmed, true);
  assert.equal(result.active, null);
  assert.equal(result.probe, "HF94_MINIMAL_IDLE_STATUS");
});

test("HF94 preserves a live RUNNING lock and returns only ownership fields", async () => {
  const harness = await backgroundHarness({
    [ACTIVE_KEY]: {
      status: "RUNNING",
      stage: "WAIT_A21_RESULT",
      startedAt: 100,
      updatedAt: 120,
      job: {
        jobId: "job-bde7-1",
        barcode: "BDE7-1",
        largeEvidenceThatMustNotCrossTheBridge: "x".repeat(10_000),
      },
      history: ["large", "history"],
    },
  });
  const result = await harness.request();
  assert.equal(result.ok, true);
  assert.equal(result.idleConfirmed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.active)), {
    status: "RUNNING",
    stage: "WAIT_A21_RESULT",
    startedAt: 100,
    updatedAt: 120,
    job: { jobId: "job-bde7-1", barcode: "BDE7-1" },
  });
  assert.equal(harness.storage.has(ACTIVE_KEY), true);
});

test("HF94 clears only an exact terminal stale lock before confirming idle", async () => {
  const harness = await backgroundHarness({
    [ACTIVE_KEY]: {
      status: "RUNNING",
      stage: "WAIT_A21_RESULT",
      startedAt: 100,
      job: { jobId: "job-complete", barcode: "BDE7-2" },
    },
    [LAST_RESULT_KEY]: {
      jobId: "job-complete",
      outcome: "SUCCEEDED",
      finishedAt: 150,
    },
  });
  const result = await harness.request();
  assert.equal(result.idleConfirmed, true);
  assert.equal(result.recoveredTerminalLock, true);
  assert.equal(harness.storage.has(ACTIVE_KEY), false);
  assert.deepEqual(harness.clearedAlarms, [
    "commerce-os-shopling-stock-state-watchdog-v020",
  ]);
});

test("HF94 does not clear a different job's terminal receipt", async () => {
  const harness = await backgroundHarness({
    [ACTIVE_KEY]: {
      status: "RUNNING",
      startedAt: 100,
      job: { jobId: "job-live", barcode: "BDE7-3" },
    },
    [LAST_RESULT_KEY]: {
      jobId: "job-old",
      outcome: "SUCCEEDED",
      finishedAt: 200,
    },
  });
  const result = await harness.request();
  assert.equal(result.idleConfirmed, false);
  assert.equal(result.active.job.jobId, "job-live");
  assert.equal(harness.storage.has(ACTIVE_KEY), true);
});

test("HF94 package stays reproducible while the live gate advances to flattened HF95", async () => {
  const [route, bridge, barrier, page, planner, workflow] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf94/route.ts",
      "utf8",
    ),
    readFile(
      "public/shopling-stock-state-sync/content-ops-idle-hf94.js",
      "utf8",
    ),
    readFile("src/lib/shoplingStockReadyBarrier.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.55"/);
  assert.match(route, /const VERSION = "0\.6\.56"/);
  assert.match(route, /DEDICATED_MINIMAL_BACKGROUND_RECEIPT_BEFORE_EACH_BCODE/);
  assert.match(route, /ONE_BCODE_AT_A_TIME_UNCHANGED/);
  assert.match(bridge, /STOCK_SYNC_GET_IDLE_STATUS_HF94/);
  assert.match(bridge, /statusProbeOk: false/);
  assert.match(bridge, /let probePromise = null/);
  assert.match(barrier, /message\.statusProbeOk === false/);
  assert.match(barrier, /message\.idleConfirmed !== true/);
  assert.match(page, /href="\/api\/shopling-stock-state-sync\/download-hf95"/);
  assert.match(page, /v0\.6\.57 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 57\]/);
  assert.match(workflow, /shoplingStockStateHf94\.test\.mjs/);
  new Function(bridge);
});
