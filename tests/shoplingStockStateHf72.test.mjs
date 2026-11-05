import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildHf72TransmissionGroups,
  patchHf72LegacyProcessingObserverSource,
  patchHf72LegacyResultNavigationObserverSource,
  patchHf72OptionClaimSource,
  patchHf72PopupPreflightSource,
  patchHf72ResultObserverSource,
  patchHf72SingleClaimSource,
} from "../src/lib/shoplingStockHf72Patch.ts";
import {
  patchHf70OptionClaimSource,
  patchHf70SingleClaimSource,
} from "../src/lib/shoplingStockHf70Patch.ts";
import { patchShoplingStockHf58PopupOwnership } from "../src/lib/shoplingStockHf58Patch.ts";

function row(goodsKey, transmissionKind, optionCount) {
  return {
    goodsKey: String(goodsKey),
    transmissionKind,
    effectiveProductKind:
      transmissionKind === "OPTION_SEND" ? "OPTION" : "SINGLE",
    optionCount,
  };
}

test("HF72 groups every API-classified goods key by compatible A21 mode and chunks only above 200", () => {
  const optionRows = Array.from({ length: 14 }, (_, index) =>
    row(11000 + index, "OPTION_SEND", 2),
  );
  const oneGroup = buildHf72TransmissionGroups(optionRows);
  assert.equal(oneGroup.length, 1);
  assert.equal(oneGroup[0].transmissionKind, "OPTION_SEND");
  assert.equal(oneGroup[0].goodsKeys.length, 14);
  assert.deepEqual(oneGroup[0].chunks.map((chunk) => chunk.length), [14]);

  const mixed = buildHf72TransmissionGroups([
    row(12001, "PRODUCT_SALE_STATUS_SEND", 1),
    row(12002, "OPTION_SEND", 3),
    row(12003, "PRODUCT_SALE_STATUS_SEND", 1),
    row(12004, "OPTION_SEND", 2),
  ]);
  assert.deepEqual(
    mixed.map((group) => [group.transmissionKind, group.goodsKeys]),
    [
      ["OPTION_SEND", ["12002", "12004"]],
      ["PRODUCT_SALE_STATUS_SEND", ["12001", "12003"]],
    ],
  );

  const oversized = buildHf72TransmissionGroups(
    Array.from({ length: 201 }, (_, index) =>
      row(20000 + index, "OPTION_SEND", 2),
    ),
  );
  assert.deepEqual(oversized[0].chunks.map((chunk) => chunk.length), [200, 1]);
  assert.throws(
    () =>
      buildHf72TransmissionGroups([
        row(30001, "OPTION_SEND", 2),
        row(30001, "OPTION_SEND", 2),
      ]),
    /HF72_GOODS_KEY_INVALID_OR_DUPLICATE/,
  );
});

test("HF72 popup ownership accepts one fresh exact popup with a missing intermediary but rejects stale or ambiguous popups", async () => {
  const [optionBase, singleBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v050.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v059.js", "utf8"),
  ]);
  const option = patchHf72OptionClaimSource(
    patchHf70OptionClaimSource(optionBase),
  );
  const single = patchHf72SingleClaimSource(
    patchHf70SingleClaimSource(singleBase),
  );
  for (const source of [option, single]) {
    assert.match(source, /fresh\.length !== 1/);
    assert.match(source, /baseline\.has\(tabId\)/);
    assert.match(source, /if \(!Number\.isInteger\(openerTabId\)\) return true/);
    assert.match(source, /if \(!opener\) return true/);
    assert.match(source, /if \(!Number\.isInteger\(next\)\) return false/);
    new Function(source);
  }
});

