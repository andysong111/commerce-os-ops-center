import assert from "node:assert/strict";
import test from "node:test";

import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";

function row(goodsKey, productGroup, extras = {}) {
  return {
    goodsKey,
    mallKey: "SMALL_SINGLE",
    originalTitle: extras.originalTitle ?? `원래상품명 ${productGroup}`,
    recommendedTitle: extras.recommendedTitle ?? `추천상품명 ${productGroup}`,
    originalSiteSrch: "원래검색어",
    recommendedSiteSrch: extras.recommendedSiteSrch ?? "추천검색어",
    siteSrchKeywordCount: null,
    verifiedKeywordCount: null,
    qualityStatus: "",
    confidenceStatus: "",
    blockReason: "",
    warningFlags: "",
    reviewReason: "",
    payloadStatus: "",
    approvalStatus: "approved",
    manualCandidateKeywords: "",
    sourceRowIndex: extras.sourceRowIndex ?? 0,
    raw: {},
    classification: extras.classification ?? "manual_review",
    ptnGoodsCd: "",
    groupSuffix: "",
    productGroup,
    productGroupType: productGroup.startsWith("소매") ? "소매" : "도매",
    productGroupStatus: "registered",
    editedTitle: extras.editedTitle ?? "편집상품명",
    editedSiteSrch: extras.editedSiteSrch ?? "편집검색어",
    editedMallKey: extras.editedMallKey ?? "SMALL_EDITED",
    reviewStatus: extras.reviewStatus ?? "approved",
  };
}

const titleOverride = "Alpha, Beta, Gamma, Delta, Epsilon";
const siteOverride = "manual one, manual two, manual three";

function manualPreview(rows, overrides = {}) {
  const manualTitleOverridesByGoodsKey = {};
  const manualKeywordOverridesByGoodsKey = {};
  for (const item of rows) {
    manualTitleOverridesByGoodsKey[item.goodsKey] = titleOverride;
    manualKeywordOverridesByGoodsKey[item.goodsKey] = siteOverride;
  }
  return buildKeywordShoplingPayloadPreview(rows, {
    expandProductGroupMarkets: true,
    manualTitleOverridesByGoodsKey: { ...manualTitleOverridesByGoodsKey, ...overrides.titles },
    manualKeywordOverridesByGoodsKey: { ...manualKeywordOverridesByGoodsKey, ...overrides.keywords },
    seedKeywordsByGoodsKey: overrides.seeds,
    groupVariantEnabled: true,
  });
}

function orderedMultiset(title) {
  return title.split(" ").sort((a, b) => a.localeCompare(b)).join("|");
}

test("wholesale group 1 creates 10 preview rows for one product", () => {
  const result = manualPreview([row("G-W1", "도매1")]);
  assert.equal(result.previewableItems.length, 10);
  assert.equal(result.items.length, 10);
});

test("retail group 1 creates 12 preview rows for one product", () => {
  const result = manualPreview([row("G-R1", "소매1")]);
  assert.equal(result.previewableItems.length, 12);
  assert.equal(result.items.length, 12);
});

test("six product groups create 36 preview rows without hard-coded expansion counts", () => {
  const result = manualPreview([
    row("G-W1", "도매1", { sourceRowIndex: 1 }),
    row("G-W2", "도매2", { sourceRowIndex: 2 }),
    row("G-W3", "도매3", { sourceRowIndex: 3 }),
    row("G-W4", "도매4", { sourceRowIndex: 4 }),
    row("G-R1", "소매1", { sourceRowIndex: 5 }),
    row("G-R2", "소매2", { sourceRowIndex: 6 }),
  ]);
  assert.equal(result.previewableItems.length, 36);
  assert.equal(result.items.length, 36);
});

test("five title keywords produce 12 distinct retail group 1 titles", () => {
  const result = manualPreview([row("G-R1", "소매1")]);
  assert.equal(new Set(result.items.map((item) => item.final_title)).size, 12);
});

test("multi-word manual title keywords are preserved as single keywords", () => {
  const result = manualPreview([row("G-R1", "소매1")], {
    titles: { "G-R1": "red apple, blue berry, gamma ray, delta force, echo dot" },
  });
  assert.ok(result.items.every((item) => item.title_keyword_count === 5));
  assert.ok(result.items.every((item) => item.final_title.includes("red apple")));
});

