import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchHf70OptionClaimSource,
  patchHf70OptionListSource,
  patchHf70SingleClaimSource,
  patchHf70SingleListSource,
} from "../src/lib/shoplingStockHf70Patch.ts";
import {
  patchHf72OptionClaimSource,
  patchHf72SingleClaimSource,
} from "../src/lib/shoplingStockHf72Patch.ts";
import {
  patchHf79OptionClaimSource,
  patchHf79OptionListSource,
  patchHf79SingleClaimSource,
  patchHf79SingleListSource,
} from "../src/lib/shoplingStockHf79Patch.ts";

const KT_POPUP =
  "https://kt.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml";

async function optionSource({ hf79 }) {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v050.js",
    "utf8",
  );
  const inherited = patchHf72OptionClaimSource(
    patchHf70OptionClaimSource(base),
  );
  return hf79 ? patchHf79OptionClaimSource(inherited) : inherited;
}

async function claimOptionKt({ hf79, freshTabs }) {
  const source = await optionSource({ hf79 });
  const listeners = [];
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    a21CanonicalStage: "POPUP_OPENING",
    a21PopupBaselineTabIds: [20],
    workTabs: { A21_LIST: { tabId: 10, frameId: 0 } },
    job: {
      jobId: "job-hf79-option",
      productKind: "OPTION",
      goodsKeys: ["111882", "111883"],
    },
    goodsKeyIndex: 0,
    optionCurrentBatchKeys: ["111882", "111883"],
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.42" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async () => freshTabs,
      get: async () => null,
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
      { type: "STOCK_PRICE_CORE_POPUP_CLAIM_V050", href: KT_POPUP },
      { tab: { id: 21, url: KT_POPUP }, frameId: 0 },
      resolve,
    );
    assert.equal(asynchronous, true);
  });
}

async function claimSingleKt({ hf79, freshTabs }) {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v059.js",
    "utf8",
  );
  const inherited = patchHf72SingleClaimSource(
    patchHf70SingleClaimSource(base),
  );
  const source = hf79 ? patchHf79SingleClaimSource(inherited) : inherited;
  const listeners = [];
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    singleA21CanonicalStage: "POPUP_OPENING",
    singleA21PopupBaselineTabIds: [20],
    singleA21ExpectedListTabId: 10,
    workTabs: { A21_LIST: { tabId: 10, frameId: 0 } },
    job: {
      jobId: "job-hf79-single",
      productKind: "SINGLE",
      desiredStatus: "OUT_OF_STOCK",
      goodsKeys: ["122563"],
    },
    goodsKeyIndex: 0,
    singleCurrentBatchKeys: ["122563"],
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.42" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      query: async () => freshTabs,
      get: async () => null,
    },
  };
  new Function(
    "chrome",
    "importScripts",
    "loadActive",
    "saveActive",
    "progress",
    "currentGoodsKey",
    "norm",
    "statusKorean",
    source,
  )(
    chrome,
    () => {},
    async () => active,
    async () => {},
    async () => {},
    (value) => value.job.goodsKeys[value.goodsKeyIndex],
    (value) => String(value || "").trim(),
    () => "품절",
  );
  return new Promise((resolve) => {
    const asynchronous = listeners.at(-1)(
      { type: "STOCK_SINGLE_POPUP_CLAIM_V012", href: KT_POPUP },
      { tab: { id: 21, url: KT_POPUP }, frameId: 0 },
      resolve,
    );
    assert.equal(asynchronous, true);
  });
}

test("HF79 reproduces the live failure: HF78 injects the kt popup content but inherited background claims reject kt", async () => {
  const freshTabs = [{ id: 21, url: KT_POPUP }];
  const [option, single] = await Promise.all([
    claimOptionKt({ hf79: false, freshTabs }),
    claimSingleKt({ hf79: false, freshTabs }),
  ]);
  assert.equal(option.ok, false);
  assert.equal(option.error, "stock_price_core_popup_target_mismatch");
  assert.equal(single.ok, false);
  assert.equal(single.error, "stock_single_popup_target_mismatch");
});

test("HF79 gives the unique fresh kt OPTION and SINGLE popup its assignment", async () => {
  const freshTabs = [{ id: 21, url: KT_POPUP }];
  const [option, single] = await Promise.all([
    claimOptionKt({ hf79: true, freshTabs }),
    claimSingleKt({ hf79: true, freshTabs }),
  ]);
  assert.equal(option.ok, true);
  assert.equal(option.assignment.mode, "OPTION");
  assert.equal(option.assignment.goodsKey, "111882");
  assert.equal(single.ok, true);
  assert.equal(single.assignment.goodsKey, "122563");
  assert.deepEqual(single.assignment.goodsKeys, ["122563"]);
});

test("HF79 keeps popup ownership fail-closed for stale and ambiguous kt candidates", async () => {
  const stale = await claimOptionKt({
    hf79: true,
    freshTabs: [{ id: 20, url: KT_POPUP }],
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "stock_price_core_popup_owner_mismatch_hf70");

  const ambiguous = await claimSingleKt({
    hf79: true,
    freshTabs: [
      { id: 21, url: KT_POPUP },
      { id: 22, url: KT_POPUP },
    ],
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error, "stock_single_popup_owner_mismatch_hf70");
});

test("HF79 expands pre-click popup discovery on OPTION and SINGLE lanes to both Shopling admin hosts", async () => {
  const [optionBase, singleBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/background-v053.js", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v056.js", "utf8"),
  ]);
  const option = patchHf79OptionListSource(
    patchHf70OptionListSource(optionBase),
  );
  const single = patchHf79SingleListSource(
    patchHf70SingleListSource(singleBase),
  );
  for (const source of [option, single]) {
    assert.match(source, /https:\/\/a\.shopling\.co\.kr/);
    assert.match(source, /https:\/\/kt\.shopling\.co\.kr/);
    new Function(source);
  }
});

test("HF79 package remains reproducible while HF80 becomes the current production gate", async () => {
  const [route, page, planner, workflow] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf79/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile(".github/workflows/shopling-stock-state-sync-ci.yml", "utf8"),
  ]);
  assert.match(route, /const BASE_VERSION = "0\.6\.41"/);
  assert.match(route, /const VERSION = "0\.6\.42"/);
  assert.match(route, /KT_POPUP_CONTENT_LOADED_BUT_BACKGROUND_CLAIM/);
  assert.match(route, /GROUPED_BY_TRANSMISSION_KIND_UP_TO_200/);
  assert.match(route, /A21_PROCESSING_OR_RESULT_SCREEN_STARTED_PER_GROUP/);
  assert.match(route, /marketplaceCompletionRequired: false/);
  assert.match(page, /download-hf80/);
  assert.match(page, /v0\.6\.43 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 43\]/);
  assert.match(workflow, /shoplingStockStateHf79\.test\.mjs/);
});

