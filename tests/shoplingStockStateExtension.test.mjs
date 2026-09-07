import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.5.3 manifest wires A6-live overlay, price-core popup and result observer", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, "0.5.3");
  assert.equal(m.background.service_worker, "background-v052.js");
  const listWorker = m.content_scripts.find((s) => s.js.includes("content-shopling-v030.js"));
  const popupCore = m.content_scripts.find((s) => s.js.includes("content-a21-price-core-v050.js"));
  const popupMain = m.content_scripts.find((s) => s.js.includes("main-a21-price-core-v050.js"));
  const resultObserver = m.content_scripts.find((s) => s.js.includes("content-stock-result-v050.js"));
  assert.ok(listWorker?.exclude_matches?.some((value) => value.includes("goods_mallMdfy_trsmt.phtml")));
  assert.ok(popupCore?.all_frames);
  assert.equal(popupMain?.world, "MAIN");
  assert.ok(resultObserver?.all_frames);
});

test("v0.5.3 generated worker binds legacy A6 B-code input values and collects all goods keys", async () => {
  for (const name of ["background-v020.js","background-v030.js","background-v040.js","background-v050.js","background-v052.js","content-ops-v021.js","content-stock-result-v050.js","main-shopling.js","popup.js"]) {
    const src = await readFile(`${root}/${name}`, "utf8");
    assert.doesNotThrow(() => new Function(src));
  }
  const built = buildStockWorkerV030(await readFile(`${root}/content-shopling-v018.js`, "utf8"), await readFile(`${root}/search-policy-v023.js`, "utf8"));
  assert.doesNotThrow(() => new Function(built));
  assert.match(built, /rowEvidenceTextV053/);
  assert.match(built, /querySelectorAll\?\.\("input,textarea,select"\)/);
  assert.match(built, /values\.push\(control\.value \|\| ""\)/);
  assert.match(built, /evidenceText\.toUpperCase\(\)/);
  assert.match(built, /A6_BCODE_GOODSKEY_NOT_FOUND/);
  assert.match(built, /A6_RESULT_PAGE_INCOMPLETE/);
  assert.match(built, /discoveredGoodsKeys/);
  assert.match(built, /discoveredPairs/);
  assert.match(built, /selected\.count !== totalResultCount/);
  assert.match(built, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(built, /A21_RESULT_OVER_200_BATCH_LIMIT/);
});

test("v0.5.3 background discards cached option goods keys and requires live A6 discovery", async () => {
  const b = await readFile(`${root}/background-v052.js`, "utf8");
  assert.match(b, /goodsKeys: \[\]/);
  assert.match(b, /goodsKeySource: "A6_LIVE_OPTION_BARCODE"/);
  assert.match(b, /productKind === "OPTION" \? \["A6", "A21_LIST"\]/);
  assert.match(b, /discoveredGoodsKeys/);
  assert.match(b, /active\.job\.goodsKeys = discoveredGoodsKeys/);
  assert.match(b, /A6_BCODE_GOODSKEY_NOT_FOUND/);
  assert.match(b, /goodsKeyCount: discoveredGoodsKeys\.length/);
});

test("v0.5.3 OPS bridge no longer pre-mutates OPTION through single-goods-key API", async () => {
  const src = await readFile(`${root}/content-ops-v021.js`, "utf8");
  assert.doesNotMatch(src, /inventory-stock-control\/shopling-option-status/);
  assert.doesNotMatch(src, /matchedGoodsKey/);
  assert.match(src, /A6_LIVE_GOODSKEY_DISCOVERY/);
  assert.match(src, /initialGoodsKeys/);
});

test("v0.5.3 uses the observed Shopling maximum A6 date horizon", async () => {
  const policy = await readFile(`${root}/search-policy-v023.js`, "utf8");
  assert.match(policy, /const START = "20130912"/);
  assert.match(policy, /2013-09-12~오늘 최대 검색기간/);
  assert.match(policy, /SEARCH_BINDING_MISMATCH/);
  assert.match(policy, /oneClickGuard/);
  assert.doesNotMatch(policy, /ticket\.documentToken !== documentToken/);
});

test("price-core source stays byte-identical to the working price extension", async () => {
  const [copiedContent, copiedMain, canonicalContent, canonicalMain] = await Promise.all([
    readFile(`${root}/price-core-content-a21-v024.js`, "utf8"), readFile(`${root}/price-core-main-a21-v024.js`, "utf8"),
    readFile("public/shopling-a21-price-option-resend/content-a21-v024.js", "utf8"), readFile("public/shopling-a21-price-option-resend/main-a21-v024.js", "utf8"),
  ]);
  assert.equal(copiedContent, canonicalContent);
  assert.equal(copiedMain, canonicalMain);
  assert.match(canonicalContent, /chooseMode\("goods_stock"\)/);
  assert.match(canonicalContent, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(canonicalMain, /goods_mallMdfy_submit_sp/);
});

test("v0.5.3 preserves A21 stage-race retry and marketplace advisory policy", async () => {
  const [route, background] = await Promise.all([
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile(`${root}/background-v050.js`, "utf8"),
  ]);
  assert.match(route, /attempt < 16/);
  assert.match(route, /await sleep\(250\)/);
  assert.match(route, /error !== "stock_price_core_not_option_popup_stage"/);
  assert.match(background, /marketplaceFailuresIgnored/);
  assert.match(background, /SHOPLING_A21_COMPLETION_AUTHORITATIVE_MARKETPLACE_FAILURES_ADVISORY/);
  assert.match(background, /return continueNextGoodsKey\(active, sender, normalizedEvidence\)/);
});

test("v0.5.3 package verify declares control-value A6 binding and serial completion contract", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.5\.3"/);
  assert.match(route, /background-v052\.js/);
  assert.match(route, /A6_LIVE_BCODE_CONTROL_VALUE_ROWS_THEN_A21_SERIAL_PRICE_CORE_V053/);
  assert.match(route, /a6RowBinding: "TEXT_CONTENT_PLUS_INPUT_SELECT_VALUES"/);
  assert.match(route, /ALL_DISCOVERED_DEDUP_SERIAL_COMPLETE_REQUIRED/);
  assert.match(route, /optionBrowserStages: \["A6", "A21_LIST", "A21_POPUP"\]/);
});