test("every title ordered keyword multiset matches the original manual keywords", () => {
  const result = manualPreview([row("G-R1", "소매1")]);
  const expected = orderedMultiset("Alpha Beta Gamma Delta Epsilon");
  for (const item of result.items) {
    assert.equal(orderedMultiset(item.final_title), expected);
    assert.equal(item.title_keyword_integrity_ok, true);
  }
});

test("original title, product group, seed, and search terms are not appended to manual titles", () => {
  const result = buildKeywordShoplingPayloadPreview([row("G-R1", "소매1", { originalTitle: "ORIGINAL_SENTINEL", recommendedTitle: "RECOMMENDED_SENTINEL", editedTitle: "EDITED_SENTINEL", recommendedSiteSrch: "SEARCH_SENTINEL", editedSiteSrch: "EDITED_SEARCH_SENTINEL" })], {
    expandProductGroupMarkets: true,
    manualTitleOverridesByGoodsKey: { "G-R1": "Only, Manual, Title, Words, Here" },
    manualKeywordOverridesByGoodsKey: { "G-R1": "search sentinel" },
    seedKeywordsByGoodsKey: { "G-R1": "SEED_SENTINEL" },
  });
  for (const item of result.items) {
    assert.doesNotMatch(item.final_title, /ORIGINAL_SENTINEL|RECOMMENDED_SENTINEL|EDITED_SENTINEL|소매1|SEED_SENTINEL|search sentinel|SEARCH_SENTINEL|EDITED_SEARCH_SENTINEL/);
  }
});

test("missing manual title is invalid without fallback", () => {
  const result = manualPreview([row("G-R1", "소매1")], { titles: { "G-R1": "" } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].payload_status, "invalid");
  assert.equal(result.items[0].preview_payload, null);
  assert.ok(result.items[0].validation_errors.includes("manual_mall_title_keywords_required"));
});

test("missing manual search keywords are invalid without fallback", () => {
  const result = manualPreview([row("G-R1", "소매1")], { keywords: { "G-R1": "" } });
  assert.equal(result.items[0].payload_status, "invalid");
  assert.equal(result.items[0].preview_payload, null);
  assert.ok(result.items[0].validation_errors.includes("manual_site_srch_keywords_required"));
});

test("eleven manual search keywords are invalid and are not truncated", () => {
  const eleven = Array.from({ length: 11 }, (_, index) => `k${index + 1}`).join(",");
  const result = manualPreview([row("G-R1", "소매1")], { keywords: { "G-R1": eleven } });
  assert.equal(result.items[0].payload_status, "invalid");
  assert.equal(result.items[0].preview_payload, null);
  assert.equal(result.items[0].final_site_srch, "");
  assert.ok(result.items[0].validation_errors.includes("검색어는 최대 10개까지만 입력할 수 있습니다."));
});

test("titles over 100 bytes are invalid and are not truncated", () => {
  const longKeyword = "가".repeat(40);
  const result = manualPreview([row("G-R1", "소매1")], { titles: { "G-R1": `${longKeyword}, Beta, Gamma, Delta, Epsilon` } });
  assert.ok(result.items.every((item) => item.payload_status === "invalid"));
  assert.ok(result.items.every((item) => item.preview_payload === null));
  assert.ok(result.items.every((item) => item.title_byte_length > 100));
});

test("all preview-ready payloads match final values", () => {
  const result = manualPreview([row("G-R1", "소매1")]);
  for (const item of result.previewableItems) {
    assert.deepEqual(item.preview_payload, {
      goods_key: item.goods_key,
      mall_key: item.mall_key,
      title: item.final_title,
      site_srch: item.final_site_srch,
    });
  }
});

test("goods_key and mall_key combinations are unique", () => {
  const result = manualPreview([row("G-R1", "소매1")]);
  const keys = result.items.map((item) => `${item.goods_key}::${item.mall_key}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("normal non-expanded mode preserves existing fallback behavior", () => {
  const result = buildKeywordShoplingPayloadPreview([row("G-SINGLE", "소매1")]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].payload_status, "preview_ready");
  assert.equal(result.items[0].final_title, "편집상품명");
  assert.equal(result.items[0].final_site_srch, "편집검색어");
  assert.deepEqual(result.items[0].preview_payload, {
    goods_key: "G-SINGLE",
    mall_key: "SMALL_EDITED",
    title: "편집상품명",
    site_srch: "편집검색어",
  });
});

test("preview integration does not call fetch, APIs, or workflow dispatch", () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch must not be called");
  };
  try {
    const result = manualPreview([row("G-R1", "소매1")]);
    assert.equal(result.previewableItems.length, 12);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
