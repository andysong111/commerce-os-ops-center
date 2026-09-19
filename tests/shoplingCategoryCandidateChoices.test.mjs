import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI 카테고리 API는 모델명 용어와 관련도 순서의 최대 3개 후보를 반환한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /candidateChoices/);
  assert.match(route, /buildCandidateChoices/);
  assert.match(route, /slice\(0, 3\)/);
  assert.doesNotMatch(route, /branchKey/);
  assert.match(route, /alternatives: candidateChoices\.slice\(1, 3\)/);
  assert.match(route, /replaceAll\("상품명", "모델명"\)/);
});

test("검토함은 관련 후보만 표시하고 버튼 승인·후보 재생성을 제공한다", async () => {
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
  assert.match(component, /핵심명사 후보 검토/);
  assert.match(component, /모델명에서 실제 제품명사를 먼저 찾습니다/);
  assert.match(component, /이 후보 승인/);
  assert.match(component, /후보 다시 생성/);
  assert.match(component, /AI_ENDPOINT/);
  assert.match(component, /categoryAiCandidateChoices/);
  assert.match(component, /categoryAiCandidatePaths/);
  assert.match(component, /기존 후보가 모델명의 핵심 제품명사와 맞지 않아 숨겼습니다/);
  assert.match(component, /positive\.some/);
  assert.match(component, /blocked\.some/);
  assert.match(component, /approve_category_ai_reviews/);
  assert.match(component, /PRODUCT_MASTER_SYNC_ENDPOINT/);
  assert.match(component, /replaceAll\("상품명", "모델명"\)/);
  assert.match(page, /ShoplingCategoryCoreNounReview/);
  assert.match(page, /모델번호, 진행관리의 모델명, 옵션정보/);
});