async function optionClaimResultHf72({
  candidateTabId = 21,
  freshTabs,
  openerTabs = {},
}) {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v050.js",
    "utf8",
  );
  const source = patchHf72OptionClaimSource(
    patchHf70OptionClaimSource(base),
  );
  const listeners = [];
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    a21CanonicalStage: "POPUP_OPENING",
    a21PopupBaselineTabIds: [20],
    workTabs: { A21_LIST: { tabId: 10, frameId: 0 } },
    job: {
      jobId: "job-hf72-popup",
      productKind: "OPTION",
      goodsKeys: ["120867", "120868"],
    },
    goodsKeyIndex: 0,
    optionCurrentBatchKeys: ["120867", "120868"],
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.35" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async () => freshTabs,
      get: async (tabId) => openerTabs[tabId] ?? null,
    },
  };
  new Function(
    "chrome",
    "importScripts",
    "dispatchCurrent",
    "loadActive",
    "saveActive",
    "progress",
    "currentGoodsKey",
    "finish",
    "handleEvidence",
    source,
  )(
    chrome,
    () => {},
    async () => true,
    async () => active,
    async () => {},
    async () => {},
    (value) => value.job.goodsKeys[value.goodsKeyIndex],
    async () => ({}),
    async () => ({}),
  );
  return new Promise((resolve) => {
    const asynchronous = listeners.at(-1)(
      {
        type: "STOCK_PRICE_CORE_POPUP_CLAIM_V050",
        href: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml",
      },
      { tab: { id: candidateTabId }, frameId: 0 },
      resolve,
    );
    assert.equal(asynchronous, true);
  });
}

test("HF72 claims exactly one fresh popup after the proven red submit click even when Shopling omits or closes the intermediary opener", async () => {
  const exactUrl =
    "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml";
  const missingOpener = await optionClaimResultHf72({
    freshTabs: [{ id: 21, url: exactUrl }],
  });
  assert.equal(missingOpener.ok, true);
  assert.equal(missingOpener.assignment.goodsKey, "120867");
  assert.equal(missingOpener.assignment.mode, "OPTION");

  const closedIntermediary = await optionClaimResultHf72({
    freshTabs: [{ id: 21, openerTabId: 30, url: exactUrl }],
  });
  assert.equal(closedIntermediary.ok, true);

  const ambiguous = await optionClaimResultHf72({
    freshTabs: [
      { id: 21, url: exactUrl },
      { id: 22, url: exactUrl },
    ],
  });
  assert.equal(ambiguous.ok, false);

  const stale = await optionClaimResultHf72({
    candidateTabId: 20,
    freshTabs: [{ id: 21, url: exactUrl }],
  });
  assert.equal(stale.ok, false);

  const unrelatedLiveOwner = await optionClaimResultHf72({
    freshTabs: [{ id: 21, openerTabId: 99, url: exactUrl }],
    openerTabs: { 99: { id: 99 } },
  });
  assert.equal(unrelatedLiveOwner.ok, false);
});

async function popupPreflightHandoffHf72({ acceptedPopupTabIds = [] } = {}) {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v077.js",
    "utf8",
  );
  const source = patchHf72PopupPreflightSource(
    patchShoplingStockHf58PopupOwnership(base),
  );
  const listeners = [];
  const removed = [];
  const processingPopup = {
    id: 417,
    openerTabId: 900,
    url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml",
  };
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    workTabs: { A21_LIST: { tabId: 900, frameId: 0 } },
    shoplingTabId: 900,
    stockStateAcceptedPopupTabIdsHf72: acceptedPopupTabIds,
    job: {
      jobId: "job-hf72-popup-handoff",
      barcode: "BBC4-3",
      productKind: "SINGLE",
    },
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.35" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async (query) => (query?.url ? [processingPopup] : []),
      get: async (tabId) => (tabId === processingPopup.id ? processingPopup : null),
      remove: async (tabId) => removed.push(tabId),
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            terminal: false,
            processing: true,
            staleMarker: false,
            hasTransmitForm: false,
            generalChecked: false,
            mutationModeChecked: true,
          },
        },
      ],
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
      { tab: { id: 900 } },
      resolve,
    );
    assert.equal(asynchronous, true);
  });
  return { response, removed, source };
}

