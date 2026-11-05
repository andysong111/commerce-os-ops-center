import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchShoplingStockHf58DispatchAcceptance,
  patchShoplingStockHf58PopupOwnership,
} from "../src/lib/shoplingStockHf58Patch.ts";

test("HF58 packages v0.6.21 and makes the owner processing screen the terminal boundary", async () => {
  const [route, patch, page, planner] = await Promise.all([
    readFile(
      "src/app/api/shopling-stock-state-sync/download-hf58/route.ts",
      "utf8",
    ),
    readFile("src/lib/shoplingStockHf58Patch.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
  ]);

  assert.match(route, /getHf57Download/);
  assert.match(route, /const BASE_VERSION = "0\.6\.20"/);
  assert.match(route, /const VERSION = "0\.6\.21"/);
  assert.match(route, /SHOPLING_PROCESSING_SCREEN_OR_RESULT_NAVIGATION/);
  assert.match(route, /foreignProcessingPopupsBlockCurrentJob: false/);
  assert.match(patch, /SHOPLING_PROCESSING_SCREEN_ACCEPTED_HF58/);
  assert.match(patch, /popupOwnershipScope: "EXACT_OPENER_TAB_HF58"/);
  assert.match(page, /download-hf73/);
  assert.match(page, /v0\.6\.36 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 36\]/);
});

async function runPopupPreflight({ popups, inspections, senderTabId = 900 }) {
  const original = await readFile(
    "public/shopling-stock-state-sync/background-v077.js",
    "utf8",
  );
  const source = patchShoplingStockHf58PopupOwnership(original);
  const listeners = [];
  const removed = [];
  let existing = [...popups];
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.21" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async (query) => (query?.url ? existing : []),
      remove: async (tabId) => {
        removed.push(tabId);
        existing = existing.filter((tab) => tab.id !== tabId);
      },
      get: async (tabId) => existing.find((tab) => tab.id === tabId) || null,
    },
    scripting: {
      executeScript: async ({ target }) => [
        { result: inspections[target.tabId] },
      ],
    },
  };
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    workTabs: { A21_LIST: { tabId: 900, frameId: 0 } },
    shoplingTabId: 900,
    job: {
      jobId: "stock-resend:incident:BAF1-1:SOLD_OUT",
      barcode: "BAF1-1",
      productKind: "SINGLE",
    },
  };
  new Function(
    "chrome",
    "importScripts",
    "setTimeout",
    "loadActive",
    "finish",
    source,
  )(
    chrome,
    () => {},
    () => 1,
    async () => active,
    async () => null,
  );

  const response = await new Promise((resolve) => {
    const asynchronous = listeners.at(-1)(
      {
        type: "A21_STALE_POPUP_PREFLIGHT_HF53",
        jobId: active.job.jobId,
      },
      { tab: { id: senderTabId } },
      resolve,
    );
    assert.equal(asynchronous, true);
  });
  return { response, removed };
}

const processingInspection = {
  terminal: false,
  processing: true,
  staleMarker: true,
  hasTransmitForm: true,
  generalChecked: true,
  mutationModeChecked: false,
};
const safeStaleInspection = {
  terminal: false,
  processing: false,
  staleMarker: true,
  hasTransmitForm: true,
  generalChecked: true,
  mutationModeChecked: false,
};

test("HF58 regression: another lane's processing popup does not block the current B-code", async () => {
  const { response, removed } = await runPopupPreflight({
    popups: [
      { id: 417, openerTabId: 111 },
      { id: 418, openerTabId: 900 },
    ],
    inspections: {
      417: processingInspection,
      418: safeStaleInspection,
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.ignoredForeignPopupTabIds, [417]);
  assert.deepEqual(response.closedSafeStalePopupTabIds, [418]);
  assert.deepEqual(removed, [418]);
});

test("HF58 still fails closed for a processing popup owned by the current B-code", async () => {
  const { response, removed } = await runPopupPreflight({
    popups: [{ id: 419, openerTabId: 900 }],
    inspections: { 419: processingInspection },
  });

  assert.equal(response.ok, false);
  assert.equal(response.code, "A21_EXISTING_POPUP_NOT_SAFE_TO_CLOSE_HF53");
  assert.deepEqual(removed, []);
});

test("HF58 refuses a preflight message from a different A21 list tab", async () => {
  const { response, removed } = await runPopupPreflight({
    popups: [],
    inspections: {},
    senderTabId: 901,
  });

  assert.equal(response.ok, false);
  assert.equal(response.code, "A21_POPUP_OWNER_TAB_MISMATCH_HF58");
  assert.deepEqual(removed, []);
});

async function runResultNavigation({ openerTabId }) {
  const original = await readFile(
    "public/shopling-stock-state-sync/background-v079.js",
    "utf8",
  );
  const source = patchShoplingStockHf58DispatchAcceptance(original);
  const updatedListeners = [];
  const finished = [];
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    workTabs: { A21_LIST: { tabId: 900, frameId: 0 } },
    shoplingTabId: 900,
    job: {
      jobId: "stock-resend:incident:BAF1-1:SOLD_OUT",
      barcode: "BAF1-1",
      productKind: "SINGLE",
      desiredStatus: "SOLD_OUT",
    },
  };
  const resultUrl =
    "https://a.shopling.co.kr/prod_a/prod_status_trsmt.phtml";
  const chrome = {
    runtime: { getManifest: () => ({ version: "0.6.21" }) },
    tabs: {
      get: async (tabId) => ({ id: tabId, openerTabId, url: resultUrl }),
      onCreated: { addListener: () => {} },
      onUpdated: { addListener: (listener) => updatedListeners.push(listener) },
    },
    webNavigation: {
      onCommitted: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
    },
  };
  new Function(
    "chrome",
    "importScripts",
    "setTimeout",
    "loadActive",
    "saveActive",
    "finish",
    "statusKorean",
    source,
  )(
    chrome,
    () => {},
    (callback) => {
      callback();
      return 1;
    },
    async () => active,
    async () => null,
    async (_job, outcome, message, evidence) => {
      finished.push({ outcome, message, evidence });
    },
    () => "품절",
  );

  updatedListeners.at(-1)(501, { url: resultUrl }, { id: 501, url: resultUrl });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return finished;
}

test("HF58 marks success as soon as the current B-code opens Shopling's processing/result screen", async () => {
  const finished = await runResultNavigation({ openerTabId: 900 });
  assert.equal(finished.length, 1);
  assert.equal(finished[0].outcome, "SUCCEEDED");
  assert.equal(
    finished[0].evidence.code,
    "SHOPLING_PROCESSING_SCREEN_ACCEPTED_HF58",
  );
  assert.equal(
    finished[0].evidence.processingScreenOrResultPageAccepted,
    true,
  );
  assert.equal(finished[0].evidence.marketplaceCompletionRequired, false);
});

test("HF58 cannot credit another B-code's processing/result screen to the active job", async () => {
  const finished = await runResultNavigation({ openerTabId: 111 });
  assert.deepEqual(finished, []);
});
