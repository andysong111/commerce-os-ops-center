import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("option route remains API-A21 while single route remains A4-A21 and A22 is absent", async () => {
  const legacy = await readFile(`${root}/background-v020.js`, "utf8");
  const cutover = await readFile(`${root}/background-v040.js`, "utf8");
  const worker = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(cutover, /productKind === "OPTION"\s*\? \["A21_LIST"\]/);
  assert.match(cutover, /legacyRequiredStagesV040\(productKind\)/);
  assert.match(legacy, /\["A4", "A21_LIST"\]/);
  assert.doesNotMatch(cutover, /A22/);
  assert.doesNotMatch(worker, /runA22/);
});

test("API goods key stays exact while A21 fans out to exact marketplace rows up to 200", async () => {
  const cutover = await readFile(`${root}/background-v040.js`, "utf8");
  const template = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  const policy = await readFile(`${root}/search-policy-v023.js`, "utf8");
  const worker = buildStockWorkerV030(template, policy);
  assert.match(cutover, /goodsKeys\.length !== 1/);
  assert.match(cutover, /SHOPLING_OPTION_API_GOODS_KEY_NOT_EXACT/);
  assert.match(worker, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /setA21PageSize200V042/);
  assert.match(worker, /selected\.count !== totalResultCount/);
  assert.match(worker, /batchLimit: 200/);
});

test("v0.5.0 copies the proven price popup core literally and only namespaces package boundaries", async () => {
  const [copiedContent, copiedMain, canonicalContent, canonicalMain, adapter, route] = await Promise.all([
    readFile(`${root}/price-core-content-a21-v024.js`, "utf8"),
    readFile(`${root}/price-core-main-a21-v024.js`, "utf8"),
    readFile("public/shopling-a21-price-option-resend/content-a21-v024.js", "utf8"),
    readFile("public/shopling-a21-price-option-resend/main-a21-v024.js", "utf8"),
    readFile(`${root}/background-v050.js`, "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
  ]);
  assert.equal(copiedContent, canonicalContent);
  assert.equal(copiedMain, canonicalMain);
  assert.match(canonicalContent, /configureOption\(\)/);
  assert.match(canonicalContent, /chooseMode\("goods_stock"\)/);
  assert.match(canonicalContent, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(canonicalMain, /goods_mallMdfy_submit_sp/);
  assert.match(adapter, /STOCK_PRICE_CORE_POPUP_CLAIM_V050/);
  assert.match(adapter, /active\?\.job\?\.productKind === "OPTION" && active\.stage === "A21_POPUP"/);
  assert.match(route, /copiedPriceContent !== canonicalPriceContent/);
  assert.match(route, /namespacePriceCoreContent/);
  assert.match(route, /STOCK_PRICE_CORE_POPUP_CLAIM_V050/);
  assert.match(route, /commerce-os-stock-price-core-v050-main-submit-request/);
});

test("server option mutation preserves Shopling quantity and fails closed on ambiguous B-code", async () => {
  const api = await readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8");
  assert.match(api, /variant\.partnerOptionCode === barcode/);
  assert.match(api, /matches\.length !== 1/);
  assert.match(api, /SHOPLING_OPTION_EXACT_MATCH_REQUIRED/);
  assert.match(api, /\["B", "C"\]/);
  assert.match(api, /<optQty>\$\{variant\.optionQuantity\}<\/optQty>/);
  assert.match(api, /after\.optionQuantity !== before\.optionQuantity/);
  assert.match(api, /SHOPLING_OPTION_READBACK_QTY_MISMATCH/);
});

test("ZIP generates v0.5.0 literal price-core package with passive result observer", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.5\.0"/);
  assert.match(route, /background-v050\.js/);
  assert.match(route, /content-a21-price-core-v050\.js/);
  assert.match(route, /main-a21-price-core-v050\.js/);
  assert.match(route, /content-stock-result-v050\.js/);
  assert.match(route, /priceCoreLiteralCopyVerified: true/);
  assert.match(route, /SHOPLING_API_OPTION_STATUS_THEN_A21_LITERAL_PRICE_CORE_V050/);
  assert.match(route, /a21BatchLimit: 200/);
});

test("explicit operator safe-stop is retryable without weakening other UNCERTAIN blocks", async () => {
  const resolution = await readFile("src/lib/inventoryStockSyncResolution.ts", "utf8");
  const stateRoute = await readFile("src/app/api/inventory-stock-control/route.ts", "utf8");
  const syncRoute = await readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8");
  assert.match(resolution, /STOCK_SYNC_OPERATOR_STOPPED/);
  assert.match(resolution, /outcome === "UNCERTAIN"/);
  assert.match(resolution, /code === OPERATOR_STOP_CODE/);
  assert.match(resolution, /syncBlocked: false/);
  assert.match(stateRoute, /await normalizeRetryableShoplingSyncReportWithEvidence/);
  assert.match(syncRoute, /return normalizeRetryableShoplingSyncReportWithEvidence/);
});
