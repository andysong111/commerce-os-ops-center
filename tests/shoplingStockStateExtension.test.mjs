import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.5.5 manifest wires A6 resolver, proven A21 list, price-core popup and result observer", async () => {
  const m = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, "0.5.5");
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

test("v0.5.5 source worker still reads legacy A6 control values and package route replaces A6 with readonly resolver", async () => {
  for (const name of ["background-v020.js","background-v030.js","background-v040.js","background-v050.js","background-v052.js","content-ops-v021.js","content-stock-result-v050.js","main-shopling.js","popup.js"]) {
    const src = await readFile(`${root}/${name}`, "utf8");
    assert.doesNotThrow(() => new Function(src));
  }
  const built = buildStockWorkerV030(await readFile(`${root}/content-shopling-v018.js`, "utf8"), await readFile(`${root}/search-policy-v023.js`, "utf8"));
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.doesNotThrow(() => new Function(built));
  assert.match(built, /rowEvidenceTextV053/);
  assert.match(built, /values\.push\(control\.value \|\| ""\)/);
  assert.match(route, /function patchA6ReadOnlyResolverV054/);
  assert.match(route, /const resultRows = \[\.\.\.document\.querySelectorAll\("tr"\)\]/);
  assert.match(route, /rowEvidenceTextV053\(row\)/);
  assert.match(route, /checkboxTouched: false/);
  assert.match(route, /optionStatusTouched: false/);
  assert.match(route, /shopling_stock_a6_readonly_patch_contains_mutation/);
  assert.match(route, /selectOnlyMatchingRows\|setCheck/);
  assert.match(route, /A6_BCODE_GOODSKEY_NOT_FOUND/);
  assert.match(route, /A6_RESULT_PAGE_INCOMPLETE/);
  assert.match(route, /discoveredGoodsKeys/);
});

test("v0.5.5 background uses A6 only for goods keys, then applies API per goods key before A21", async () => {
  const [background, ops] = await Promise.all([
    readFile(`${root}/background-v052.js`, "utf8"),
    readFile(`${root}/content-ops-v021.js`, "utf8"),
  ]);
  assert.match(background, /goodsKeys: \[\]/);
  assert.match(background, /goodsKeySource: "A6_LIVE_OPTION_BARCODE"/);
  assert.match(background, /productKind === "OPTION" \? \["A6", "A21_LIST"\]/);
  assert.match(background, /STOCK_SYNC_APPLY_OPTION_STATUS_V054/);
  assert.match(background, /applyOptionStatusViaOpsV054/);
  assert.match(background, /active\.job\.goodsKeys = discoveredGoodsKeys/);
  assert.match(background, /active\.job\.optionApiApplied = true/);
  assert.match(background, /active\.stage = "A21_LIST"/);
  assert.match(background, /checkboxTouched: false/);
  assert.match(background, /retrySafe: true/);

  assert.match(ops, /OPTION_API_PATH = "\/api\/inventory-stock-control\/shopling-option-status"/);
  assert.match(ops, /STOCK_SYNC_APPLY_OPTION_STATUS_V054/);
  assert.match(ops, /applyOptionStatusForDiscoveredGoodsKeys/);
  assert.match(ops, /goodsKeys: \[goodsKey\]/);
  assert.match(ops, /for \(let index = 0; index < goodsKeys\.length; index \+= 1\)/);
  assert.match(ops, /matchedGoodsKey !== goodsKey/);
});

test("v0.5.5 keeps the observed Shopling maximum A6 date horizon", async () => {
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

test("v0.5.5 preserves A21 stage-race retry and marketplace advisory policy", async () => {
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

test("v0.5.5 package verify declares readonly A6 then per-goods-key API then proven-list serial A21", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.5\.5"/);
  assert.match(route, /background-v052\.js/);
  assert.match(route, /A6_READ_ONLY_BCODE_GOODSKEYS_THEN_API_STATUS_THEN_A21_PROVEN_LIST_V055/);
  assert.match(route, /a6RowBinding: "TEXT_CONTENT_PLUS_INPUT_SELECT_VALUES"/);
  assert.match(route, /a6Mutation: "NONE_READ_ONLY_RESOLVER"/);
  assert.match(route, /a6Checkbox: "NOT_TOUCHED"/);
  assert.match(route, /optionLocalMutation: "SHOPLING_API_PER_DISCOVERED_GOODSKEY"/);
  assert.match(route, /ALL_DISCOVERED_DEDUP_SERIAL_COMPLETE_REQUIRED/);
  assert.match(route, /a21ListClick: "PROVEN_PRICE_OPTION_RESEND_DIRECT_NO_VISIBILITY_FILTER"/);
  assert.match(route, /optionBrowserStages: \["A6", "A21_LIST", "A21_POPUP"\]/);
});
