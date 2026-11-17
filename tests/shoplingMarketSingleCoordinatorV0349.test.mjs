import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { buildSingleCoordinatorV0349 } from "../src/lib/shoplingMarketSingleCoordinatorV0349.ts";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0343";
const INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0343";
const LEASE_KEY = "commerceOsShoplingMarketCoordinatorLeaseV0349";

function fixture() {
  return {
    "manifest.json": JSON.stringify({
      version: "0.3.48",
      permissions: ["storage", "tabs", "windows"],
      action: { default_title: "v0.3.48" },
    }),
    "shopling-market-auto-agent.mjs": String.raw`
(() => {
  const BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";
  async function ensureRunningQueueResumeIntentV0348(queue) {
    await set({ intent: { status: "pending", resumeRunningQueue: true, queue } });
  }

  async function tick() {
    const queue = globalThis.queue;
      if (queue && queue.status === "running") {
        await ensureRunningQueueResumeIntentV0348(queue);
        return;
      }
  }
})();
`,
    "content-group-canary.mjs": String.raw`
(() => {
  const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v0343";
  async function pendingSelectionIntent() {
    const stored = await storageGet(SELECTION_INTENT_KEY);
    const intent = stored?.[SELECTION_INTENT_KEY] || null;
    if (!intent || intent.status !== "pending") return null;
    const age = Date.now() - Number(intent.createdAt || 0);
    return age <= 90000 ? intent : null;
  }
  async function navigateControlToA18ForIntent() {
    const intent = await pendingSelectionIntent();
    if (!intent || !isAdminShell()) return false;
    const lastRequestedAt = Number(intent.navigationRequestedAt || 0);
    if (lastRequestedAt > 0 && Date.now() - lastRequestedAt < 10000) return false;

    const aMenu = buttons(/^\[?A\]?\s*상품$/i, true)[0] || buttons(/\[A\].*상품/i, true)[0];
    if (aMenu) dispatchHover(aMenu);
    await sleep(250);
    const a18 = findA18Link();
    if (!a18) return false;

    await storageSet({
      [SELECTION_INTENT_KEY]: {
        ...intent,
        navigationRequestedAt: Date.now(),
      },
    });
    click(a18);
    return true;
  }
  async function selectedCoordinatorTick() {
    const context = await workerContext();
    if (context.worker) return;
      if (!isProductListUi()) { if (window.top === window && isAdminShell()) await navigateControlToA18ForIntent(); return; }
      await activateSelectionIntent();
  }
})();
`,
    "background-root.mjs": String.raw`
const MARKET_AUTO_BG_REPORT = "commerce-os-shopling-market-auto-bg-report-v0330";
const MARKET_AUTO_BG_HANDOFF = "commerce-os-shopling-market-auto-bg-handoff-v0330";
const extensionStorage = globalThis.__fixtureStorage;
const fixtureTabs = globalThis.__fixtureTabs;
async function marketAutoStorageGet(keys) { return Object.fromEntries(keys.map((key) => [key, extensionStorage[key]])); }
async function marketAutoStorageSet(values) { Object.assign(extensionStorage, values); return values; }
async function marketAutoGetTab(tabId) { return fixtureTabs.get(tabId) || null; }
async function marketAutoQueryTabs() { return [...fixtureTabs.values()].filter((tab) => /goods_mallRegLst\.phtml/.test(tab.url || "")); }
async function getWorkerMeta() { return globalThis.__fixtureWorkerMeta || null; }
function assignmentArray(meta) { return Object.values(meta?.assignments || {}); }
function isAdminControlUrl(url) {
  try { return ["a.shopling.co.kr", "kt.shopling.co.kr"].includes(new URL(String(url || "")).hostname); }
  catch { return false; }
}
function text(value) { return String(value == null ? "" : value).trim(); }
// No recovery of unrelated/pre-existing result tabs on extension startup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const runId = text(message.runId);
  const goodsKey = text(message.goodsKey);

  if (message.type === MARKET_AUTO_BG_HANDOFF) {
    sendResponse({ ok: false });
    return false;
  }
  return false;
});
`,
  };
}

function builtRuntime({ storage = {}, tabs = [] } = {}) {
  const output = buildSingleCoordinatorV0349(fixture());
  const listeners = [];
  const fixtureTabs = new Map(tabs.map((tab) => [tab.id, { ...tab }]));
  let updateCount = 0;
  let createCount = 0;
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(listener) { listeners.push(listener); } },
    },
    tabs: {
      update(tabId, options, callback) {
        updateCount += 1;
        const current = fixtureTabs.get(tabId);
        const next = current ? { ...current, url: options.url } : null;
        if (next) fixtureTabs.set(tabId, next);
        callback(next);
      },
      create() { createCount += 1; },
    },
    windows: {
      create() { createCount += 1; },
    },
  };
  const context = {
    URL,
    chrome,
    console,
    Date,
    Promise,
    Set,
    __fixtureStorage: storage,
    __fixtureTabs: fixtureTabs,
    __fixtureWorkerMeta: null,
  };
  vm.runInNewContext(output["background-root.mjs"], context);
  assert.equal(listeners.length, 1);
  return {
    output,
    storage,
    fixtureTabs,
    get updateCount() { return updateCount; },
    get createCount() { return createCount; },
    send(type, tabId, frameId = 0) {
      return new Promise((resolve, reject) => {
        const tab = fixtureTabs.get(tabId);
        const keepChannel = listeners[0]({ type }, { tab, frameId }, resolve);
        if (keepChannel !== true) reject(new Error(`message_not_handled:${type}`));
      });
    },
  };
}

