import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingCategoryApprovalExamples,
  computeShoplingCategoryAccuracyMetrics,
  findShoplingCategoryApprovalPrior,
} from "../src/lib/shoplingCategoryLearning.ts";

test("검토 패널은 후보가 없어도 상품과 재분석 버튼을 유지한다", async () => {
  const component = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryCoreNounReview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const page = await readFile(
    new URL("../src/app/shopling-category-review-queue/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /loadStateWithRetry/);
  assert.match(component, /attempt <= 3/);
  assert.match(component, /후보 다시 생성/);
  assert.match(component, /item\.candidates\.length \?/);
  assert.match(component, /기존 후보가 모델명의 핵심 제품명사와 맞지 않아 숨겼습니다/);
  assert.match(component, /관련 카테고리를 찾지 못해 검토 상태로 유지/);
  assert.match(component, /OpenAI 모델명 의미 분석/);
  assert.match(component, /categoryAiMarketEvidence/);
  assert.match(page, /ShoplingCategoryCoreNounReview/);
  assert.doesNotMatch(page, /ShoplingCategoryCandidateQuickApprove/);
});

test("optimized tracker mutation은 대용량 state 저장 시 별도 긴 제한시간과 축소 응답을 사용한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/optimized/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const runner = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-ai-reliable.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(route, /const MUTATION_READ_TIMEOUT_MS = 15_000/);
  assert.match(route, /const MUTATION_WRITE_TIMEOUT_MS = 20_000/);
  assert.match(route, /select: "updated_at,schema_version"/);
  assert.match(route, /MUTATION_READ_TIMEOUT_MS/);
  assert.match(route, /product_launch_tracker_mutation_failed/);
  assert.match(runner, /const STATE_TIMEOUT_MS = 60_000/);
});

test("상품출시관리 AI 카테고리 결과는 전체 state 재전송 없이 scoped bulk patch로 저장한다", async () => {
  const runner = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-ai-reliable.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(runner, /OPTIMIZED_API_PATH = "\/api\/product-launch-tracker\/optimized"/);
  assert.match(runner, /operation: "bulk_patch_items"/);
  assert.match(runner, /saveServerCategoryPatches/);
  assert.match(runner, /categoryAiEngineVersion/);
  assert.match(runner, /patches\.push\(\{ itemId:/);
  assert.doesNotMatch(runner, /async function readServerState/);
  assert.doesNotMatch(runner, /partialPage: true/);
  assert.doesNotMatch(runner, /body: JSON\.stringify\(\{ state \}\)/);
});

test("검토함은 재생성 상품 선택과 승인 후보 선택을 분리해 일괄 처리한다", async () => {
  const component = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryCoreNounReview.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(component, /type="checkbox"/);
  assert.match(component, /재생성 대상 전체 선택 · \{reviews\.length\}건/);
  assert.match(component, /선택 상품 후보 일괄 재생성/);
  assert.match(component, /선택 후보 일괄 승인/);
  assert.match(component, /candidateSelections/);
  assert.match(component, /toggleCandidateSelection/);
  assert.match(component, /selectedCandidate === candidate/);
  assert.match(component, /한 상품에서는 후보 하나만 선택됩니다/);
  assert.match(component, /bulkApproveSelectedCandidates/);
  assert.doesNotMatch(component, /bulkApproveFirstCandidates/);
  assert.match(component, /직접 선택한 후보 \$\{decisions\.length\}건을 일괄 승인합니다/);
  assert.match(component, /AI 카테고리 검토함 · 직접 선택 일괄 승인/);
  assert.match(component, /review\?\.candidates\.includes\(category\)/);
  assert.match(component, /const AI_BATCH_SIZE = 5/);
  assert.match(component, /offset \+= AI_BATCH_SIZE/);
  assert.match(component, /requestAiCandidates\(batch\)/);
  assert.match(component, /requestAiCandidates\(\[source\]\)/);
  assert.match(component, /window\.confirm/);
  assert.match(component, /실패한 \$\{failedSet\.size\}건만 선택 상태로 남겼습니다/);
});

test("카테고리 승인 시 scoped 저장 후 검토함에서 제거하고 상품원장까지 동기화한다", async () => {
  const component = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryCoreNounReview.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(component, /operation: "approve_category_ai_reviews"/);
  assert.match(component, /PRODUCT_MASTER_SYNC_ENDPOINT/);
  assert.match(component, /\/api\/product-launch-tracker\/product-master-sync/);
  assert.match(component, /const latest = await requireServerState\(\)/);
  assert.match(component, /setState\(latest\)/);
  assert.match(component, /상품출시 진행관리·상품원장에 저장했습니다/);
  assert.doesNotMatch(component, /applyShoplingCategoryReviewDecisions/);
});

test("카테고리 검토함은 전체 비우기 버튼으로 AI 검토 메타데이터만 서버에서 제거한다", async () => {
  const component = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryCoreNounReview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const optimized = await readFile(
    new URL("../src/lib/productLaunchTrackerOptimized.ts", import.meta.url),
    "utf8",
  );

  assert.match(component, /OPTIMIZED_ENDPOINT = "\/api\/product-launch-tracker\/optimized"/);
  assert.match(component, /검토함 모두 비우기/);
  assert.match(component, /clearReviewQueue/);
  assert.match(component, /operation: "clear_category_ai_review"/);
  assert.match(component, /이미 확정된 샵플링 표준 카테고리는 유지됩니다/);
  assert.match(component, /key\.startsWith\("categoryAi"\)/);
  assert.match(optimized, /operation === "clear_category_ai_review"/);
  assert.match(optimized, /key\.startsWith\("categoryAi"\)/);
  assert.doesNotMatch(component, /shoplingCategory: ""/);
});

test("승인 정답 이력은 유사 상품의 샵플링 경로 prior와 Top-1·Top-3 지표로 누적된다", () => {
  const state = {
    items: [
      {
        id: "approved-1",
        modelNumber: "AAA001",
        productName: "실리콘 골무 손가락 보호대",
        orderOptions: [{ saleOption: "단품" }],
        shoplingCategory: "문구/취미>수예>재봉용품>골무",
        categoryAiStatus: "review_approved",
        categoryAiSuggestion: "문구/취미>수예>재봉용품>골무",
        categoryAiCandidateChoices: [
          "문구/취미>수예>재봉용품>골무",
          "생활/건강>보호용품>손가락보호대>기타",
        ],
        categoryAiApprovedValue: "문구/취미>수예>재봉용품>골무",
        categoryAiReviewedAt: "2026-08-15T00:00:00.000Z",
      },
      {
        id: "approved-2",
        modelNumber: "AAA002",
        productName: "재봉 골무",
        orderOptions: [],
        shoplingCategory: "문구/취미>수예>재봉용품>골무",
        categoryAiStatus: "review_approved",
        categoryAiSuggestion: "생활/건강>보호용품>손가락보호대>기타",
        categoryAiCandidateChoices: [
          "생활/건강>보호용품>손가락보호대>기타",
          "문구/취미>수예>재봉용품>골무",
        ],
        categoryAiApprovedValue: "문구/취미>수예>재봉용품>골무",
        categoryAiReviewedAt: "2026-08-15T00:01:00.000Z",
      },
    ],
  };
  const examples = buildShoplingCategoryApprovalExamples(state);
  const metrics = computeShoplingCategoryAccuracyMetrics(state);
  assert.equal(examples.length, 2);
  assert.equal(metrics.approvedCount, 2);
  assert.equal(metrics.top1Correct, 1);
  assert.equal(metrics.top3Covered, 2);
  assert.equal(metrics.top1Rate, 50);
  assert.equal(metrics.top3Rate, 100);

  const prior = findShoplingCategoryApprovalPrior(
    {
      itemId: "new-item",
      modelNumber: "AAA999",
      productName: "재봉용 실리콘 골무",
      optionLabels: ["단품"],
      currentCategory: "",
      chinaProductLinks: [],
    },
    examples,
    new Set(["문구/취미>수예>재봉용품>골무"]),
  );
  assert.equal(prior?.path, "문구/취미>수예>재봉용품>골무");
});

test("카테고리 API는 네이버 없이 OpenAI가 실제 샵플링 후보 안에서만 선택한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /CATEGORY_ENGINE_VERSION = "openai-semantic-shopling-v5"/);
  assert.match(route, /generateReliableShoplingCategoryRecommendations/);
  assert.match(route, /useWebSearch: false/);
  assert.doesNotMatch(route, /skipSearchProfiles: true/);
  assert.match(route, /categoryMode: "openai_only"/);
  assert.match(route, /naverDependency: false/);
  assert.doesNotMatch(route, /generateNaverFirstShoplingCategoryRecommendations/);
  assert.doesNotMatch(route, /rerankNaverGroundedShoplingRecommendations/);
  assert.doesNotMatch(route, /NAVER_CLIENT_ID|NAVER_CLIENT_SECRET/);
  assert.match(catalog, /shortlistShoplingCategories/);
  assert.match(catalog, /candidatePaths: candidatesByItem/);
  assert.match(catalog, /if \(!candidatePaths\.includes\(selectedPath\)\)/);
  assert.match(catalog, /후보에 없는 경로를 새로 만들거나 철자를 바꾸지 않는다/);
  assert.match(catalog, /SHOPLING_CATEGORY_OPENAI_API_KEY/);
});


test("OpenAI-only 경로는 상품 정체성 의미분석 후 샵플링 후보를 만들고 최종 후보를 선택한다", async () => {
  const runner = await readFile(
    new URL(
      "../src/lib/shoplingCategoryRecommendationRunner.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );

  assert.match(runner, /CATEGORY_BATCH_SIZE = 5/);
  assert.match(runner, /SEARCH_PROFILE_BATCH_SIZE = 5/);
  assert.match(runner, /CATEGORY_RECOMMENDATION_TIMEOUT_MS = 55_000/);
  assert.match(runner, /SEARCH_PROFILE_TIMEOUT_MS = 55_000/);
  assert.match(runner, /SEARCH_PROFILE_FALLBACK_RETRY_TIMEOUT_MS = 35_000/);
  assert.match(catalog, /if \(!webSearchEnabled\)/);
  assert.match(catalog, /timeoutMs: totalTimeoutMs/);
  assert.match(catalog, /모델명 전체를 하나의 상품명으로 먼저 해석한다/);
  assert.match(catalog, /'꿩안경'은 사람용 안경이 아니라/);
  assert.match(catalog, /'멀티탭 트레이'는 주방 쟁반이 아니라/);
  assert.match(catalog, /'은박담요'는 일반 침구 담요보다/);
  assert.match(catalog, /'차량용 무지 트레블백'/);
});


test("수동 카테고리는 상품별 접이식 입력으로 최소화하고 드롭다운·검색·전체경로 복붙을 함께 지원한다", async () => {
  const page = await readFile(
    new URL("../src/app/shopling-category-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  const picker = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryManualPicker.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const catalogRoute = await readFile(
    new URL("../src/app/api/shopling-categories/catalog/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(page, /ShoplingCategoryManualPicker/);
  assert.match(picker, /reviewItems\.map/);
  assert.match(picker, /<details/);
  assert.match(picker, /수동 지정 · 검색/);
  assert.match(picker, /CompactCategorySelect/);
  assert.match(picker, /label="대"/);
  assert.match(picker, /label="중"/);
  assert.match(picker, /label="소"/);
  assert.match(picker, /label="세"/);
  assert.match(picker, /카테고리 검색 \/ 전체 경로 복붙/);
  assert.match(picker, /searchCatalog/);
  assert.match(picker, /검색 결과 \{index \+ 1\}/);
  assert.match(picker, /confirmTypedPath/);
  assert.match(picker, /경로 확인/);
  assert.match(picker, /수동 승인/);
  assert.match(picker, /catalogPathByKey/);
  assert.match(picker, /현재 샵플링 카탈로그에 없는 경로는 승인할 수 없습니다/);
  assert.match(picker, /Top-1/);
  assert.match(picker, /Top-3/);
  assert.doesNotMatch(picker, /검토 상품 선택/);
  assert.match(catalogRoute, /fetchShoplingCategorySnapshot/);
  assert.match(catalogRoute, /resolveProductLaunchIdentity/);
  assert.match(catalogRoute, /categories: snapshot\.categories\.map/);
});

test("상품별 수동 경로는 먼저 임시 보존하고 선택한 경로를 한 번에 일괄 승인한다", async () => {
  const picker = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryManualPicker.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(picker, /MANUAL_DRAFTS_STORAGE_KEY/);
  assert.match(picker, /window\.sessionStorage\.setItem/);
  assert.match(picker, /readStoredDrafts/);
  assert.match(picker, /manualSelections/);
  assert.match(picker, /bulkApproveManualPaths/);
  assert.match(picker, /수동 선택 \{manualSelections\.length\}건/);
  assert.match(picker, /수동 선택 일괄 승인/);
  assert.match(picker, /AI 카테고리 검토함 · 수동 선택 일괄 승인/);
  assert.match(picker, /applyShoplingCategoryReviewDecisions\(latest, decisions/);
  assert.match(picker, /최신 진행관리 상태와 실제 카탈로그 경로를 다시 확인/);
  assert.match(picker, /다른 상품의 수동 선택값은 유지됩니다/);
  assert.doesNotMatch(picker, /window\.location\.reload/);
});

test("AI API는 관련 후보가 없을 때 엉뚱한 경로 대신 빈 검토 결과를 반환한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /generateReliableShoplingCategoryRecommendations/);
  assert.doesNotMatch(route, /shortlistShoplingCategories/);
  assert.match(catalog, /noMatchRecommendation/);
  assert.match(catalog, /selectedPath: ""/);
  assert.match(catalog, /confidence: 0/);
  assert.match(catalog, /엉뚱한 후보는 제시하지 않고 검토 상태로 남겼습니다/);
  assert.match(catalog, /matchKind: "none"/);
});
