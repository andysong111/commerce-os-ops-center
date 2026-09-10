import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildStockWorkerV030 } from "../scripts/build-shopling-stock-worker-v030.mjs";
const root = "public/shopling-stock-state-sync";

test("v0.5.5 option route is A6-readonly -> API -> proven A21 while single remains A4-A21 and A22 is absent", async () => {
  const [overlay, legacy, worker, route] = await Promise.all([
    readFile(`${root}/background-v052.js`, "utf8"),
    readFile(`${root}/background-v020.js`, "utf8"),
    readFile(`${root}/content-shopling-v018.js`, "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
  ]);
  assert.match(overlay, /productKind === "OPTION" \? \["A6", "A21_LIST"\]/);
  assert.match(overlay, /STOCK_SYNC_APPLY_OPTION_STATUS_V054/);
  assert.match(overlay, /active\.stage = "A21_LIST"/);
  assert.match(route, /a6Mutation: "NONE_READ_ONLY_RESOLVER"/);
  assert.match(route, /a6Checkbox: "NOT_TOUCHED"/);
  assert.match(route, /a21ListClick: "PROVEN_PRICE_OPTION_RESEND_DIRECT_NO_VISIBILITY_FILTER"/);
  assert.match(legacy, /\["A4", "A21_LIST"\]/);
  assert.doesNotMatch(overlay, /A22/);
  assert.doesNotMatch(worker, /runA22/);
});

test("A6 exact B-code reads control values and goods keys without checkbox or status mutation", async () => {
  const [overlay, template, policy, route, ops] = await Promise.all([
    readFile(`${root}/background-v052.js`, "utf8"),
    readFile(`${root}/content-shopling-v018.js`, "utf8"),
    readFile(`${root}/search-policy-v023.js`, "utf8"),
    readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8"),
    readFile(`${root}/content-ops-v021.js`, "utf8"),
  ]);
  const worker = buildStockWorkerV030(template, policy);
  assert.match(worker, /rowEvidenceTextV053/);
  assert.match(worker, /values\.push\(control\.value \|\| ""\)/);
  assert.match(route, /patchA6ReadOnlyResolverV054/);
  assert.match(route, /const resultRows = \[\.\.\.document\.querySelectorAll\("tr"\)\]/);
  assert.match(route, /A6_BCODE_RESULT_ROW_NOT_FOUND/);
  assert.match(route, /A6_BCODE_GOODSKEY_NOT_FOUND/);
  assert.match(route, /checkboxTouched: false/);
  assert.match(route, /optionStatusTouched: false/);
  assert.match(route, /shopling_stock_a6_readonly_patch_contains_mutation/);
  assert.match(overlay, /active\.job\.goodsKeys = discoveredGoodsKeys/);
  assert.match(overlay, /applyOptionStatusViaOpsV054/);
  assert.match(ops, /goodsKeys: \[goodsKey\]/);
  assert.match(worker, /A21_EXACT_ROW_BINDING_MISMATCH/);
  assert.match(worker, /A21_RESULT_OVER_200_BATCH_LIMIT/);
  assert.match(worker, /resultCountSource = reportedCountAvailable \? "SHOPLING_TOTAL_TEXT" : "EXACT_BOUND_ROWS"/);
});

test("v0.5.5 uses canonical cross-frame A21 direct click without the legacy main-click helper", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /patchA21ProvenListClickV055/);
  assert.match(route, /PROVEN_A21_LIST_DIRECT_CLICK_CANONICAL_CROSS_FRAME/);
  assert.match(route, /a21AccessibleDocumentsV056/);
  assert.match(route, /scope\.doc\.querySelectorAll\(selector\)/);
  assert.match(route, /CANONICAL_PRICE_EXTENSION_CURRENT_THEN_ACCESSIBLE_FRAMES/);
  assert.match(route, /button\.click\(\)/);
  assert.match(route, /shopling_stock_a21_proven_list_click_legacy_main_click_present/);
  assert.match(route, /const provenA21Worker = patchA21ProvenListClickV055\(readOnlyWorker\)/);
});

test("v0.5.5 preserves the proven price popup core literally and bounded claim race retry", async () => {
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

test("server option mutation is reused per discovered goods key and preserves quantity", async () => {
  const [api, ops, background] = await Promise.all([
    readFile("src/lib/shopling/shoplingOptionStatus.ts", "utf8"),
    readFile(`${root}/content-ops-v021.js`, "utf8"),
    readFile(`${root}/background-v052.js`, "utf8"),
  ]);
  assert.match(api, /variant\.partnerOptionCode === barcode/);
  assert.match(api, /matches\.length !== 1/);
  assert.match(api, /SHOPLING_OPTION_EXACT_MATCH_REQUIRED/);
  assert.match(api, /after\.optionQuantity !== before\.optionQuantity/);
  assert.match(ops, /inventory-stock-control\/shopling-option-status/);
  assert.match(ops, /goodsKeys: \[goodsKey\]/);
  assert.match(ops, /matchedGoodsKey !== goodsKey/);
  assert.match(background, /optionApiApplied = true/);
  assert.match(background, /optionApiEvidence = apiResult\.results/);
});

test("ZIP generates v0.5.5 readonly-A6 package with canonical cross-frame A21 and serial popup contract", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.5\.5"/);
  assert.match(route, /background-v052\.js/);
  assert.match(route, /content-a21-price-core-v050\.js/);
  assert.match(route, /main-a21-price-core-v050\.js/);
  assert.match(route, /content-stock-result-v050\.js/);
  assert.match(route, /priceCoreLiteralCopyVerified: true/);
  assert.match(route, /A6_READ_ONLY_BCODE_GOODSKEYS_THEN_API_STATUS_THEN_A21_CANONICAL_CROSS_FRAME_HF3/);
  assert.match(route, /hotfix: "HF3_CANONICAL_A21_CROSS_FRAME"/);
  assert.match(route, /a6Mutation: "NONE_READ_ONLY_RESOLVER"/);
  assert.match(route, /a6Checkbox: "NOT_TOUCHED"/);
  assert.match(route, /optionLocalMutation: "SHOPLING_API_PER_DISCOVERED_GOODSKEY"/);
  assert.match(route, /ALL_DISCOVERED_DEDUP_SERIAL_COMPLETE_REQUIRED/);
  assert.match(route, /a21ListClick: "PROVEN_PRICE_OPTION_RESEND_DIRECT_NO_VISIBILITY_FILTER"/);
  assert.match(route, /a21ListFrameStrategy: "CURRENT_FRAME_THEN_ALL_ACCESSIBLE_SHOPLING_FRAMES"/);
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
