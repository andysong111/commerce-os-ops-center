import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("상품출시 진행관리 SEO handoff는 최대 50개 활성 등록회차를 유지하고 클릭마다 새 runId를 만든다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  assert.match(handoff, /MAX_BATCH_ITEMS = 50/);
  assert.match(handoff, /commerceOs\.seoBulkCloud\.batch\.v1/);
  assert.match(handoff, /\/seo-bulk-cloud/);
  assert.match(handoff, /mapLimit\(selectedIds, 8/);
  assert.match(handoff, /runId: newId\("seo-run"\)/);
  assert.match(handoff, /runCreatedAt: now/);
  assert.match(handoff, /mergePendingItems\(previousItems, runItems\)/);
  assert.match(handoff, /seenRunIds/);
  assert.doesNotMatch(handoff, /merged\.set\(id/);
});

test("입고대기중 또는 재료부족 상품은 SEO 클라우드를 열기 전에 멈춘다", async () => {
  const [handoff, route] = await Promise.all([
    source("public/product-launch-tracker-app/seo-title-ledger-handoff.js"),
    source("src/app/api/seo-run-jobs/route.ts"),
  ]);
  assert.match(handoff, /firstSelectedReadinessBlocker/);
  assert.match(handoff, /receiptPendingFromItem/);
  assert.match(handoff, /입고확정 후 SEO 대량등록을 진행하세요/);
  assert.doesNotMatch(handoff, /status === "RECEIVED"\) return false/);
  assert.match(route, /productLaunchSeoMaterialReadiness/);
  assert.match(route, /materialReadiness\.receiptPending/);
});

test("SEO Run 클라우드는 상품간 3개 병렬, 같은 상품 회차는 순차로 기존 STEP API를 실행한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const client = await source("src/app/seo-bulk-cloud/SeoBulkRunCloudClient.tsx");
  assert.match(page, /SeoBulkRunCloudClient/);
  assert.match(client, /GENERATION_CONCURRENCY = 3/);
  assert.match(client, /REGISTRATION_CONCURRENCY = 3/);
  assert.match(client, /groupByItem/);
  assert.match(client, /for \(const row of group\)/);
  for (const action of [
    "collect_bulk_source",
    "analyze_identity",
    "discover_keywords",
    "score_keywords",
    "expand_from_passing",
    "filter_prohibited_keywords",
    "generate_title",
    "compose_bulk_final",
  ]) {
    assert.match(client, new RegExp(`action: \\"${action}\\"`));
  }
  assert.match(client, /variationSeed: row\.runId/);
  assert.match(client, /excludedMallTitles: exclusions/);
  assert.match(client, /FINAL RESULT · 검색어 10개/);
  assert.match(client, /Shopling 일괄 대량등록/);
  assert.match(client, /상품명·쇼핑몰 29개·회차 정보 펼치기/);
  assert.match(client, /operation: "patch_item"/);
});

test("bulk final API는 회차 seed와 과거 상품명 제외목록을 fresh composer에 전달한다", async () => {
  const route = await source("src/app/api/keyword-engine-elon-lab/route.ts");
  const engine = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const fresh = await source("src/lib/keywordEngineElonFreshMallTitleComposer.ts");
  assert.match(route, /runInstanceVariationAvailable: true/);
  assert.match(route, /variationSeed/);
  assert.match(route, /excludedMallTitles/);
  assert.match(engine, /composeFreshKeywordElonMallTitles/);
  assert.match(engine, /SEO_RUN_VARIATION_SEED/);
  assert.match(fresh, /freshnessScore/);
  assert.match(fresh, /SEO_RUN_EXACT_TITLE_REUSE/);
  assert.match(fresh, /SEO_RUN_REORDER_ONLY_REUSE/);
  assert.match(engine, /searchKeywords\.length !== 10/);
  assert.match(engine, /mallTitles\.length !== 29/);
});

test("검색어 부족은 AI+결정형 후보를 STEP4 안전필터에 통과시켜 정확히 10개로 보충한다", async () => {
  const route = await source("src/app/api/keyword-engine-elon-lab/route.ts");
  const recovery = await source("src/lib/keywordEngineElonBulkKeywordRecovery.ts");
  assert.match(route, /generateSafeBulkKeywordSupplements/);
  assert.match(route, /FINAL 검색어가 10개가 아닙니다/);
  assert.match(route, /supplementalSearchKeywords/);
  assert.match(recovery, /KEYWORD_ENGINE_OPENAI_API_KEY/);
  assert.match(recovery, /filterKeywordElonProhibitedKeywords/);
  assert.match(recovery, /buildDeterministicBulkKeywordRecoverySeeds/);
});

