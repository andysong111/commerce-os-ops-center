import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("v0.5.2 A21 list worker keeps local search binding and exact multirow selection", async () => {
  const [template, policy] = await Promise.all([
    file("public/shopling-stock-state-sync/content-shopling-v018.js"),
    file("public/shopling-stock-state-sync/search-policy-v023.js"),
  ]);
  const worker = buildStockWorkerV030(template, policy);
  assert.match(worker, /const VERSION = "0\.4\.2"/);
  assert.match(worker, /function searchFieldV041\(label\)/);
  assert.match(worker, /labels\.includes\("검색항목"\)/);
  assert.match(worker, /function searchInputV041\(field\)/);
  assert.match(worker, /function setA21PageSize200V042\(\)/);
  assert.match(worker, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /selected\.count !== totalResultCount/);
});

test("v0.5.2 keeps the one-click search policy while extending stock search start to Shopling service origin", async () => {
  const policy = await file("public/shopling-stock-state-sync/search-policy-v023.js");
  assert.match(policy, /const START = "20130912"/);
  assert.match(policy, /commerce-stock-search-v041/);
  assert.match(policy, /SEARCH_BINDING_MISMATCH/);
  assert.match(policy, /SEARCH_INPUT_NOT_BOUND/);
  assert.match(policy, /oneClickGuard/);
  assert.doesNotMatch(policy, /ticket\.documentToken !== documentToken/);
  assert.match(policy, /ticket\.fieldLabel === fieldLabel/);
  assert.match(policy, /submitted: true/);
});

test("v0.5.2 package adds live A6 goods-key discovery while retaining literal price-core popup and bounded stage-race retry", async () => {
  const [manifestSource, downloadSource, pageSource, popupSource, adapterSource, liveA6Source, copiedContent, copiedMain, canonicalContent, canonicalMain] = await Promise.all([
    file("public/shopling-stock-state-sync/manifest.json"),
    file("src/app/api/shopling-stock-state-sync/download/route.ts"),
    file("src/app/china-order-manager/stock-control/page.tsx"),
    file("public/shopling-stock-state-sync/popup.js"),
    file("public/shopling-stock-state-sync/background-v050.js"),
    file("public/shopling-stock-state-sync/background-v052.js"),
    file("public/shopling-stock-state-sync/price-core-content-a21-v024.js"),
    file("public/shopling-stock-state-sync/price-core-main-a21-v024.js"),
    file("public/shopling-a21-price-option-resend/content-a21-v024.js"),
    file("public/shopling-a21-price-option-resend/main-a21-v024.js"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.version, "0.5.2");
  assert.equal(manifest.background.service_worker, "background-v052.js");
  assert.equal(copiedContent, canonicalContent);
  assert.equal(copiedMain, canonicalMain);
  assert.match(canonicalContent, /chooseMode\("goods_stock"\)/);
  assert.match(canonicalContent, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(canonicalMain, /goods_mallMdfy_submit_sp/);
  assert.match(downloadSource, /const VERSION = "0\.5\.2"/);
  assert.match(downloadSource, /priceCoreLiteralCopyVerified: true/);
  assert.match(downloadSource, /A6_LIVE_BCODE_ALL_GOODSKEYS_THEN_A21_SERIAL_PRICE_CORE_V052/);
  assert.match(downloadSource, /optionGoodsKeySource: "A6_LIVE_OPTION_BARCODE"/);
  assert.match(downloadSource, /ALL_DISCOVERED_DEDUP_SERIAL_COMPLETE_REQUIRED/);
  assert.match(downloadSource, /PRICE_CORE_SELF_CLAIM_ADAPTER_WITH_STAGE_RACE_RETRY/);
  assert.match(downloadSource, /stock_price_core_not_option_popup_stage/);
  assert.match(downloadSource, /attempt < 16/);
  assert.match(downloadSource, /CANONICAL_PRICE_CORE_MODIFY_TP_GOODS_STOCK_AND_TRSMT_ENV_MODY_OPT_1/);
  assert.match(pageSource, /v0\.5\.2 다운로드/);
  assert.match(popupSource, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(adapterSource, /STOCK_PRICE_CORE_POPUP_CLAIM_V050/);
  assert.match(liveA6Source, /A6/);
  assert.match(liveA6Source, /goodsKeys/);
  assert.match(liveA6Source, /continueNextGoodsKey/);
  const listWorker = manifest.content_scripts.find((script) => script.js.includes("content-shopling-v030.js"));
  const popupCore = manifest.content_scripts.find((script) => script.js.includes("content-a21-price-core-v050.js"));
  const mainCore = manifest.content_scripts.find((script) => script.js.includes("main-a21-price-core-v050.js"));
  const resultObserver = manifest.content_scripts.find((script) => script.js.includes("content-stock-result-v050.js"));
  assert.ok(listWorker?.exclude_matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml")));
  assert.ok(popupCore?.matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml")));
  assert.equal(mainCore?.world, "MAIN");
  assert.ok(resultObserver?.all_frames);
});
