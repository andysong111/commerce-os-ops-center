import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OpenAiStructuredOutputIncompleteError,
  parseOpenAiStructuredOutput,
  recommendationOutputTokenBudget,
} from "../src/lib/openAiStructuredOutput.ts";
import { isRetryableCategoryOutputError } from "../src/lib/shoplingCategoryRecommendationRunner.ts";

test("불완전하거나 잘린 OpenAI JSON을 재시도 가능한 오류로 변환한다", () => {
  assert.throws(
    () =>
      parseOpenAiStructuredOutput({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: '{"results":[{"itemId":"a","selectedPath":"생활/건강',
      }),
    OpenAiStructuredOutputIncompleteError,
  );
  assert.throws(
    () =>
      parseOpenAiStructuredOutput({
        status: "completed",
        output_text: '{"results":[{"itemId":"a","reason":"중간',
      }),
    /중간에서 잘렸거나 완성되지 않았습니다/,
  );
  assert.equal(
    isRetryableCategoryOutputError(
      new SyntaxError("Unterminated string in JSON at position 505"),
    ),
    true,
  );
});

test("완성된 구조화 JSON은 원문을 훼손하지 않고 파싱한다", () => {
  assert.deepEqual(
    parseOpenAiStructuredOutput({
      status: "completed",
      output_text:
        '{"results":[{"itemId":"a","selectedPath":"생활/건강>수예>골무","reason":"모델명 골무 기준"}]}',
    }),
    {
      results: [
        {
          itemId: "a",
          selectedPath: "생활/건강>수예>골무",
          reason: "모델명 골무 기준",
        },
      ],
    },
  );
});

test("상품 수에 따라 출력 예산을 확장하고 재시도 때 더 늘린다", () => {
  const first = recommendationOutputTokenBudget(4, 0);
  const retry = recommendationOutputTokenBudget(4, 1);
  assert.ok(first > 2600);
  assert.ok(retry > first);
});

test("AI 카테고리 API는 의미 분석과 상품별 추천을 병렬화하고 부분 성공을 보존한다", async () => {
  const runner = await readFile(
    new URL(
      "../src/lib/shoplingCategoryRecommendationRunner.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(runner, /CATEGORY_BATCH_SIZE = 5/);
  assert.match(runner, /CATEGORY_BATCH_CONCURRENCY = 3/);
  assert.match(runner, /CATEGORY_RECOMMENDATION_TIMEOUT_MS = 55_000/);
  assert.match(runner, /SEARCH_PROFILE_BATCH_SIZE = 5/);
  assert.match(runner, /SEARCH_PROFILE_BATCH_CONCURRENCY = 3/);
  assert.match(runner, /SEARCH_PROFILE_TIMEOUT_MS = 55_000/);
  assert.match(runner, /SEARCH_PROFILE_FALLBACK_RETRY_TIMEOUT_MS = 35_000/);
  assert.match(runner, /generateShoplingCategorySearchProfiles/);
  assert.match(runner, /generateSearchProfilesWithRecovery/);
  assert.match(runner, /searchProfiles/);
  assert.match(runner, /mapWithConcurrencySettled/);
  assert.match(runner, /status: failures\.length \? "partial" : "success"/);
  assert.match(runner, /failureById/);
  assert.match(runner, /두 번 연속 중간에서 잘렸습니다/);
  assert.match(route, /generateReliableShoplingCategoryRecommendations/);
  assert.doesNotMatch(route, /Unterminated string in JSON at position/);
  assert.match(route, /retryFailedIndividually/);
  assert.match(route, /failures/);
});
