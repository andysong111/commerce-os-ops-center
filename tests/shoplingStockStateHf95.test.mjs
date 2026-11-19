import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("HF95 flattens the proven HF90 worker and HF94 idle layer instead of adding another import depth", async () => {
  const [route, wrapper, page, planner, workflow, browserCheck] =
    await Promise.all([
      readFile(
        "src/app/api/shopling-stock-state-sync/download-hf95/route.ts",
        "utf8",
      ),
      readFile(
        "public/shopling-stock-state-sync/background-v100.js",
        "utf8",
      ),
      readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
      readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
      readFile(".github/workflows/inventory-ui-visibility-ci.yml", "utf8"),
      readFile("scripts/shopling-idle-live-channel-check.mjs", "utf8"),
    ]);

  assert.match(wrapper, /^importScripts\("background-v099\.js"\);/);
  assert.match(route, /const BASE_VERSION = "0\.6\.56"/);
  assert.match(route, /const VERSION = "0\.6\.57"/);
  assert.match(route, /const FLAT_BASE_BACKGROUND = "background-v099\.js"/);
  assert.match(route, /const BACKGROUND = "background-v101\.js"/);
  assert.match(route, /withoutWrapperImport/);
  assert.match(route, /FLATTEN_HF90_AND_HF94_IN_ONE_SERVICE_WORKER_FILE/);
  assert.match(route, /shopling_stock_hf95_nested_wrapper_not_flattened/);
  assert.match(route, /shopling_stock_hf95_root_import_count_mismatch/);
  assert.match(page, /download-hf100/);
  assert.match(page, /v0\.6\.60 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 60\]/);
  assert.match(workflow, /shopling-idle-live-channel-check\.mjs/);
  assert.match(workflow, /COMMERCE_OS_EXTENSION_VERSION: 0\.6\.58/);
  assert.match(browserCheck, /statusProbeOk === true/);
  assert.match(browserCheck, /idleConfirmed === true/);
  assert.match(browserCheck, /externalWrites: \[\]/);
});

test("HF95 bridge reports a precise bounded failure when the extension worker never answers", async () => {
  const original = await readFile(
    "public/shopling-stock-state-sync/content-ops-idle-hf95.js",
    "utf8",
  );
  const source = original.replace(
    "const REQUEST_TIMEOUT_MS = 2_000;",
    "const REQUEST_TIMEOUT_MS = 5;",
  );
  const posted = [];
  const listeners = [];
  const window = {
    postMessage(payload) {
      posted.push(payload);
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
  };
  const context = {
    chrome: {
      runtime: {
        getManifest: () => ({ version: "0.6.57" }),
        sendMessage() {},
        lastError: null,
      },
    },
    window,
    location: { origin: "https://commerce-os-ops-center.vercel.app" },
    Promise,
    String,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, {
    filename: "content-ops-idle-hf95.js",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const failure = posted.find(
    (message) => message.statusProbeCode === "HF95_IDLE_STATUS_RESPONSE_TIMEOUT",
  );
  assert.ok(failure);
  assert.equal(failure.statusProbeOk, false);
  assert.equal(failure.idleConfirmed, false);
  assert.equal(failure.extensionVersion, "0.6.57");
  assert.equal(listeners.length, 1);
});

test("HF95 bridge accepts the explicit idle receipt and preserves one-probe single flight", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/content-ops-idle-hf95.js",
    "utf8",
  );
  const posted = [];
  let listener = null;
  let sendCount = 0;
  const window = {
    postMessage(payload) {
      posted.push(payload);
    },
    addEventListener(_type, value) {
      listener = value;
    },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.57" }),
      sendMessage(_message, callback) {
        sendCount += 1;
        queueMicrotask(() =>
          callback({ ok: true, active: null, idleConfirmed: true }),
        );
      },
      lastError: null,
    },
  };
  vm.runInNewContext(
    source,
    {
      chrome,
      window,
      location: { origin: "https://commerce-os-ops-center.vercel.app" },
      Promise,
      String,
      setTimeout,
      clearTimeout,
      queueMicrotask,
    },
    { filename: "content-ops-idle-hf95.js" },
  );
  listener({
    source: window,
    origin: "https://commerce-os-ops-center.vercel.app",
    data: { type: "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING_HF27" },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const receipt = posted.find(
    (message) => message.statusProbeOk === true && message.idleConfirmed === true,
  );
  assert.ok(receipt);
  assert.equal(receipt.active, null);
  assert.equal(receipt.stockIdleProbe, "HF95_FLAT_BACKGROUND_IDLE_STATUS");
  assert.equal(sendCount, 1);
});