function runningQueue() {
  return {
    status: "running",
    jobIds: [JOB_ID],
    startedAt: 1700000000000,
  };
}

const adminTabs = [11, 12, 13].map((id) => ({
  id,
  url: `https://kt.shopling.co.kr/admin/home.phtml?tab=${id}`,
}));

test("v0.3.49 grants exactly one A18 coordinator across concurrent admin frames", async () => {
  const runtime = builtRuntime({
    storage: { [QUEUE_KEY]: runningQueue() },
    tabs: adminTabs,
  });
  const results = await Promise.all(
    adminTabs.map((tab) => runtime.send("commerce-os-shopling-market-coordinator-claim-v0349", tab.id)),
  );

  assert.equal(results.filter((row) => row.granted === true).length, 1);
  assert.equal(results.filter((row) => row.granted === false).length, 2);
  assert.equal(runtime.storage[LEASE_KEY].tabId, 11);
  const renewal = await runtime.send("commerce-os-shopling-market-coordinator-claim-v0349", 11);
  assert.equal(renewal.granted, true);
});

test("v0.3.49 reassigns an expired or missing coordinator without creating a second owner", async () => {
  const runtime = builtRuntime({
    storage: {
      [QUEUE_KEY]: runningQueue(),
      [LEASE_KEY]: {
        scope: "queue:1700000000000",
        tabId: 99,
        frameId: 0,
        expiresAt: Date.now() + 60000,
      },
    },
    tabs: adminTabs,
  });

  const first = await runtime.send("commerce-os-shopling-market-coordinator-claim-v0349", 12);
  const second = await runtime.send("commerce-os-shopling-market-coordinator-claim-v0349", 13);
  assert.equal(first.granted, true);
  assert.equal(second.granted, false);
  assert.equal(runtime.storage[LEASE_KEY].tabId, 12);
});

test("v0.3.49 consumes one stale recovery signal by reusing one tab and never opening windows", async () => {
  const runtime = builtRuntime({
    storage: {
      [QUEUE_KEY]: runningQueue(),
      [INTENT_KEY]: {
        status: "pending",
        resumeRunningQueue: true,
        jobIds: [JOB_ID],
        createdAt: Date.now(),
      },
    },
    tabs: adminTabs,
  });

  const results = await Promise.all(
    adminTabs.map((tab) => runtime.send("commerce-os-shopling-market-resume-running-queue-v0349", tab.id)),
  );
  assert.ok(results.every((row) => row.ok === true && row.resumed === true));
  assert.equal(runtime.updateCount, 1, "only one existing admin tab may navigate to A18");
  assert.equal(runtime.createCount, 0, "resume must never create a tab or window");
  assert.match(runtime.fixtureTabs.get(11).url, /goods_mallRegLst\.phtml$/);
  assert.equal(runtime.storage[INTENT_KEY].status, "superseded_single_owner_v0349");
});

test("v0.3.49 serializes a fresh pending intent before any A18 navigation", async () => {
  const runtime = builtRuntime({
    storage: {
      [INTENT_KEY]: {
        status: "pending",
        resumeRunningQueue: false,
        jobIds: [JOB_ID],
        createdAt: Date.now(),
      },
    },
    tabs: adminTabs,
  });

  const results = await Promise.all(
    adminTabs.map((tab) => runtime.send("commerce-os-shopling-market-navigate-a18-v0349", tab.id)),
  );
  assert.ok(results.every((row) => row.ok === true && row.resumed === true));
  assert.equal(runtime.updateCount, 1);
  assert.equal(runtime.createCount, 0);
});

test("v0.3.49 reuses an existing non-worker A18 tab with zero navigation", async () => {
  const runtime = builtRuntime({
    storage: { [QUEUE_KEY]: runningQueue() },
    tabs: [
      { id: 7, url: "https://kt.shopling.co.kr/prodlinkage/goods_mallRegLst.phtml" },
      ...adminTabs,
    ],
  });

  const result = await runtime.send("commerce-os-shopling-market-resume-running-queue-v0349", 11);
  assert.equal(result.reused, true);
  assert.equal(result.controlTabId, 7);
  assert.equal(runtime.updateCount, 0);
  assert.equal(runtime.createCount, 0);
});

test("v0.3.49 package removes periodic pending intents and gates generated A18 runtime", () => {
  const output = buildSingleCoordinatorV0349(fixture());
  const manifest = JSON.parse(output["manifest.json"]);
  assert.equal(manifest.version, "0.3.49");
  assert.doesNotMatch(output["shopling-market-auto-agent.mjs"], /ensureRunningQueueResumeIntentV0348/);
  assert.doesNotMatch(output["shopling-market-auto-agent.mjs"], /resumeRunningQueue:\s*true/);
  assert.match(output["shopling-market-auto-agent.mjs"], /market-resume-running-queue-v0349/);
  assert.match(output["content-group-canary.mjs"], /intent\.resumeRunningQueue === true/);
  assert.match(output["content-group-canary.mjs"], /COORDINATOR_NAVIGATE_MESSAGE_V0349/);
  assert.doesNotMatch(output["content-group-canary.mjs"], /navigationRequestedAt/);
  assert.match(output["content-group-canary.mjs"], /coordinator\.granted !== true/);
  assert.match(output["background-root.mjs"], /marketCoordinatorMutationV0349/);
  for (const name of [
    "shopling-market-auto-agent.mjs",
    "content-group-canary.mjs",
    "background-root.mjs",
  ]) new Function(output[name]);
});
