import assert from "node:assert/strict";
import test from "node:test";
import { buildKeywordShoplingPayloadPreview, buildManualProductGroupPreview } from "../src/lib/keywordReviewPayloadPreview.ts";

function row(overrides = {}) {
  return {
    goodsKey: "121261",
    mallKey: "SMALL_00004",
    originalTitle: "Original title",
    recommendedTitle: "Recommended title",
    originalSiteSrch: "original",
    recommendedSiteSrch:
      "one, two, three, four, five, six, seven, eight, nine, ten",
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
    reviewStatus: "approved",
    editedMallKey: "",
    ptnGoodsCd: "a-001",
    groupSuffix: "a",
    productGroup: "도매1",
    productGroupType: "도매",
    productGroupStatus: "inferred",
    ...overrides,
  };
}

test("expanded mode without manual override maps preserves product-group expansion fallbacks", () => {
  const result = buildKeywordShoplingPayloadPreview(
    [
      row({
        recommendedTitle: "Recommended fallback title",
        recommendedSiteSrch: "fallback, keyword",
      }),
    ],
    { expandProductGroupMarkets: true, groupVariantEnabled: false },
  );

  assert.equal(result.summary.totalReviewedRows, 1);
  assert.equal(result.summary.approvedCount, 1);
  assert.equal(result.expandedItemCount, result.items.length);
  assert.ok(result.previewableItems.length > 1);
  assert.ok(
    result.previewableItems.every((item) => item.payload_status === "preview_ready"),
  );
  assert.ok(
    result.previewableItems.every(
      (item) => item.final_title === "Recommended fallback title",
    ),
  );
  assert.ok(
    result.previewableItems.every(
      (item) => item.final_site_srch === "fallback,keyword",
    ),
  );
});

test("explicit manual maps activate strict manual expansion", () => {
  const result = buildKeywordShoplingPayloadPreview(
    [
      row({
        recommendedTitle: "Recommended title must not be used",
        editedTitle: "Edited title must not be used",
        recommendedSiteSrch: "recommended,keywords",
        editedSiteSrch: "edited,keywords",
      }),
    ],
    {
      expandProductGroupMarkets: true,
      groupVariantEnabled: true,
      seedKeywordsByGoodsKey: { "121261": "seed, keyword" },
      manualTitleOverridesByGoodsKey: { "121261": "Manual Title" },
      manualKeywordOverridesByGoodsKey: { "121261": "manual, keyword" },
    },
  );

  assert.equal(result.summary.totalReviewedRows, 1);
  assert.equal(result.summary.approvedCount, 1);
  assert.ok(result.previewableItems.length > 1);
  assert.ok(
    result.previewableItems.every((item) => item.final_title === "Manual Title"),
  );
  assert.ok(
    result.previewableItems.every(
      (item) => item.final_site_srch === "manual,keyword",
    ),
  );
});

test("explicit manual maps with a blank goods_key value are invalid without fallback", () => {
  const result = buildKeywordShoplingPayloadPreview(
    [
      row({
        recommendedTitle: "Recommended title must not be used",
        editedTitle: "Edited title must not be used",
        originalTitle: "Original title must not be used",
        recommendedSiteSrch: "recommended,keywords",
        editedSiteSrch: "edited,keywords",
      }),
    ],
    {
      expandProductGroupMarkets: true,
      groupVariantEnabled: true,
      seedKeywordsByGoodsKey: { "121261": "seed, keyword" },
      manualTitleOverridesByGoodsKey: { "121261": " " },
      manualKeywordOverridesByGoodsKey: { "121261": "manual, keyword" },
    },
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.previewableItems.length, 0);
  assert.equal(result.items[0].payload_status, "invalid");
  assert.ok(result.items[0].validation_errors.includes("상품명을 입력하세요."));
  assert.equal(result.items[0].final_title, "");
  assert.equal(result.items[0].preview_payload, null);
});

test("strict manual expansion imports and exposes buildManualProductGroupPreview contract", () => {
  assert.equal(typeof buildManualProductGroupPreview, "function");
});

test("strict manual expansion creates deterministic mall-specific permutation titles", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha, beta, gamma" }, manualKeywordOverridesByGoodsKey: { "121261": "one,two" } });
  assert.ok(result.previewableItems.length >= 3);
  assert.deepEqual(result.previewableItems.slice(0, 3).map((item) => item.final_title), ["alpha beta gamma", "alpha gamma beta", "beta alpha gamma"]);
});

test("strict manual expansion preserves multi-word title keywords", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "세차 드라잉타월, 대형 세차타월, 극세사 타월" }, manualKeywordOverridesByGoodsKey: { "121261": "세차,타월" } });
  assert.equal(result.previewableItems[0].final_title, "세차 드라잉타월 대형 세차타월 극세사 타월");
  assert.equal(result.previewableItems[0].title_keyword_count, 3);
  assert.equal(result.previewableItems[0].title_included_keyword_count, 3);
});

test("strict manual expansion blocks title UTF-8 over 100 bytes without truncation", () => {
  const longTitle = "가".repeat(34);
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": longTitle }, manualKeywordOverridesByGoodsKey: { "121261": "one,two" } });
  assert.equal(result.previewableItems.length, 0);
  assert.equal(result.items[0].final_title, longTitle);
  assert.ok(result.items[0].validation_errors.includes("manual_mall_title_max_bytes_exceeded"));
  assert.equal(result.items[0].title_byte_length > 100, true);
  assert.equal(result.items[0].apply_blocked, true);
});

