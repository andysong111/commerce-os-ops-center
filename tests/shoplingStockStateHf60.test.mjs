import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorkerHarness({
  senderTabId = 601,
  resultOpenerTabId = 501,
  popupPresent = true,
  recoverOnStart = false,
} = {}) {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v082.js",
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
    optionCurrentBatchKeys: ["120867", "120868"],
    job: {
      jobId: "stock-resend:incident:BCD8-2:SOLD_OUT",
      barcode: "BCD8-2",
      productKind: "OPTION",
      desiredStatus: "SOLD_OUT",
      optionApiApplied: true,
      goodsKeys: ["120867", "120868"],
    },
  };
  const resultTab = {
    id: 601,
    openerTabId: resultOpenerTabId,
    windowId: 71,
    url: "https://oapi1.shopling.co.kr/prod_a/prod_status_trsmt.phtml",
  };
  const tabs = new Map([
    [900, { id: 900, windowId: 70, url: "https://a.shopling.co.kr/" }],
    [601, resultTab],
  ]);
  if (popupPresent) {
    tabs.set(501, {
      id: 501,
      openerTabId: 900,
      windowId: 71,
      url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml",
    });
  }
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.23" }),
      onInstalled: { addListener: () => {} },
    },
    tabs: {
      get: async (tabId) => tabs.get(tabId) || null,
      query: async () => [resultTab],
      onCreated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
    },
    webNavigation: {
      onCommitted: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
    },
    scripting: {
      executeScript: async () => [],
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
  return { active, finished, handler, legacyCalls, senderTabId };
}

test("HF60 accepts the real A21-list -> popup -> oapi1 result chain", async () => {
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
    "SHOPLING_NESTED_RESULT_ACCEPTED_HF60",
  );
  assert.equal(
    harness.finished[0].evidence.popupOwnershipScope,
    "A21_LIST_TO_POPUP_TO_RESULT_HF60",
  );
  assert.equal(
    harness.finished[0].evidence.commerceOsResponsibilityComplete,
    true,
  );
});

test("HF60 rejects a result tab whose opener is not the current job popup", async () => {
  const harness = await loadWorkerHarness({ resultOpenerTabId: 777 });
  const result = await harness.handler(
    { evidence: { processing: true } },
    { tab: { id: harness.senderTabId }, frameId: 0 },
  );
  assert.equal(result.legacy, true);
  assert.equal(harness.finished.length, 0);
  assert.equal(harness.legacyCalls.length, 1);
});

test("HF60 recovers the owned nested result after reload even if its popup closed", async () => {
  const harness = await loadWorkerHarness({
    popupPresent: false,
    recoverOnStart: true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.finished.length, 1);
  assert.equal(harness.finished[0].outcome, "SUCCEEDED");
  assert.equal(
    harness.finished[0].evidence.popupOwnershipScope,
    "PERSISTED_OWNER_POPUP_TO_RESULT_HF60",
  );
});

test("HF60 download route publishes v0.6.23 and nested owner-chain recovery", async () => {
  const [route, page, planner] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf60/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.22"/);
  assert.match(route, /const VERSION = "0\.6\.23"/);
  assert.match(route, /nestedResultOwnerChainAccepted: true/);
  assert.match(route, /marketplaceCompletionRequired: false/);
  assert.match(page, /download-hf74/);
  assert.match(page, /v0\.6\.37 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 37\]/);
});
