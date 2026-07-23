import assert from "node:assert/strict";
import test from "node:test";
import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";

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
