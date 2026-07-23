import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompactKeywordApplyExecutionPlan,
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
} from "../src/lib/keywordReviewExecutionPreflight.ts";
import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";
import {
  PRODUCT_GROUP_MARKET_MALL_KEYS,
  getMarketsForProductGroup,
} from "../src/lib/productGroupMarketRegistry.ts";

const keywords = "one,two,three,four,five,six,seven,eight,nine,ten";

function row(overrides = {}) {
  return {
    goodsKey: "G-001",
    mallKey: "SMALL_00004",
    originalTitle: "Original title",
    recommendedTitle: "Recommended title",
    originalSiteSrch: "old",
    recommendedSiteSrch: keywords,
    siteSrchKeywordCount: 10,
    verifiedKeywordCount: 10,
    qualityStatus: "PASS",
    confidenceStatus: "PASS",
    blockReason: "",
    warningFlags: "",
    reviewReason: "",
    payloadStatus: "",
    approvalStatus: "",
    manualCandidateKeywords: "",
    sourceRowIndex: 1,
    raw: {},
    classification: "manual_review",
    editedTitle: "",
    editedSiteSrch: "",
    editedMallKey: "",
    reviewStatus: "approved",
    productGroup: "도매1",
    productGroupType: "도매",
    productGroupStatus: "matched",
    groupSuffix: "a",
    ...overrides,
  };
}

function previewForGroups(groups) {
  return buildKeywordShoplingPayloadPreview(
    groups.map((productGroup, index) =>
      row({
        goodsKey: `G-${String(index + 1).padStart(3, "0")}`,
        sourceRowIndex: index + 1,
        productGroup,
      }),
    ),
    { expandProductGroupMarkets: true },
  );
}

function preflight(previewResult, overrides = {}) {
  const config = {
    ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
    allowedMallKeys: PRODUCT_GROUP_MARKET_MALL_KEYS,
    maxRows: 100,
    ...overrides,
  };
  return buildKeywordExecutionPreflight(
    { previewResult, finalConfirmationText: config.confirmationText },
    config,
  );
}

function mallKeys(productGroup) {
  return getMarketsForProductGroup(productGroup).map((market) => market.mallKey);
}

function assertBlockedGoods(result, goodsKey, reason) {
  const goodsItems = result.blockedItems.filter((item) => item.goods_key === goodsKey);
  assert.ok(goodsItems.length > 0);
  assert.ok(goodsItems.every((item) => item.block_reasons.includes(reason)));
  assert.equal(result.eligibleItems.some((item) => item.goods_key === goodsKey), false);
}

test("도매1 정상 preview 10개가 모두 eligible", () => {
  const result = preflight(previewForGroups(["도매1"]));
  assert.equal(result.summary.eligibleCount, mallKeys("도매1").length);
  assert.equal(result.summary.blockedCount, 0);
});

test("소매1 정상 preview 12개가 모두 eligible", () => {
  const result = preflight(previewForGroups(["소매1"]));
  assert.equal(result.summary.eligibleCount, mallKeys("소매1").length);
  assert.equal(result.summary.blockedCount, 0);
});

test("여섯 상품그룹 정상 preview 합계 36개가 모두 eligible", () => {
  const groups = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"];
  const expected = groups.reduce((sum, group) => sum + mallKeys(group).length, 0);
  const result = preflight(previewForGroups(groups));
  assert.equal(expected, 36);
  assert.equal(result.summary.eligibleCount, expected);
  assert.equal(result.summary.blockedCount, 0);
});

test("도매1에서 mall_key 한 개 제거 시 해당 goods_key 전체 차단", () => {
  const preview = previewForGroups(["도매1"]);
  preview.items = preview.items.slice(1);
  const result = preflight(preview);
  assertBlockedGoods(result, "G-001", "PRODUCT_GROUP_MARKETS_MISMATCH");
});

test("도매1에 예상 밖 mall_key를 추가하면 해당 goods_key 전체 차단", () => {
  const preview = previewForGroups(["도매1"]);
  preview.items.push({ ...preview.items[0], mall_key: "SMALL_00001", edited_mall_key: "SMALL_00001" });
  const result = preflight(preview);
  assertBlockedGoods(result, "G-001", "PRODUCT_GROUP_MARKETS_MISMATCH");
});

test("동일 goods_key + mall_key 중복 시 차단", () => {
  const preview = previewForGroups(["도매1"]);
  preview.items[1] = { ...preview.items[0] };
  const result = preflight(preview);
  assertBlockedGoods(result, "G-001", "PRODUCT_GROUP_MARKETS_MISMATCH");
  assert.ok(result.blockedItems.some((item) => item.block_reasons.includes("DUPLICATE_GOODS_KEY_MALL_KEY")));
});