test("HF72 hands the exact accepted processing popup across groups without closing it, while unknown processing popups still fail closed", async () => {
  const accepted = await popupPreflightHandoffHf72({
    acceptedPopupTabIds: [417],
  });
  assert.equal(accepted.response.ok, true);
  assert.deepEqual(accepted.response.retiredAcceptedPopupTabIdsHf72, [417]);
  assert.equal(
    accepted.response.popupOwnershipScope,
    "EXACT_OPENER_TAB_WITH_ACCEPTED_HANDOFF_HF72",
  );
  assert.deepEqual(accepted.removed, []);
  assert.match(accepted.source, /acceptedPopupTabIdsHf72\.has\(tab\.id\)/);

  const unknown = await popupPreflightHandoffHf72();
  assert.equal(unknown.response.ok, false);
  assert.equal(
    unknown.response.code,
    "A21_EXISTING_POPUP_NOT_SAFE_TO_CLOSE_HF53",
  );
  assert.deepEqual(unknown.removed, []);
});

test("HF72 accepts each claimed processing screen as one batch receipt, then continues instead of finishing the whole B-code early", async () => {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v082.js",
    "utf8",
  );
  const patched = patchHf72ResultObserverSource(base);
  assert.match(patched, /PERSISTED_CLAIMED_POPUP_HF72/);
  assert.match(patched, /SHOPLING_PROCESSING_OR_RESULT_ACCEPTED_HF72/);
  assert.match(patched, /const advanced = await continueNextGoodsKey/);
  assert.match(patched, /active\.stockStateGroupIndexHf72/);
  assert.match(patched, /shoplingResultBaselineTabIdsHf72/);
  assert.doesNotMatch(
    patched,
    /await finish\(\s*latest,\s*"SUCCEEDED",\s*`\$\{latest\.job\.barcode\} · Shopling 처리화면/,
  );
  new Function(patched);
});

test("HF72 rejects a prior-batch direct result tab and accepts only a fresh current-batch result", async () => {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v082.js",
    "utf8",
  );
  const source = patchHf72ResultObserverSource(base);
  const resultUrl =
    "https://shopling.co.kr/prod_a/prod_status_trsmt.phtml?test=hf72";
  const tabs = new Map([
    [10, { id: 10, url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy.phtml" }],
    [22, { id: 22, openerTabId: 10, url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml" }],
    [31, { id: 31, openerTabId: 10, url: resultUrl }],
    [32, { id: 32, openerTabId: 10, url: resultUrl }],
  ]);
  const active = {
    status: "RUNNING",
    stage: "WAIT_A21_RESULT",
    stockStateGroupIndexHf72: 1,
    goodsKeyIndex: 0,
    shoplingResultBaselineTabIdsHf72: [31],
    workTabs: {
      A21_LIST: { tabId: 10, frameId: 0 },
      A21_POPUP: { tabId: 22, frameId: 0 },
    },
    job: {
      jobId: "job-hf72-result-baseline",
      barcode: "BBC4-3",
      productKind: "SINGLE",
      goodsKeys: ["111882"],
      stockStateTransmissionGroupsHf72: [
        { transmissionKind: "OPTION_SEND", goodsKeys: ["111881"] },
        { transmissionKind: "PRODUCT_SALE_STATUS_SEND", goodsKeys: ["111882"] },
      ],
    },
  };
  let continued = 0;
  let handleEvidence = async () => ({ ok: false, legacy: true });
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.35" }),
      onInstalled: { addListener: () => {} },
    },
    tabs: {
      get: async (tabId) => tabs.get(tabId) || null,
      query: async () => [tabs.get(31), tabs.get(32)],
      onCreated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
    },
    webNavigation: {
      onCommitted: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
    },
    scripting: { executeScript: async () => [] },
  };
  handleEvidence = new Function(
    "chrome",
    "importScripts",
    "handleEvidence",
    "loadActive",
    "saveActive",
    "continueNextGoodsKey",
    "setTimeout",
    `${source}; return handleEvidence;`,
  )(
    chrome,
    () => {},
    handleEvidence,
    async () => active,
    async () => {},
    async () => {
      continued += 1;
      return { ok: true };
    },
    () => 0,
  );

  const stale = await handleEvidence(
    { evidence: { processing: true } },
    { tab: { id: 31 }, frameId: 0 },
  );
  assert.equal(stale.legacy, true);
  assert.equal(continued, 0);

  const fresh = await handleEvidence(
    { evidence: { processing: true } },
    { tab: { id: 32 }, frameId: 0 },
  );
  assert.equal(fresh.processingScreenAccepted, true);
  assert.equal(continued, 1);
});

test("HF72 disables inherited terminal observers so the first compatible group cannot finish a mixed job", async () => {
  const [navigationBase, processingBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v079.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v081.js", "utf8"),
  ]);
  const navigation = patchHf72LegacyResultNavigationObserverSource(navigationBase);
  const processing = patchHf72LegacyProcessingObserverSource(processingBase);
  for (const source of [navigation, processing]) {
    assert.match(source, /stockStateTransmissionGroupsHf72/);
    assert.match(source, /length > 0/);
    new Function(source);
  }
  assert.match(navigation, /const groupedActive = await loadActive\(\)/);
  assert.match(processing, /Array\.isArray\(active\?\.job\?\.stockStateTransmissionGroupsHf72\)/);
});

test("HF72 preserves a reduced batch limit during retry and resets it only for the next transmission group", async () => {
  const source = await readFile(
    "public/shopling-stock-state-sync/background-v092.js",
    "utf8",
  );
  assert.match(source, /stockStatePreparedGroupIndexHf72/);
  assert.match(source, /shoplingResultBaselineBatchKeyHf72/);
  assert.match(source, /stockStateAcceptedPopupTabIdsHf72/);
  assert.match(source, /SHOPLING_HF72_ACCEPTED_POPUP_IDENTITY_MISMATCH/);
  assert.match(source, /RESULT_MATCH_V092/);
  assert.match(source, /if \(groupChanged\)/);
  assert.match(source, /start \+ limit/);
  assert.doesNotMatch(
    source,
    /active\.optionBatchLimit = BATCH_MAX_V092;\s*active\.singleBatchLimit = BATCH_MAX_V092;\s*return Number/,
  );
  new Function(source);
});

test("HF72 package exposes grouped dispatch, current gate, and one canonical Shopling submit call", async () => {
  const [route, background, optionBatch, singleBatch, main, page, planner, workflow] =
    await Promise.all([
      readFile("src/app/api/shopling-stock-state-sync/download-hf72/route.ts", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v092.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v071.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v057.js", "utf8"),
      readFile("public/shopling-stock-state-sync/price-core-main-a21-v025.js", "utf8"),
      readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
      readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
      readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
    ]);
  assert.match(route, /const VERSION = "0\.6\.35"/);
  assert.match(route, /GROUPED_BY_TRANSMISSION_KIND_UP_TO_200/);
  assert.match(route, /A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP/);
  assert.match(background, /BATCH_MAX_V092 = 200/);
  assert.match(background, /stockStateTransmissionGroupsHf72/);
  assert.match(background, /stockStateAllGoodsKeysHf72/);
  assert.match(background, /stockStatePreparedGroupIndexHf72/);
  assert.match(route, /LEGACY_RESULT_NAV_OBSERVER/);
  assert.match(route, /LEGACY_PROCESSING_OBSERVER/);
  assert.match(optionBatch, /goodsKeys: batch/);
  assert.match(singleBatch, /goodsKeys: batch/);
  assert.equal(
    [...main.matchAll(/window\.goods_mallMdfy_submit_sp\(\);/g)].length,
    1,
  );
  assert.match(page, /download-hf72/);
  assert.match(page, /v0\.6\.35 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 35\]/);
  assert.match(workflow, /shoplingStockStateHf72\.test\.mjs/);
  new Function(background);
});