test("aborted/failed fetch와 일시적 5xx는 키워드 API에서만 제한 병렬로 자동 재시도한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const recovery = await source("src/app/seo-bulk-cloud/SeoBulkFetchRecovery.tsx");
  assert.match(page, /SeoBulkFetchRecovery/);
  assert.match(recovery, /\/api\/keyword-engine-elon-lab/);
  assert.match(recovery, /RETRY_DELAYS_MS = \[0, 800, 2_000, 4_500, 8_000, 14_000, 22_000\]/);
  assert.match(recovery, /MAX_CONCURRENT_KEYWORD_REQUESTS = 2/);
  assert.doesNotMatch(recovery, /shopling-upload/);
});

test("OPS 기능카드는 대량 클라우드를 기본 진입점으로 유지한다", async () => {
  const moduleFile = await source("src/lib/keywordEngineElonLabModule.ts");
  assert.match(moduleFile, /route: "\/seo-bulk-cloud"/);
  assert.match(moduleFile, /여러 상품을 선택/);
  assert.match(moduleFile, /Shopling 일괄 대량등록/);
});

test("같은 상품을 여러 번 눌러도 상품 id로 합치지 않고 runId별 카드가 누적된다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  assert.match(handoff, /normalizeRunItem/);
  assert.match(handoff, /seenRunIds/);
  assert.match(handoff, /runId: newId\("seo-run"\)/);
  assert.match(handoff, /const mergedItems = mergePendingItems\(previousItems, runItems\)/);
  assert.doesNotMatch(handoff, /new Map\(.*item\.id/s);
});

test("열려 있는 SEO 클라우드는 storage event로 새 등록회차를 자동 합류시킨다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  const client = await source("src/app/seo-bulk-cloud/SeoBulkRunCloudClient.tsx");
  assert.match(handoff, /새 SEO 등록 회차를 기존 클라우드에 추가했습니다/);
  assert.match(client, /window\.addEventListener\("storage", onStorage\)/);
  assert.match(client, /event\.key === BATCH_STORAGE_KEY/);
  assert.match(client, /syncFromStorage/);
});

test("기등록 여부와 무관하게 하나의 일괄등록 버튼이 첫 등록과 force 추가등록을 자동 분기한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const client = await source("src/app/seo-bulk-cloud/SeoBulkRunCloudClient.tsx");
  assert.doesNotMatch(page, /SeoBulkInventoryReadyReregister/);
  assert.doesNotMatch(page, /SeoBulkInventoryReregisterBridge/);
  assert.match(client, /const hasExistingGoods = itemGoodsKeys\(original\)\.length > 0/);
  assert.match(client, /force: hasExistingGoods/);
  assert.match(client, /newSelfCodeBase = nextSelfCode\(\)/);
  assert.match(client, /registrationType: hasExistingGoods \? "seo_inventory_append" : "seo_run_initial"/);
  assert.match(client, /shoplingRegistrationHistory/);
});

test("등록완료 보관은 상품 원본 archivedAt을 건드리지 않고 runId 카드만 제거한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const client = await source("src/app/seo-bulk-cloud/SeoBulkRunCloudClient.tsx");
  assert.doesNotMatch(page, /SeoBulkCompletionArchiveBridge/);
  assert.match(client, /등록완료 카드 보관/);
  assert.match(client, /current\.items\.filter\(\(item\) => !remove\.has\(item\.runId\)\)/);
  assert.doesNotMatch(client, /archive_items/);
  assert.doesNotMatch(client, /archivedAt: true/);
});

test("SEO 대량등록은 6개 goods_key 후처리의 pending/failed 상태를 백그라운드에서 자동 재확인한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const recovery = await source("src/app/seo-bulk-cloud/SeoBulkMallSeoRecoveryBridge.tsx");
  assert.match(page, /SeoBulkMallSeoRecoveryBridge/);
  assert.match(recovery, /CHECK_INTERVAL_MS = 6000/);
  assert.match(recovery, /EXPECTED_GOODS_KEY_COUNT = 6/);
  assert.match(recovery, /EXPECTED_MALL_TITLE_COUNT = 29/);
  assert.match(recovery, /\/api\/product-launch-tracker\/shopling-mall-seo/);
});

test("SEO 대량등록 클라우드는 직접 금지키워드를 입력·저장하고 미등록 RUN을 STEP4부터 재검증할 수 있다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const panel = await source("src/app/seo-bulk-cloud/SeoBulkCustomBlockedTermsPanel.tsx");
  const route = await source("src/app/api/seo-run-custom-blocked-terms/route.ts");
  assert.match(page, /SeoBulkCustomBlockedTermsPanel/);
  assert.match(panel, /직접 금지키워드/);
  assert.match(panel, /쉼표 또는 엔터/);
  assert.match(panel, /기본값 저장/);
  assert.match(panel, /현재 미등록 RUN에도 적용/);
  assert.match(panel, /keywordEngineElonLab\.step4\.customBlockedTerms\.v1/);
  assert.match(route, /customBlockedTerms/);
  assert.match(route, /stage: "filter_keywords"/);
  assert.match(route, /stage_index: 5/);
  assert.match(route, /registration_status/);
  assert.match(route, /job\.status !== "running"/);
});
