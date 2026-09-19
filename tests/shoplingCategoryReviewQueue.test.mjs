import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyShoplingCategoryReviewDecisions,
  buildShoplingCategoryReviewRows,
  countShoplingCategoryReviews,
  isShoplingCategoryReviewStale,
} from "../src/lib/shoplingCategoryReview.ts";

function stateFixture() {
  return {
    schemaVersion: 3,
    savedAt: "2026-08-02T00:00:00.000Z",
    items: [
      {
        id: "item-1",
        modelNumber: "AAA492",
        productName: "미니짐볼 300g 색상랜덤",
        shoplingCategory: "",
        categoryAiSuggestion: "스포츠/레저>헬스기구>스트레칭용품>짐볼",
        categoryAiConfidence: 84,
        categoryAiReason: "상품명에 미니짐볼이 명시되어 있습니다.",
        categoryAiAlternatives: ["스포츠/레저>요가용품>기타요가용품"],
        categoryAiStatus: "review_required",
        categoryAiSnapshotHash: "old-hash",
        categoryAiUpdatedAt: "2026-08-02T01:00:00.000Z",
      },
      {
        id: "item-2",
        modelNumber: "AAA493",
        productName: "요가 블록",
        shoplingCategory: "",
        categoryAiSuggestion: "스포츠/레저>요가용품>요가블록",
        categoryAiConfidence: 67,
        categoryAiStatus: "review_held",
        categoryAiUpdatedAt: "2026-08-02T01:00:00.000Z",
      },
      {
        id: "item-3",
        modelNumber: "AAA494",
        productName: "기존 승인 상품",
        shoplingCategory: "가구>수납가구>정리함",
        categoryAiSuggestion: "가구>수납가구>정리함",
        categoryAiConfidence: 96,
        categoryAiStatus: "review_approved",
        categoryAiApprovedValue: "가구>수납가구>정리함",
        categoryAiUpdatedAt: "2026-08-01T01:00:00.000Z",
      },
      {
        id: "item-4",
        modelNumber: "AAA495",
        productName: "제외 상품",
        shoplingCategory: "",
        categoryAiSuggestion: "생활>기타",
        categoryAiConfidence: 40,
        categoryAiStatus: "review_excluded",
        categoryAiUpdatedAt: "2026-08-01T01:00:00.000Z",
      },
    ],
  };
}

test("검토 대기열은 상품별 추천·상태·회차를 한 행으로 정규화한다", () => {
  const rows = buildShoplingCategoryReviewRows(stateFixture());
  assert.equal(rows.length, 4);
  assert.equal(rows[0].itemId, "item-1");
  assert.equal(rows[1].itemId, "item-2");
  assert.equal(rows[0].suggestion, "스포츠/레저>헬스기구>스트레칭용품>짐볼");
  assert.equal(rows[0].batchId, "2026-08-02T01:00:00.000Z");
  assert.equal(isShoplingCategoryReviewStale(rows[0], "new-hash"), true);
});

test("검토 상태 집계는 검토 필요·보류·승인·제외를 분리한다", () => {
  const counts = countShoplingCategoryReviews(
    buildShoplingCategoryReviewRows(stateFixture()),
  );
  assert.deepEqual(counts, {
    required: 1,
    held: 1,
    approved: 1,
    excluded: 1,
    total: 4,
  });
});

test("수정 승인과 보류·제외·재검토를 한 번의 state 저장으로 적용한다", () => {
  const now = "2026-08-02T02:00:00.000Z";
  const first = applyShoplingCategoryReviewDecisions(
    stateFixture(),
    [
      {
        itemId: "item-1",
        action: "approve",
        category: "스포츠/레저>헬스기구>짐볼",
      },
      { itemId: "item-2", action: "exclude" },
    ],
    { now, reviewer: "승준" },
  );
  assert.equal(first.appliedCount, 2);
  const approved = first.state.items.find((item) => item.id === "item-1");
  assert.equal(approved.shoplingCategory, "스포츠/레저>헬스기구>짐볼");
  assert.equal(approved.categoryAiStatus, "review_approved");
  assert.equal(approved.categoryAiDecision, "edited");
  assert.equal(approved.categoryAiReviewedBy, "승준");
  const excluded = first.state.items.find((item) => item.id === "item-2");
  assert.equal(excluded.categoryAiStatus, "review_excluded");

  const restored = applyShoplingCategoryReviewDecisions(
    first.state,
    [{ itemId: "item-2", action: "restore" }],
    { now: "2026-08-02T03:00:00.000Z" },
  );
  assert.equal(
    restored.state.items.find((item) => item.id === "item-2").categoryAiStatus,
    "review_required",
  );
});