test("mall_key가 빈 행이 있으면 coverage mismatch", () => {
  const preview = previewForGroups(["도매1"]);
  preview.items[0] = { ...preview.items[0], mall_key: "", edited_mall_key: "" };
  const result = preflight(preview);
  assertBlockedGoods(result, "G-001", "PRODUCT_GROUP_MARKETS_MISMATCH");
});

test("등록되지 않은 상품그룹은 PRODUCT_GROUP_UNREGISTERED", () => {
  const preview = previewForGroups(["미등록"]);
  const result = preflight(preview);
  assertBlockedGoods(result, "G-001", "PRODUCT_GROUP_UNREGISTERED");
  assert.equal(result.summary.unregisteredProductGroupGoodsKeyCount, 1);
});

test("한 goods_key가 실패해도 다른 goods_key의 진단 결과가 섞이지 않음", () => {
  const preview = previewForGroups(["도매1", "소매2"]);
  preview.items = preview.items.filter((item) => !(item.goods_key === "G-001" && item.mall_key === mallKeys("도매1")[0]));
  const result = preflight(preview);
  assertBlockedGoods(result, "G-001", "PRODUCT_GROUP_MARKETS_MISMATCH");
  assert.equal(result.eligibleItems.filter((item) => item.goods_key === "G-002").length, mallKeys("소매2").length);
});

test("coverage mismatch goods_key는 compact plan에서 완전히 제외", () => {
  const preview = previewForGroups(["도매1", "소매2"]);
  preview.items = preview.items.filter((item) => !(item.goods_key === "G-001" && item.mall_key === mallKeys("도매1")[0]));
  const plan = JSON.parse(buildCompactKeywordApplyExecutionPlan(preflight(preview)));
  assert.equal(plan.some((item) => item.goods_key === "G-001"), false);
  assert.equal(plan.filter((item) => item.goods_key === "G-002").length, mallKeys("소매2").length);
});

test("정상 compact plan은 preview eligible identity와 완전히 동일", () => {
  const result = preflight(previewForGroups(["도매2"]));
  const plan = JSON.parse(buildCompactKeywordApplyExecutionPlan(result));
  assert.deepEqual(plan.map(({ goods_key, mall_key }) => ({ goods_key, mall_key })), result.eligibleItems.map(({ goods_key, mall_key }) => ({ goods_key, mall_key })));
});

test("compact plan 행은 네 필드만 포함", () => {
  const result = preflight(previewForGroups(["도매4"]));
  const plan = JSON.parse(buildCompactKeywordApplyExecutionPlan(result));
  assert.deepEqual(Object.keys(plan[0]), ["goods_key", "mall_key", "final_title", "final_site_srch"]);
});

test("summary coverage counts are exact", () => {
  const preview = previewForGroups(["도매1", "미등록", "소매2"]);
  preview.items = preview.items.filter((item) => !(item.goods_key === "G-001" && item.mall_key === mallKeys("도매1")[0]));
  const result = preflight(preview);
  assert.equal(result.summary.expectedTitleTargetCount, mallKeys("도매1").length + mallKeys("소매2").length);
  assert.equal(result.summary.generatedTitleTargetCount, preview.items.filter((item) => item.goods_key.trim() && item.mall_key.trim()).length);
  assert.equal(result.summary.siteSrchGoodsKeyCount, 1);
  assert.equal(result.summary.coverageMismatchGoodsKeyCount, 1);
  assert.equal(result.summary.unregisteredProductGroupGoodsKeyCount, 1);
});

test("single_mall 모드의 기존 동작 유지", () => {
  const preview = buildKeywordShoplingPayloadPreview([row({ mallKey: "SMALL_00004" })]);
  const result = preflight(preview, { allowedMallKeys: ["SMALL_00004"] });
  assert.equal(result.summary.eligibleCount, 1);
  assert.equal(result.summary.coverageMismatchGoodsKeyCount, 0);
});

test("maxRows 초과의 기존 전체 차단 동작 유지", () => {
  const result = preflight(previewForGroups(["도매1"]), { maxRows: 1 });
  assert.equal(result.summary.maxRowsExceeded, true);
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(result.blockedItems.every((item) => item.block_reasons.includes("MAX_ROWS_EXCEEDED")));
});

test("이미 반영된 goods_key 차단 유지", () => {
  const result = preflight(previewForGroups(["도매1"]), { alreadyAppliedGoodsKeys: ["G-001"] });
  assert.equal(result.summary.alreadyAppliedBlockedCount, mallKeys("도매1").length);
  assert.ok(result.blockedItems.every((item) => item.block_reasons.includes("ALREADY_APPLIED_GOODS_KEY")));
});

test("테스트 중 fetch/API/workflow dispatch가 발생하지 않음", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch must not be called");
  };
  try {
    const result = preflight(previewForGroups(["도매1"]));
    assert.equal(result.summary.eligibleCount, mallKeys("도매1").length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
