import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  patchHf70A21ContentSource,
  patchHf70A21MainSource,
  patchHf70OptionClaimSource,
  patchHf70OptionListSource,
  patchHf70SingleClaimSource,
  patchHf70SingleListSource,
} from "../src/lib/shoplingStockHf70Patch.ts";
import {
  patchHf69A21ContentSource,
  patchHf69A21MainSource,
} from "../src/lib/shoplingStockHf69Patch.ts";

async function hf70Workers() {
  const [contentBase, mainBase] = await Promise.all([
    readFile("public/shopling-stock-state-sync/price-core-content-a21-v025.js", "utf8"),
    readFile("public/shopling-stock-state-sync/price-core-main-a21-v025.js", "utf8"),
  ]);
  return {
    content: patchHf70A21ContentSource(patchHf69A21ContentSource(contentBase)),
    main: patchHf70A21MainSource(patchHf69A21MainSource(mainBase)),
  };
}

test("HF70 regression: the shared top row can never identify the leftmost radio as 옵션송신", async () => {
  const { content, main } = await hf70Workers();
  const sandbox = { __COMMERCE_OS_EXPOSE_A21_V025_TEST_HOOKS__: true };
  new Function("globalThis", content)(sandbox);
  const hooks = sandbox.__commerceOsA21V025TestHooks;
  assert.ok(hooks);

  assert.equal(hooks.isExactOptionModeCell("옵션송신", 1), true);
  assert.equal(
    hooks.isExactOptionModeCell(
      "일반내용수정 상품판매상태송신 옵션송신",
      3,
    ),
    false,
  );

  const contentMode = content.slice(
    content.indexOf("function exactOptionModeOwner"),
    content.indexOf("function optionFieldRows"),
  );
  const mainMode = main.slice(
    main.indexOf("function semanticModeMatches"),
    main.indexOf("function semanticFieldMatches"),
  );
  assert.match(
    contentMode,
    /isExactOptionModeCell\(node\.textContent, controls\.length\)/,
  );
  assert.match(contentMode, /candidates\.length === 1 \? candidates\[0\] : null/);
  assert.doesNotMatch(contentMode, /closest\?\.\("tr"\)/);
  assert.match(mainMode, /unique\.length === 1 && unique\[0\] === control/);
  assert.doesNotMatch(mainMode, /closest\?\.\("tr"\)/);
  new Function(content);
  new Function(main);
});

async function optionClaimResult({ candidateTabId, openerTabId }) {
  const base = await readFile(
    "public/shopling-stock-state-sync/background-v050.js",
    "utf8",
  );
  const source = patchHf70OptionClaimSource(base);
  const listeners = [];
  const active = {
    status: "RUNNING",
    stage: "A21_LIST",
    a21CanonicalStage: "POPUP_OPENING",
    a21PopupBaselineTabIds: [20],
    workTabs: { A21_LIST: { tabId: 10, frameId: 0 } },
    job: {
      jobId: "job-hf70",
      productKind: "OPTION",
      goodsKeys: ["120867"],
    },
    goodsKeyIndex: 0,
  };
  const chrome = {
    runtime: {
      getManifest: () => ({ version: "0.6.33" }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    tabs: {
      get: async (tabId) => ({
        id: tabId,
        openerTabId,
        url: "https://a.shopling.co.kr/prodlinkage/goods_mallMdfy_trsmt.phtml",
      }),
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
  const listener = listeners.at(-1);
  return new Promise((resolve) => {
    const asynchronous = listener(
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

test("HF70 accepts only the fresh popup opened by the exact current A21 list tab", async () => {
  const stale = await optionClaimResult({ candidateTabId: 20, openerTabId: 10 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "stock_price_core_popup_owner_mismatch_hf70");

  const wrongOwner = await optionClaimResult({ candidateTabId: 21, openerTabId: 99 });
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.error, "stock_price_core_popup_owner_mismatch_hf70");

  const freshOwned = await optionClaimResult({ candidateTabId: 21, openerTabId: 10 });
  assert.equal(freshOwned.ok, true);
  assert.equal(freshOwned.assignment.goodsKey, "120867");
  assert.equal(freshOwned.assignment.mode, "OPTION");
});

test("HF70 records pre-click popup baselines for OPTION and SINGLE lanes", async () => {
  const [optionClaimBase, optionListBase, singleListBase, singleClaimBase] =
    await Promise.all([
      readFile("public/shopling-stock-state-sync/background-v050.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v053.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v056.js", "utf8"),
      readFile("public/shopling-stock-state-sync/background-v059.js", "utf8"),
    ]);
  const optionClaim = patchHf70OptionClaimSource(optionClaimBase);
  const optionList = patchHf70OptionListSource(optionListBase);
  const singleList = patchHf70SingleListSource(singleListBase);
  const singleClaim = patchHf70SingleClaimSource(singleClaimBase);

  assert.match(optionList, /a21PopupBaselineTabIds/);
  assert.match(optionList, /Number\(tab\.openerTabId\) === expectedListTabId/);
  assert.match(optionClaim, /exactFreshOwnedPopupV070/);
  assert.match(singleList, /singleA21PopupBaselineTabIds/);
  assert.match(singleClaim, /exactFreshOwnedSinglePopupV070/);
  assert.match(singleClaim, /stock_single_popup_owner_mismatch_hf70/);
  for (const source of [optionClaim, optionList, singleList, singleClaim]) {
    new Function(source);
  }
});

test("HF70 package and UI advance the live gate while preserving serial goods-key dispatch", async () => {
  const [route, page, planner, background] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download-hf70/route.ts", "utf8"),
    readFile("src/app/china-order-manager/stock-control/page.tsx", "utf8"),
    readFile("src/lib/shoplingStockLaunchPlan.ts", "utf8"),
    readFile("public/shopling-stock-state-sync/background-v090.js", "utf8"),
  ]);
  assert.match(route, /getHf69Download/);
  assert.match(route, /const VERSION = "0\.6\.33"/);
  assert.match(route, /FRESH_TAB_NOT_IN_BASELINE_AND_EXACT_A21_LIST_OPENER/);
  assert.match(route, /SERIAL_ONE_AT_A_TIME/);
  assert.match(page, /download-hf71/);
  assert.match(page, /v0\.6\.34 다운로드/);
  assert.match(planner, /ALL_DATE_STOCK_SYNC_MIN_VERSION = \[0, 6, 34\]/);
  assert.match(background, /importScripts\("background-v089\.js"\)/);
  new Function(background);
});
