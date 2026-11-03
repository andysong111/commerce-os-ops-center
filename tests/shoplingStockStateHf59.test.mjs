import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorkerHarness({ senderTabId = 501, recoverOnStart = false } = {}) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v081.js",
    "utf8",
  );
  const finished = [];
  const active = {
    status: "RUNNING",
    stage: "WAIT_A21_RESULT",
    shoplingTabId: 900,
    workTabs: {
      A21_LIST: { tabId: 900, frameId: 0 },
      A21_POPUP: { tabId: 501, frameId: 0 },
    },
    optionCurrentBatchStart: 0,
    optionCurrentBatchKeys: ["120461"],
    job: {
      jobId: "stock-resend:incident:BAF1-1:SOLD_OUT",
      barcode: "BAF1-1",
      productKind: "OPTION",
      desiredStatus: "SOLD_OUT",
      optionApiApplied: true,
      goodsKeys: ["120461"],
    },
  };
  const updatedListeners = [];
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.22" }),
      onInstalled: { addListener: () => {} },
    },
    tabs: {
      get: async (tabId) => ({
        id: tabId,
        openerTabId: tabId === 501 ? 900 : 111,
        url: "https://a.shopling.co.kr/prod_a/prod_status_trsmt.phtml",
      }),
      onUpdated: { addListener: (listener) => updatedListeners.push(listener) },
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            href: "https://a.shopling.co.kr/prod_a/prod_status_trsmt.phtml",
            processing: true,
          },
        },
      ],
    },
  };
  const setTimeoutStub = (callback, delay) => {
    if (recoverOnStart && delay <= 2_000) queueMicrotask(callback);
    return 1;
  };
  const legacyCalls = [];
  const factory = new Function(
    "chrome",
    "importScripts",
    "setTimeout",
    "loadActive",
    "saveActive",
    "finish",
    "handleEvidence",
    `${source}\nreturn handleEvidence;`,
  );
  const handler = factory(
    chrome,
    () => {},
    setTimeoutStub,
    async () => active,
    async () => null,
    async (_job, outcome, message, evidence) => {
      active.status = outcome;
      finished.push({ outcome, message, evidence });
    },
    async (message, sender) => {
      legacyCalls.push({ message, sender });
      return { ok: true, legacy: true };
    },
  );
  return { active, finished, handler, legacyCalls, senderTabId, updatedListeners };
}

test("HF59 accepts same-popup processing evidence as Commerce OS dispatch completion", async () => {
  const harness = await loadWorkerHarness();
  const result = await harness.handler(
    { evidence: { processing: true } },
    { tab: { id: harness.senderTabId }, frameId: 0 },
  );
  assert.equal(result.processingScreenAccepted, true);
  assert.equal(harness.finished.length, 1);
  assert.equal(harness.finished[0].outcome, "SUCCEEDED");
  assert.equal(
    harness.finished[0].evidence.code,
    "SHOPLING_PROCESSING_SCREEN_ACCEPTED_HF59",
  );
  assert.equal(
    harness.finished[0].evidence.marketplaceCompletionRequired,
    false,
  );
});

test("HF59 never credits another B-code's processing popup", async () => {
  const harness = await loadWorkerHarness({ senderTabId: 777 });
  const result = await harness.handler(
    { evidence: { processing: true } },
    { tab: { id: 777 }, frameId: 0 },
  );
  assert.equal(result.legacy, true);
  assert.equal(harness.finished.length, 0);
  assert.equal(harness.legacyCalls.length, 1);
});

test("HF59 recovers an already visible owner processing screen after extension reload", async () => {
  const harness = await loadWorkerHarness({ recoverOnStart: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.finished.length, 1);
  assert.equal(harness.finished[0].outcome, "SUCCEEDED");
  assert.equal(
    harness.finished[0].evidence.observedEvidence.recoveredAfterWorkerStart,
    true,
  );
});

test("HF59 download route publishes v0.6.22 and the exact responsibility boundary", async () => {
  const [route, page, planner] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf59/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.21"/);
  assert.match(route, /const VERSION = "0\.6\.22"/);
  assert.match(route, /samePopupProcessingEvidenceAccepted: true/);
  assert.match(route, /workerStartRecovery: true/);
  assert.match(route, /marketplaceCompletionRequired: false/);
  assert.match(page, /download-hf61/);
  assert.match(page, /v0\.6\.24 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 24\]/);
});
