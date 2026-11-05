import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildHf72TransmissionGroups,
  patchHf72OptionClaimSource,
  patchHf72ResultObserverSource,
  patchHf72SingleClaimSource,
} from "../src/lib/shoplingStockHf72Patch.ts";
import {
  patchHf70OptionClaimSource,
  patchHf70SingleClaimSource,
} from "../src/lib/shoplingStockHf70Patch.ts";

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
  assert.doesNotMatch(
    patched,
    /await finish\(\s*latest,\s*"SUCCEEDED",\s*`\$\{latest\.job\.barcode\} · Shopling 처리화면/,
  );
  new Function(patched);
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
