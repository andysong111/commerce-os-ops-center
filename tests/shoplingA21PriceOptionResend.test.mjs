import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV041, backgroundV044, monthlyBackground, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
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
  assert.equal(manifest.version, "0.5.3");
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

test("monthly A21 sequence is status-selling -> PRICE -> OPTION -> optional status-restore", () => {
  assert.match(monthlyBackground, /STATUS_SELLING/);
  assert.match(monthlyBackground, /STATUS_SOLD_OUT/);
  assert.match(monthlyBackground, /mode === "STATUS_SELLING" \? 0 : mode === "PRICE" \? 1 : mode === "OPTION" \? 2/);
  assert.match(monthlyBackground, /BLOCKED_BY_PRIOR_STAGE/);
  assert.match(monthlyBackground, /prior\.status === "SUCCEEDED"/);
  assert.match(monthlyBackground, /saleStatusActivated/);
  assert.match(monthlyBackground, /saleStatusRestored/);
});

test("A21 popup and MAIN bridge verify exact sale-status mode before status transmission", () => {
  for (const source of [exactPopup, mainSubmitBridge]) {
    assert.match(source, /STATUS_SELLING/);
    assert.match(source, /STATUS_SOLD_OUT/);
    assert.match(source, /상품판매상태송신/);
    assert.match(source, /판매중/);
    assert.match(source, /품절/);
  }
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

test("A21 v0.4.4 does not gate progress on per-market success or A21 final-send date", () => {
  assert.doesNotMatch(backgroundV044, /finalSendBaseline|최종전송일/);
  assert.doesNotMatch(backgroundV044, /failure > 0|성공여부.*FAILED/);
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
  assert.match(downloadRoute, /const VERSION = "0\.5\.3"/);
  assert.match(downloadRoute, /background-v044\.js/);
  assert.match(downloadRoute, /debugger/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

test("A21 v0.4.4 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});