test("strict manual expansion marks title keyword integrity fields", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha, beta" }, manualKeywordOverridesByGoodsKey: { "121261": "one,two" } });
  assert.equal(result.previewableItems[0].title_keyword_count, 2);
  assert.equal(result.previewableItems[0].title_included_keyword_count, 2);
  assert.equal(result.previewableItems[0].title_keyword_integrity_ok, true);
  assert.equal(result.previewableItems[0].apply_blocked, false);
});

test("regular non-manual mode truncates eleven search keywords and remains preview ready", () => {
  const eleven = "one,two,three,four,five,six,seven,eight,nine,ten,eleven";
  const result = buildKeywordShoplingPayloadPreview([row({ editedSiteSrch: eleven })]);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].payload_status, "preview_ready");
  assert.equal(
    result.items[0].final_site_srch,
    "one,two,three,four,five,six,seven,eight,nine,ten",
  );
});

test("strict manual expansion keeps more than ten manual search keywords invalid and untruncated", () => {
  const eleven = "one,two,three,four,five,six,seven,eight,nine,ten,eleven";
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha, beta" }, manualKeywordOverridesByGoodsKey: { "121261": eleven } });
  assert.equal(result.previewableItems.length, 0);
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every((item) => item.payload_status === "invalid"));
  assert.ok(result.items.every((item) => item.final_site_srch === eleven));
  assert.ok(result.items.every((item) => item.validation_errors.includes("검색어는 최대 10개까지만 입력할 수 있습니다.")));
});

test("strict manual expansion first row uses factoradic zero strategy", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha, beta" }, manualKeywordOverridesByGoodsKey: { "121261": "one,two" } });

  assert.equal(result.previewableItems[0].word_order_strategy, "manual_factoradic_0");
  assert.ok(!result.previewableItems[0].selected_modifier);
});

test("strict manual expansion rows disable group variants", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, groupVariantEnabled: true, manualTitleOverridesByGoodsKey: { "121261": "alpha, beta" }, manualKeywordOverridesByGoodsKey: { "121261": "one,two" } });

  assert.ok(result.previewableItems.length > 0);
  assert.ok(result.previewableItems.every((item) => item.group_variant_enabled === false));
});

test("strict manual expansion missing manual keyword value is invalid without fallback", () => {
  const result = buildKeywordShoplingPayloadPreview([row({ recommendedSiteSrch: "fallback" })], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha" }, manualKeywordOverridesByGoodsKey: {} });
  assert.equal(result.items[0].payload_status, "invalid");
  assert.equal(result.items[0].final_site_srch, "");
});

test("strict manual expansion missing manual title value is invalid without original fallback", () => {
  const result = buildKeywordShoplingPayloadPreview([row({ originalTitle: "Original fallback" })], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: {}, manualKeywordOverridesByGoodsKey: { "121261": "one" } });
  assert.equal(result.items[0].payload_status, "invalid");
  assert.equal(result.items[0].final_title, "");
});

test("strict manual expansion ignores seed title fallback", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { expandProductGroupMarkets: true, seedKeywordsByGoodsKey: { "121261": "seed" }, manualTitleOverridesByGoodsKey: {}, manualKeywordOverridesByGoodsKey: { "121261": "one" } });
  assert.equal(result.items[0].final_title, "");
});

test("strict manual expansion ignores edited and recommended title fallbacks", () => {
  const result = buildKeywordShoplingPayloadPreview([row({ editedTitle: "Edited", recommendedTitle: "Recommended" })], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: {}, manualKeywordOverridesByGoodsKey: { "121261": "one" } });
  assert.equal(result.items[0].final_title, "");
});

test("strict manual expansion ignores original search fallback", () => {
  const result = buildKeywordShoplingPayloadPreview([row({ originalSiteSrch: "original", recommendedSiteSrch: "recommended" })], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha" }, manualKeywordOverridesByGoodsKey: {} });
  assert.equal(result.items[0].final_site_srch, "");
});

test("summary contract uses reviewed rows and expanded item count", () => {
  const result = buildKeywordShoplingPayloadPreview([row(), row({ goodsKey: "121262", sourceRowIndex: 2, reviewStatus: "hold" })], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "alpha" }, manualKeywordOverridesByGoodsKey: { "121261": "one" } });
  assert.equal(result.summary.totalReviewedRows, 2);
  assert.equal(result.summary.approvedCount, 1);
  assert.equal(result.summary.previewReadyCount, result.previewableItems.length);
  assert.equal(result.expandedItemCount, result.items.length);
});

test("one undefined manual map keeps regular expansion edited fallback", () => {
  const result = buildKeywordShoplingPayloadPreview([row({ editedTitle: "Edited fallback", editedSiteSrch: "edited,keywords" })], { expandProductGroupMarkets: true, manualTitleOverridesByGoodsKey: { "121261": "Manual ignored" } });
  assert.ok(result.previewableItems.length > 1);
  assert.equal(result.previewableItems[0].final_title, "Edited fallback");
  assert.equal(result.previewableItems[0].final_site_srch, "edited,keywords");
});

test("one undefined manual map keeps groupVariantEnabled behavior", () => {
  const result = buildKeywordShoplingPayloadPreview([row({ recommendedTitle: "Recommended fallback" })], { expandProductGroupMarkets: true, groupVariantEnabled: true, manualKeywordOverridesByGoodsKey: { "121261": "manual ignored" } });
  assert.ok(result.previewableItems.some((item) => item.final_title !== "Recommended fallback"));
  assert.ok(result.previewableItems.some((item) => item.group_title));
});

test("single mall mode still allows manual overrides", () => {
  const result = buildKeywordShoplingPayloadPreview([row()], { manualTitleOverridesByGoodsKey: { "121261": "Manual Single" }, manualKeywordOverridesByGoodsKey: { "121261": "single,keywords" } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].final_title, "Manual Single");
  assert.equal(result.items[0].final_site_srch, "single,keywords");
});
