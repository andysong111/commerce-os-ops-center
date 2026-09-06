import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
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
});

test("API goods key stays exact while A21 fans out to all exact marketplace rows up to 200", async () => {
  const legacy = await readFile(`${root}/background-v020.js`, "utf8");
  const cutover = await readFile(`${root}/background-v040.js`, "utf8");
  const template = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  const policy = await readFile(`${root}/search-policy-v023.js`, "utf8");
  const worker = buildStockWorkerV030(template, policy);
  assert.match(legacy, /STOCK_SYNC_GOODS_KEY_REQUIRED/);
  assert.match(cutover, /goodsKeys\.length !== 1/);
  assert.match(cutover, /SHOPLING_OPTION_API_GOODS_KEY_NOT_EXACT/);
  assert.match(worker, /샵플링상품코드/);
  assert.match(worker, /A4_EXACT_ROW_SELECTION_FAILED/);
  assert.match(worker, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /setA21PageSize200V042/);
  assert.match(worker, /selected\.count !== totalResultCount/);
  assert.match(worker, /batchLimit: 200/);
  assert.doesNotMatch(worker, /A21 정확 일치 행 1건을 단독 선택하지 못했습니다/);
  assert.match(legacy, /PRE_SUBMIT_TIMEOUT_MS = 60_000/);
  assert.match(legacy, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
});

test("dedicated A21 popup worker mirrors proven option-only configuration", async () => {
  const popup = await readFile(`${root}/content-a21-popup-v043.js`, "utf8");
  assert.match(popup, /modeRadio\("옵션송신"\)/);
  assert.match(popup, /optionSelectionControl\(\)/);
  assert.match(popup, /text\.includes\("옵션송신"\) && text\.includes\("선택"\)/);
  assert.match(popup, /추가상품송신/);
  assert.match(popup, /옵션\+추가상품송신/);
  assert.match(popup, /forbiddenChecked: forbidden\.length/);
  assert.match(popup, /A21_OPTION_CONFIGURATION_VERIFY_FAILED/);
  assert.match(popup, /A21_POPUP_SUBMITTED/);
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

test("ZIP generates v0.4.3 API-option plus exact A21 multirow and dedicated popup package", async () => {
  const route = await readFile(
    "src/app/api/shopling-stock-state-sync/download/route.ts",
    "utf8",
  );
  assert.match(route, /const VERSION = "0\.4\.3"/);
  assert.match(route, /buildStockWorkerV030/);
  assert.match(route, /content-shopling-v030\.js/);
  assert.match(route, /content-a21-popup-v043\.js/);
  assert.match(route, /background-v040\.js/);
  assert.match(route, /missing_packaged_file/);
  assert.match(route, /workerSha256/);
  assert.match(route, /popupWorkerSha256/);
  assert.match(route, /SHOPLING_API_OPTION_STATUS_THEN_A21_MULTIROW_POPUP_V043/);
  assert.match(route, /a21SearchBinding: "ROW_SCOPED_VERIFIED"/);
  assert.match(route, /a21SearchSubmitGuard: "ONE_CLICK_TICKET"/);
  assert.match(route, /a21ResultSelection: "EXACT_GOODS_KEY_ALL_ROWS_UP_TO_200"/);
  assert.match(route, /a21BatchLimit: 200/);
  assert.match(route, /PRICE_ENGINE_PROVEN_OPTION_MODE_PLUS_SELECTION/);
  assert.match(route, /DEDICATED_GOODS_MALL_MDFY_TRSMT_WORKER/);
  assert.match(route, /optionBrowserStages: \["A21_LIST", "A21_POPUP"\]/);
});

test("explicit operator safe-stop is retryable without weakening other UNCERTAIN blocks", async () => {
  const resolution = await readFile(
    "src/lib/inventoryStockSyncResolution.ts",
    "utf8",
  );
  const stateRoute = await readFile(
    "src/app/api/inventory-stock-control/route.ts",
    "utf8",
  );
  const syncRoute = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );
  assert.match(resolution, /STOCK_SYNC_OPERATOR_STOPPED/);
  assert.match(resolution, /outcome === "UNCERTAIN"/);
  assert.match(resolution, /code === OPERATOR_STOP_CODE/);
  assert.match(resolution, /desiredStatus === candidate\.desiredStatus/);
  assert.match(resolution, /occurredAt >= desiredSince/);
  assert.match(resolution, /if \(response\.error\) return new Set<string>\(\)/);
  assert.match(resolution, /syncBlocked: false/);
  assert.match(
    stateRoute,
    /await normalizeRetryableShoplingSyncReportWithEvidence/,
  );
  assert.match(
    syncRoute,
    /return normalizeRetryableShoplingSyncReportWithEvidence/,
  );
});
