import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI 카테고리 실행은 기존 화면 핸들러보다 먼저 가로채고 검토함 저장까지 완료한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const runner = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-ai-reliable.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.ok(
    app.indexOf("category-ai.js") < app.indexOf("category-ai-reliable.js"),
  );
  assert.ok(
    app.indexOf("category-ai-reliable.js") <
      app.indexOf("category-review-queue-link.js"),
  );
  assert.match(
    runner,
    /document\.addEventListener\("click", interceptAiClick, true\)/,
  );
  assert.match(runner, /stopImmediatePropagation/);
  assert.doesNotMatch(runner, /readServerState/);
  assert.match(runner, /OPTIMIZED_API_PATH/);
  assert.match(runner, /operation: "bulk_patch_items"/);
  assert.match(runner, /saveServerCategoryPatches/);
  assert.match(runner, /categoryAiStatus: "review_required"/);
  assert.match(runner, /categoryAiMarketEvidence/);
  assert.match(runner, /모델명·옵션을 OpenAI가 분석하고 실제 샵플링 카테고리 후보/);
  assert.match(runner, /AI 분석에 실패한 .* 자동 재시도/);
  assert.match(runner, /categoryRetryDelayMs/);
  assert.match(runner, /실패 상세/);
  assert.match(runner, /const nextItems = previousState\.items\.map/);
  assert.match(runner, /persistCategoryResults/);
  assert.match(runner, /retryFailedIndividually/);
  assert.match(runner, /성공한 결과는 사라지지 않았습니다/);
  assert.match(runner, /updateReviewLinkCount\(nextState\)/);
  assert.match(runner, /AI_TIMEOUT_MS = 285_000/);
  assert.match(runner, /STATE_TIMEOUT_MS = 60_000/);
  assert.match(runner, /guardReviewNavigation/);
  assert.match(runner, /analysisActive = false;\s+activeController = null;\s+window\.location\.reload\(\)/);
  assert.doesNotMatch(runner, /고신뢰도 빈 카테고리는 자동입력하고, 나머지는 추천 이력으로 저장할까요/);
});

test("AI 카테고리 API는 OpenAI 전용 샵플링 분류와 웹검색 비활성화를 명시한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /export const maxDuration = 300/);
  assert.match(route, /timeoutMs: 60_000/);
  assert.match(route, /retryFailedIndividually/);
  assert.match(route, /useWebSearch: false/);
  assert.match(route, /provider: "openai_shopling_constrained_catalog"/);
  assert.match(route, /CATEGORY_ENGINE_VERSION = "openai-form-aware-shopling-v6"/);
  assert.match(route, /naverDependency: false/);
  assert.doesNotMatch(route, /generateNaverFirstShoplingCategoryRecommendations/);
  assert.match(route, /complete: failures\.length === 0/);
  assert.match(route, /autoApply: false/);
  assert.match(route, /완료된 상품은 보존하고 실패한 상품만 다시 실행/);
  assert.match(route, /status, headers: \{ "Cache-Control": "no-store" \}/);
});

