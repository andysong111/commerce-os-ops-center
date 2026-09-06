import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("v0.4.2 A21 worker binds only the local search row, supports exact multirow selection and compiles", async () => {
  const [template, policy] = await Promise.all([
    file("public/shopling-stock-state-sync/content-shopling-v018.js"),
    file("public/shopling-stock-state-sync/search-policy-v023.js"),
  ]);
  const worker = buildStockWorkerV030(template, policy);

  assert.match(worker, /const VERSION = "0\.4\.2"/);
  assert.match(worker, /function searchFieldV041\(label\)/);
  assert.match(worker, /labels\.includes\("검색항목"\)/);
  assert.match(worker, /화면출력\|내림차순\|오름차순/);
  assert.match(worker, /function searchInputV041\(field\)/);
  assert.match(worker, /field\?\.closest\("tr"\)/);
  assert.match(worker, /findInput: searchInputV041/);
  assert.match(worker, /function setA21PageSize200V042\(\)/);
  assert.match(worker, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /selected\.count !== totalResultCount/);
});

test("v0.4.2 keeps v0.4.1 search policy fail-closed and one-click per execution", async () => {
  const policy = await file("public/shopling-stock-state-sync/search-policy-v023.js");

  assert.match(policy, /commerce-stock-search-v041/);
  assert.match(policy, /SEARCH_BINDING_MISMATCH/);
  assert.match(policy, /SEARCH_INPUT_NOT_BOUND/);
  assert.match(policy, /oneClickGuard/);
  assert.doesNotMatch(policy, /ticket\.documentToken !== documentToken/);
  assert.match(policy, /ticket\.fieldLabel === fieldLabel/);
  assert.match(policy, /submitted: true/);
});

test("v0.4.2 package, UI and popup report the same release", async () => {
  const [manifestSource, downloadSource, pageSource, popupSource, backgroundSource] = await Promise.all([
    file("public/shopling-stock-state-sync/manifest.json"),
    file("src/app/api/shopling-stock-state-sync/download/route.ts"),
    file("src/app/china-order-manager/stock-control/page.tsx"),
    file("public/shopling-stock-state-sync/popup.js"),
    file("public/shopling-stock-state-sync/background-v040.js"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.version, "0.4.2");
  assert.match(downloadSource, /const VERSION = "0\.4\.2"/);
  assert.match(downloadSource, /ROW_SCOPED_VERIFIED/);
  assert.match(downloadSource, /ONE_CLICK_TICKET/);
  assert.match(downloadSource, /EXACT_GOODS_KEY_ALL_ROWS_UP_TO_200/);
  assert.match(downloadSource, /a21BatchLimit: 200/);
  assert.match(pageSource, /v0\.4\.2 다운로드/);
  assert.match(popupSource, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(backgroundSource, /chrome\.runtime\.getManifest\(\)\.version/);
});
