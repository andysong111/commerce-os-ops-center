import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, statusPopup, statusMain, backgroundBase, backgroundV041, backgroundV044, monthlyBackground, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("monthly-status-popup-v053.js", root), "utf8"),
  readFile(new URL("monthly-status-main-v053.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v041.js", root), "utf8"),
  readFile(new URL("background-v044.js", root), "utf8"),
  readFile(new URL("background-monthly-price.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.4.4 keeps CDP and scans all runtime frames plus accessibility tree", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.5.15");
  assert.equal(manifest.background.service_worker, "background-monthly-price.js");
  assert.ok(manifest.permissions.includes("debugger"));
  assert.ok(!manifest.content_scripts.some((row) => row.js?.some((name) => name.includes("result-watch"))));
  assert.match(backgroundV044, /importScripts\("background-v041\.js"\)/);
  assert.match(backgroundV044, /Runtime\.executionContextCreated/);
  assert.match(backgroundV044, /contextsByTabV044/);
  assert.match(backgroundV044, /evaluateAllContextsV044/);
  assert.match(backgroundV044, /Accessibility\.getFullAXTree/);
  assert.match(backgroundV044, /Accessibility\.enable/);
});

test("A21 v0.4.4 recognizes distinct price and option footers in frame DOM or accessibility", () => {
  assert.match(backgroundV044, /priceFooter/);
  assert.match(backgroundV044, /optionFooter/);
  assert.match(backgroundV044, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(backgroundV044, /상품\\s\*옵션\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(backgroundV044, /expectedInRuntime/);
  assert.match(backgroundV044, /expectedInAx/);
  assert.match(backgroundV044, /matchingContextReady/);
  assert.match(backgroundV044, /topReady/);
  assert.match(backgroundV044, /STABLE_MS = 2_500/);
  assert.match(backgroundV044, /V044_FRAME_AX_COMPLETION_TIMEOUT/);
  assert.match(popupRunHtml, /v0\.4\.4/);
  assert.match(popupRun, /Accessibility/);
});

test("A21 v0.4.4 blocks queue advance while processing remains", () => {
  assert.match(backgroundV044, /처리중입니다/);
  assert.match(backgroundV044, /잠시만\\s\*기다려주시기\\s\*바랍니다/);
  assert.match(backgroundV044, /if \(probe\.processing\)/);
  assert.match(backgroundV044, /return baseCompleteJobV041/);
});

test("A21 v0.4.4 can rediscover the current result target instead of pinning one top document", () => {
  assert.match(backgroundV044, /candidateTabsV044/);
  assert.match(backgroundV044, /job\?\.resultTabId/);
  assert.match(backgroundV044, /job\?\.popupTabId/);
  assert.match(backgroundV044, /openerTabId/);
  assert.match(backgroundV044, /createdTabsV044/);
});

test("A21 v0.4.4 preserves price-first serial queue from v0.4.1", () => {
  assert.match(backgroundV041, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV041, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV041, /sortJobsPricesFirst/);
  assert.match(backgroundV041, /state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)/);
});

test("monthly v0.5.15 batches up to 200 GOODSKEY and parallelizes only within the current phase", () => {
  assert.match(monthlyBackground, /MAX_MONTHLY_PARALLEL = 4/);
  assert.match(backgroundBase, /MAX_SEARCH_CODES = 200/);
  assert.match(monthlyBackground, /buildBatches\(items\)/);
  assert.match(monthlyBackground, /monthlyModes: \["PRICE", "OPTION"\]/);
  assert.match(monthlyBackground, /phaseJobs\(state, "PRICE"\)/);
  assert.match(monthlyBackground, /phaseJobs\(state, "OPTION"\)/);
  assert.match(monthlyBackground, /MAX_MONTHLY_PARALLEL - activeMonthlyJobs/);
  assert.match(monthlyBackground, /MONTHLY_PRICE_BATCH_START/);
  assert.match(monthlyBackground, /MONTHLY_PRICE_BATCH_STATUS/);
});

test("monthly A21 sequence is status-selling -> PRICE -> OPTION -> optional status-restore", () => {
  assert.match(monthlyBackground, /STATUS_SELLING/);
  assert.match(monthlyBackground, /STATUS_SOLD_OUT/);
  assert.match(monthlyBackground, /phaseJobs\(state, "STATUS_SELLING"\)/);
  assert.match(monthlyBackground, /phaseJobs\(state, "PRICE"\)/);
  assert.match(monthlyBackground, /phaseJobs\(state, "OPTION"\)/);
  assert.match(monthlyBackground, /phaseJobs\(state, "STATUS_SOLD_OUT"/);
  assert.match(monthlyBackground, /BLOCKED_BY_PRIOR_PHASE/);
  assert.match(monthlyBackground, /terminalPhaseStatus/);
  assert.match(monthlyBackground, /saleStatusActivated/);
  assert.match(monthlyBackground, /saleStatusRestored/);
});

test("monthly status overlays verify exact sale-status mode without mutating shared price core", () => {
  for (const source of [statusPopup, statusMain]) {
    assert.match(source, /STATUS_SELLING/);
    assert.match(source, /STATUS_SOLD_OUT/);
    assert.match(source, /상품판매상태송신/);
    assert.match(source, /판매중/);
    assert.match(source, /품절/);
  }
  assert.match(statusMain, /window\.goods_mallMdfy_submit_sp\(\)/);
  assert.match(exactPopup, /!\["PRICE", "OPTION"\]\.includes/);
  assert.doesNotMatch(mainSubmitBridge, /STATUS_SELLING|STATUS_SOLD_OUT/);
});

test("A21 v0.4.4 preserves delivery and form safety before submit", () => {
  for (const source of [exactPopup, mainSubmitBridge]) {
    assert.match(source, /trsmt_env_mody_dlvyinfo/);
    assert.match(source, /수정\\s\*안함|수정안함/);
    assert.match(source, /forceDeliveryUnchanged/);
  }
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(mainSubmitBridge, /window\.goods_mallMdfy_submit_sp\(\)/);
});

test("monthly result pages defer generic aggregate success/failure to the per-GOODSKEY CDP controller", async () => {
  const listContent = await readFile(new URL("content-a21.js", root), "utf8");
  assert.match(listContent, /\^monthly-/);
  assert.match(listContent, /background CDP verifier/);
  assert.match(listContent, /return;/);
});

test("monthly v0.5.15 captures Shopling result counts and rows before closing the result window", () => {
  assert.doesNotMatch(backgroundV044, /finalSendBaseline|최종전송일/);
  assert.match(backgroundV044, /successCount/);
  assert.match(backgroundV044, /failureCount/);
  assert.match(backgroundV044, /resultRows/);
  assert.match(backgroundV044, /commerceOsMonthlyHandleDefinitiveResult/);
  assert.match(monthlyBackground, /MONTHLY_RETRY_GROUP_SIZE = 20/);
  assert.match(monthlyBackground, /MONTHLY_MAX_ATTEMPTS = 3/);
  assert.match(monthlyBackground, /ROW_EXPLICIT/);
  assert.match(monthlyBackground, /FAILED_GROUP_FALLBACK/);
  assert.match(monthlyBackground, /RELIST_REQUIRED/);
});

test("A21 resend plan still requires verified Shopling stored prices before transmission", () => {
  for (const needle of [
    'readback.state === "VERIFIED"',
    "readback.verifiedGoodsKeyCount === plan.goodsKeyCount",
    "readback.failedGoodsKeyCount === 0",
    "readback.mallMismatchCount === 0",
    "readback.mallMissingCount === 0",
    "readback.mallMatchCount === readback.mallCheckCount",
  ]) assert.ok(planRoute.includes(needle), `missing ${needle}`);
  assert.match(downloadRoute, /const VERSION = "0\.5\.15"/);
  assert.match(downloadRoute, /background-v044\.js/);
  assert.match(downloadRoute, /debugger/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
  assert.match(downloadRoute, /monthly-status-main-v053\.js/);
  assert.match(downloadRoute, /monthly-status-popup-v053\.js/);
});

test("v0.5.15 self-heals invalidated Commerce OS page bridge contexts", async () => {
  const bridge = await readFile(new URL("monthly-price-page-bridge.js", root), "utf8");
  assert.match(monthlyBackground, /repairMonthlyPageBridges/);
  assert.match(monthlyBackground, /injectMonthlyPageBridge/);
  assert.match(monthlyBackground, /chrome\.scripting\.executeScript/);
  assert.match(monthlyBackground, /china-order-manager\*/);
  assert.match(bridge, /__commerceOsMonthlyPriceBridge/);
  assert.match(bridge, /removeEventListener\("message", previous\.listener\)/);
  assert.match(bridge, /globalThis\[slot\] = \{ version: "0\.5\.15", listener \}/);
  assert.match(bridge, /typeof runtime\.sendMessage !== "function"/);
  assert.match(monthlyBackground, /probe\[0\]\?\.result === true/);
  assert.match(bridge, /MONTHLY_PRICE_EXTENSION_RELOAD_REQUIRED/);
  assert.match(bridge, /try \{/);
});

test("v0.5.15 registered-mall GOODSKEY validation accepts normal numeric keys", () => {
  assert.match(monthlyBackground, /if \(!\/\^\\d\{5,9\}\$\/\.test\(goodsKey\)\)/);
  assert.doesNotMatch(monthlyBackground, /\^\\\\d\{5,9\}\$/);
});

test("v0.5.15 registered-mall readback targets the actionable Shopling child frame", async () => {
  const dom = await readFile(new URL("monthly-price-dom.js", root), "utf8");
  assert.match(dom, /inspectMonthlyRegisteredMarketFrame/);
  assert.match(dom, /A4_WITH_GOODS/);
  assert.match(monthlyBackground, /allFrames:\s*true/);
  assert.match(monthlyBackground, /frameIds:\s*\[target\.frameId\]/);
  assert.match(monthlyBackground, /FRAME_NOT_FOUND/);
  assert.match(monthlyBackground, /MONTHLY_PRICE_REGISTERED_MALL_VIEW_TIMEOUT:/);
});

test("v0.5.15 registered-mall search expands old-product date range and does not hammer Search", async () => {
  const dom = await readFile(new URL("monthly-price-dom.js", root), "utf8");
  assert.match(dom, /20130912/);
  assert.match(dom, /Asia\/Seoul/);
  assert.match(dom, /commerceOsMonthlyRegisteredSearchV0515/);
  assert.match(dom, /SEARCH_WAITING/);
  assert.match(dom, /SEARCH_RESULT_NOT_FOUND/);
  assert.match(dom, /상품등록번호/);
  assert.match(dom, /상품검색용코드/);
  assert.match(monthlyBackground, /SEARCH_RESULT_NOT_FOUND/);
});

test("v0.5.15 follows the live Shopling registered-mall checkbox flow", async () => {
  const dom = await readFile(new URL("monthly-price-dom.js", root), "utf8");
  assert.match(dom, /상품이등록된쇼핑몰보기/);
  assert.match(dom, /commerceOsMonthlyRegisteredViewSearchV0515/);
  assert.match(dom, /REGISTERED_VIEW_SEARCH_SUBMITTED/);
  assert.match(dom, /WAITING_FOR_REGISTERED_TABLE/);
  assert.match(dom, /REGISTERED_VIEW_RESULT_NOT_FOUND/);
  assert.doesNotMatch(dom, /DETAIL_OPENED_DIRECT/);
});

test("v0.5.15 binds the exact registered-mall checkbox and real GOODSKEY search row", async () => {
  const dom = await readFile(new URL("monthly-price-dom.js", root), "utf8");
  assert.match(dom, /compact\(checkboxOwnText\(input\)\) === "상품이등록된쇼핑몰보기"/);
  assert.match(dom, /if \(\/검색항목\/\.test\(rowContext\)\) score \+= 300/);
  assert.match(dom, /if \(\/화면출력\|내림차순\|오름차순\|정렬\/\.test\(rowContext\)\) score -= 350/);
  assert.match(dom, /const searchRow = select\.closest\("tr"\)/);
  assert.match(dom, /fieldLabel: "샵플링상품코드"/);
  assert.match(dom, /commerceOsMonthlyRegisteredViewSearchV0515/);
});

test("v0.5.15 enters A4 상품조회수정 from the Shopling shell before market readback", async () => {
  const dom = await readFile(new URL("monthly-price-dom.js", root), "utf8");
  assert.match(monthlyBackground, /main\.phtml\?commerce_os_monthly_market_read=1/);
  assert.match(dom, /A4_MENU_AVAILABLE/);
  assert.match(dom, /A4_MENU_OPENED/);
  assert.match(dom, /A4_MENU_MISSING/);
  assert.match(dom, /상품조회수정/);
  assert.match(dom, /A4_WITH_GOODS/);
});

test("page bridge exposes batch start and batch status commands", async () => {
  const bridge = await readFile(new URL("monthly-price-page-bridge.js", root), "utf8");
  assert.match(bridge, /BATCH_START/);
  assert.match(bridge, /BATCH_STATUS/);
});

test("A21 v0.4.4 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});
