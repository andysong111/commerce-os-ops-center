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
  assert.match(worker, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /setA21PageSize200V042/);
  assert.match(worker, /selected\.count !== totalResultCount/);
  assert.match(worker, /batchLimit: 200/);
  assert.doesNotMatch(worker, /A21 정확 일치 행 1건을 단독 선택하지 못했습니다/);
});

test("v0.4.4 popup self-claims the active stock job and uses exact Shopling option form values", async () => {
  const [background, popup, main] = await Promise.all([
    readFile(`${root}/background-v044.js`, "utf8"),
    readFile(`${root}/content-a21-popup-v044.js`, "utf8"),
    readFile(`${root}/main-a21-stock-v044.js`, "utf8"),
  ]);
  assert.match(background, /importScripts\("background-v040\.js"\)/);
  assert.match(background, /STOCK_SYNC_A21_POPUP_CLAIM_V044/);
  assert.match(background, /active\.stage !== "A21_POPUP"/);
  assert.match(background, /A21_POPUP: \{ tabId, frameId \}/);
  assert.match(popup, /selectRadio\("modify_tp", "goods_stock"\)/);
  assert.match(popup, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(popup, /claimLoop\(\)/);
  assert.match(popup, /optionMainSubmit\(\)/);
  assert.match(main, /goods_mallMdfy_submit_sp/);
  assert.match(main, /stock_v044_option_mode_invalid/);
  assert.match(main, /stock_v044_option_field_invalid/);
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

test("ZIP generates v0.4.4 exact-popup stock sync package", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.4\.4"/);
  assert.match(route, /content-shopling-v030\.js/);
  assert.match(route, /content-a21-popup-v044\.js/);
  assert.match(route, /main-a21-stock-v044\.js/);
  assert.match(route, /background-v044\.js/);
  assert.match(route, /SHOPLING_API_OPTION_STATUS_THEN_A21_EXACT_POPUP_V044/);
  assert.match(route, /a21PopupAssignment: "SELF_CLAIM_SINGLE_ACTIVE_JOB"/);
  assert.match(route, /EXACT_FORM_MODIFY_TP_GOODS_STOCK_AND_TRSMT_ENV_MODY_OPT_1/);
  assert.match(route, /MAIN_WORLD_GOODS_MALLMDFY_SUBMIT_SP/);
  assert.match(route, /a21BatchLimit: 200/);
});

test("explicit operator safe-stop is retryable without weakening other UNCERTAIN blocks", async () => {
  const resolution = await readFile("src/lib/inventoryStockSyncResolution.ts", "utf8");
  const stateRoute = await readFile("src/app/api/inventory-stock-control/route.ts", "utf8");
  const syncRoute = await readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8");
  assert.match(resolution, /STOCK_SYNC_OPERATOR_STOPPED/);
  assert.match(resolution, /outcome === "UNCERTAIN"/);
  assert.match(resolution, /code === OPERATOR_STOP_CODE/);
  assert.match(resolution, /desiredStatus === candidate\.desiredStatus/);
  assert.match(resolution, /occurredAt >= desiredSince/);
  assert.match(resolution, /syncBlocked: false/);
  assert.match(stateRoute, /await normalizeRetryableShoplingSyncReportWithEvidence/);
  assert.match(syncRoute, /return normalizeRetryableShoplingSyncReportWithEvidence/);
});
