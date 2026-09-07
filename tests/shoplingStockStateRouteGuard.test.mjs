import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.5.2 option route is live A6-A21 while single route remains A4-A21 and A22 is absent", async () => {
  const [overlay, legacy, worker] = await Promise.all([
    readFile(`${root}/background-v052.js`, "utf8"),
    readFile(`${root}/background-v020.js`, "utf8"),
    readFile(`${root}/content-shopling-v018.js`, "utf8"),
  ]);
  assert.match(overlay, /productKind === "OPTION" \? \["A6", "A21_LIST"\]/);
  assert.match(overlay, /goodsKeySource: "A6_LIVE_OPTION_BARCODE"/);
  assert.match(legacy, /\["A4", "A21_LIST"\]/);
  assert.doesNotMatch(overlay, /A22/);
  assert.doesNotMatch(worker, /runA22/);
});

test("A6 live exact B-code resolves all goods keys while A21 fans out exact marketplace rows up to 200", async () => {
  const overlay = await readFile(`${root}/background-v052.js`, "utf8");
  const template = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  const policy = await readFile(`${root}/search-policy-v023.js`, "utf8");
  const worker = buildStockWorkerV030(template, policy);
  assert.match(overlay, /active\.job\.goodsKeys = discoveredGoodsKeys/);
  assert.match(overlay, /A6_BCODE_GOODSKEY_NOT_FOUND/);
  assert.match(worker, /discoveredGoodsKeys/);
  assert.match(worker, /A6_RESULT_PAGE_INCOMPLETE/);
  assert.match(worker, /A21_EXACT_BATCH_SELECTION_FAILED/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /setA21PageSize200V042/);
  assert.match(worker, /batchLimit: 200/);
});

test("v0.5.2 preserves the proven price popup core literally and bounded claim race retry", async () => {
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
  assert.match(route, /stock_price_core_not_option_popup_stage/);
  assert.match(route, /attempt < 16/);
});

test("legacy server option mutation remains fail-closed but is not v0.5.2 runtime authority", async () => {
  const [api, ops] = await Promise.all([
    readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8"),
    readFile(`${root}/content-ops-v021.js`, "utf8"),
  ]);
  assert.match(api, /variant\.partnerOptionCode === barcode/);
  assert.match(api, /matches\.length !== 1/);
  assert.match(api, /SHOPLING_OPTION_EXACT_MATCH_REQUIRED/);
  assert.match(api, /after\.optionQuantity !== before\.optionQuantity/);
  assert.doesNotMatch(ops, /shopling-option-status/);
  assert.match(ops, /A6_LIVE_GOODSKEY_DISCOVERY/);
});

test("ZIP generates v0.5.2 live-A6 package with all-goods-key serial contract", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.5\.2"/);
  assert.match(route, /background-v052\.js/);
  assert.match(route, /content-a21-price-core-v050\.js/);
  assert.match(route, /main-a21-price-core-v050\.js/);
  assert.match(route, /content-stock-result-v050\.js/);
  assert.match(route, /priceCoreLiteralCopyVerified: true/);
  assert.match(route, /A6_LIVE_BCODE_ALL_GOODSKEYS_THEN_A21_SERIAL_PRICE_CORE_V052/);
  assert.match(route, /ALL_DISCOVERED_DEDUP_SERIAL_COMPLETE_REQUIRED/);
  assert.match(route, /a21PopupClaimRetry/);
  assert.match(route, /a21BatchLimit: 200/);
});

test("explicit operator safe-stop and pre-HF1 marketplace-failure completion are retryable without weakening other UNCERTAIN blocks", async () => {
  const resolution = await readFile("src/lib/inventoryStockSyncResolution.ts", "utf8");
  const stateRoute = await readFile("src/app/api/inventory-stock-control/route.ts", "utf8");
  const syncRoute = await readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8");
  assert.match(resolution, /STOCK_SYNC_OPERATOR_STOPPED/);
  assert.match(resolution, /outcome === "UNCERTAIN"/);
  assert.match(resolution, /code === OPERATOR_STOP_CODE/);
  assert.match(resolution, /legacyMarketplaceFailureCompletionEvidence/);
  assert.match(resolution, /result\.optionComplete/);
  assert.match(resolution, /result\.productComplete/);
  assert.match(resolution, /result\.readyState/);
  assert.match(resolution, /result\.failureCount/);
  assert.match(resolution, /result\.explicitFailure/);
  assert.match(resolution, /retryableOperatorStop\s*\|\|\s*retryableLegacyMarketplaceFailure/);
  assert.match(resolution, /syncBlocked: false/);
  assert.match(stateRoute, /normalizeRetryableShoplingSyncReportWithEvidence\(/);
  assert.match(stateRoute, /overlayInventoryStockControlReportWithTail\(/);
  assert.match(syncRoute, /normalizeRetryableShoplingSyncReportWithEvidence\(/);
  assert.match(syncRoute, /overlayInventoryStockControlReportWithTail\(/);
});

test("inventory stock control accepts both one-letter and two-letter B-code prefixes", async () => {
  const [inventory, panel] = await Promise.all([
    readFile("src/lib/inventoryStockControl.ts", "utf8"),
    readFile("src/components/china-order-manager/InventoryStockControlPanel.tsx", "utf8"),
  ]);
  assert.ok(inventory.includes("const BARCODE_PATTERN = /^B[A-Z]{1,2}\\d+-\\d+$/;"));
  assert.ok(panel.includes("/^B[A-Z]{1,2}\\d+-\\d+$/"));
  assert.match(panel, /BZ7341-1 또는 BCC3-2/);
});

test("inventory stock control self-heals stale canonical sales coverage", async () => {
  const route = await readFile("src/app/api/inventory-stock-control/route.ts", "utf8");
  assert.match(route, /latestCanonicalCoverageGapResetAt/);
  assert.match(route, /\.filter\(\(row\) => !row\.salesCoverageReady\)/);
  assert.match(route, /createCanonicalSalesCoverageRequest\(resetMs\)/);
  assert.match(route, /createdAnalysisMs < resetMs/);
  assert.match(route, /supersededStaleRequest: staleRequestWasActive/);
  assert.match(route, /canonicalSalesRefresh = coverageGapResetAt/);
  assert.match(route, /ensureCanonicalSalesCoverageAfterReset\(coverageGapResetAt\)/);
});