test("AI 후보가 비어 있어도 실제 카탈로그 경로를 명시하면 수동 승인한다", () => {
  const state = {
    items: [
      {
        id: "manual-no-suggestion",
        modelNumber: "AAA999",
        productName: "수동 분류 상품",
        shoplingCategory: "",
        categoryAiSuggestion: "",
        categoryAiStatus: "review_required",
      },
    ],
  };
  const result = applyShoplingCategoryReviewDecisions(
    state,
    [
      {
        itemId: "manual-no-suggestion",
        action: "approve",
        category: "문구/취미>수예>재봉용품>골무",
      },
    ],
    {
      now: "2026-08-15T00:00:00.000Z",
      reviewer: "AI 카테고리 검토함 · 수동 카탈로그 지정",
    },
  );
  assert.equal(result.appliedCount, 1);
  const approved = result.state.items[0];
  assert.equal(approved.shoplingCategory, "문구/취미>수예>재봉용품>골무");
  assert.equal(approved.categoryAiSuggestion, "문구/취미>수예>재봉용품>골무");
  assert.equal(approved.categoryAiApprovedValue, "문구/취미>수예>재봉용품>골무");
  assert.equal(approved.categoryAiStatus, "review_approved");
  assert.equal(approved.categoryAiDecision, "edited");
});

test("검토함 화면은 다건 승인·수정·보류·제외와 진행관리 반영을 제공한다", async () => {
  const page = await readFile(
    new URL("../src/app/shopling-category-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  const workspace = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryReviewQueue.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const domain = await readFile(
    new URL("../src/lib/shoplingCategoryReview.ts", import.meta.url),
    "utf8",
  );
  const modules = await readFile(
    new URL("../src/lib/extendedModuleRegistry.ts", import.meta.url),
    "utf8",
  );
  const groups = await readFile(
    new URL("../src/lib/opsWorkspace.ts", import.meta.url),
    "utf8",
  );
  const trackerApp = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const shortcut = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-review-queue-link.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(page, /AI 카테고리 검토함/);
  assert.match(workspace, /선택 추천값 승인/);
  assert.match(workspace, /선택 보류/);
  assert.match(workspace, /선택 제외/);
  assert.match(workspace, /재검토로 복원/);
  assert.match(workspace, /AI 작업 회차/);
  assert.match(workspace, /신뢰도 낮은 순/);
  assert.match(workspace, /STATE_ENDPOINT/);
  assert.match(workspace, /OPTIMIZED_ENDPOINT/);
  assert.match(workspace, /approve_category_ai_reviews/);
  assert.match(workspace, /update_category_ai_review_status/);
  assert.match(workspace, /PRODUCT_MASTER_SYNC_ENDPOINT/);
  assert.doesNotMatch(workspace, /body: JSON\.stringify\(\{ state: result\.state \}\)/);
  assert.match(workspace, /검토함에서 제거됐고 상품출시 진행관리·상품원장에 저장됐습니다/);
  assert.match(domain, /categoryAiSuggestion/);
  assert.match(domain, /review_approved/);
  assert.match(domain, /explicitApprovedCategory/);
  assert.match(modules, /shopling-category-review-queue/);
  assert.match(groups, /shopling-category-review-queue/);
  assert.match(trackerApp, /category-review-queue-link\.js/);
  assert.match(shortcut, /AI 카테고리 검토함/);
  assert.match(shortcut, /review_required/);
});
