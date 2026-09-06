import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = "public/shopling-stock-state-sync";

test("v0.4 option route is API-A21 while single route remains A4-A21, no A22", async () => {
  const legacy = await readFile(`${root}/background-v020.js`, "utf8");
  const cutover = await readFile(`${root}/background-v040.js`, "utf8");
  const worker = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(cutover, /productKind === "OPTION"\s*\? \["A21_LIST"\]/);
  assert.match(cutover, /legacyRequiredStagesV040\(productKind\)/);
  assert.match(legacy, /\["A4", "A21_LIST"\]/);
  assert.doesNotMatch(cutover, /A22/);
  assert.doesNotMatch(worker, /runA22/);
  assert.match(worker, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.match(worker, /A21_SALE_STATUS_MODE_NOT_FOUND/);
});

test("exact goods-key and browser single-row gates remain before marketplace transmission", async () => {
  const legacy = await readFile(`${root}/background-v020.js`, "utf8");
  const cutover = await readFile(`${root}/background-v040.js`, "utf8");
  const worker = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(legacy, /STOCK_SYNC_GOODS_KEY_REQUIRED/);
  assert.match(cutover, /goodsKeys\.length !== 1/);
  assert.match(cutover, /SHOPLING_OPTION_API_GOODS_KEY_NOT_EXACT/);
  assert.match(worker, /샵플링상품코드/);
  for (const code of ["A4_EXACT_ROW_SELECTION_FAILED", "A21_EXACT_ROW_SELECTION_FAILED"]) {
    assert.ok(worker.includes(code));
  }
  assert.match(worker, /selected\.count !== 1/);
  assert.match(legacy, /PRE_SUBMIT_TIMEOUT_MS = 60_000/);
  assert.match(legacy, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
});

test("server option mutation preserves Shopling quantity and fails closed on ambiguous B-code", async () => {
  const api = await readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8");
  assert.match(api, /prod_gather_api\.phtml\?mode=2|config\.productsUrl/);
  assert.match(api, /prod_modify_api\.phtml\?mode=2/);
  assert.match(api, /variant\.partnerOptionCode === barcode/);
  assert.match(api, /matches\.length !== 1/);
  assert.match(api, /SHOPLING_OPTION_EXACT_MATCH_REQUIRED/);
  assert.match(api, /\["B", "C"\]/);
  assert.match(api, /<optQty>\$\{variant\.optionQuantity\}<\/optQty>/);
  assert.match(api, /code !== "000"/);
  assert.match(api, /successCount !== 1/);
  assert.match(api, /failCount !== 0/);
  assert.match(api, /after\.optionQuantity !== before\.optionQuantity/);
  assert.match(api, /SHOPLING_OPTION_READBACK_QTY_MISMATCH/);
});

test("ZIP generates v0.4.0 API-option plus A21-only package and checks all declared files", async () => {
  const route = await readFile(
    "src/app/api/shopling-stock-state-sync/download/route.ts",
    "utf8",
  );
  assert.match(route, /const VERSION = "0\.4\.0"/);
  assert.match(route, /buildStockWorkerV030/);
  assert.match(route, /content-shopling-v030\.js/);
  assert.match(route, /background-v040\.js/);
  assert.match(route, /missing_packaged_file/);
  assert.match(route, /workerSha256/);
  assert.match(route, /SHOPLING_API_OPTION_STATUS_THEN_A21_ONLY_V040/);
  assert.match(route, /optionBrowserStages: \["A21_LIST", "A21_POPUP"\]/);
});
