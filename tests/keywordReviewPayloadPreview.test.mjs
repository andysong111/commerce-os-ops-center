import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";

function row(overrides = {}) {
  return {
    goodsKey: "goods-1",
    mallKey: "mall-1",
    originalTitle: "Old title",
    recommendedTitle: "Recommended title",
    originalSiteSrch: "old",
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
    sourceRowIndex: 2,
    raw: {},
    classification: "manual_review",
    editedTitle: "",
    editedSiteSrch: "",
    reviewStatus: "approved",
    editedMallKey: "",
    ...overrides,
  };
}

test("approved valid row generates preview-ready payload and XML", () => {
  const result = buildKeywordShoplingPayloadPreview([row()]);
  assert.equal(result.previewableItems.length, 1);
  assert.equal(result.items[0].payload_status, "preview_ready");
  assert.match(result.previewXml, /<goods_key>goods-1<\/goods_key>/);
  assert.match(result.previewXml, /<mall_key>mall-1<\/mall_key>/);
  assert.match(result.previewXml, /<title>Recommended title<\/title>/);
  assert.match(result.previewXml, /<site_srch>one, two/);
});

test("held and blocked risk rows are excluded", () => {
  const result = buildKeywordShoplingPayloadPreview([
    row({ reviewStatus: "hold" }),
    row({ goodsKey: "risk", classification: "blocked_risk" }),
  ]);
  assert.equal(result.previewableItems.length, 0);
  assert.equal(result.items[0].payload_status, "held");
  assert.equal(result.items[1].payload_status, "blocked_risk");
});

for (const [name, overrides, error] of [
  ["goods_key", { goodsKey: "" }, "goods_key is required."],
  [
    "mall_key",
    { mallKey: "", editedMallKey: "" },
    "적용할 쇼핑몰(mall_key)을 선택하세요.",
  ],
  [
    "final_title",
    { editedTitle: "", recommendedTitle: "" },
    "쇼핑몰별 상품명이 비어 있어 실제 반영을 중단했습니다.",
  ],
  [
    "final_site_srch",
    { editedSiteSrch: "", recommendedSiteSrch: "" },
    "검색어를 입력하세요.",
  ],
]) {
  test(`missing ${name} fails validation`, () => {
    const [item] = buildKeywordShoplingPayloadPreview([row(overrides)]).items;
    assert.equal(item.payload_status, "invalid");
    assert.ok(item.validation_errors.includes(error));
    assert.equal(item.preview_payload, null);
  });
}

test("edited values override recommended values", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({
      editedTitle: "Edited title",
      editedSiteSrch: "a, b, c, d, e, f, g, h, i, j",
    }),
  ]).items;
  assert.equal(item.final_title, "Edited title");
  assert.equal(item.final_site_srch, "a, b, c, d, e, f, g, h, i, j");
});

test("editedMallKey overrides an empty mallKey for preview", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ mallKey: "", editedMallKey: "SMALL_00004" }),
  ]).items;
  assert.equal(item.payload_status, "preview_ready");
  assert.equal(item.mall_key, "SMALL_00004");
  assert.equal(item.preview_payload.mall_key, "SMALL_00004");
});

test("site_srch removes empty and duplicate keywords safely", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedSiteSrch: "alpha, , beta, Alpha, gamma" }),
  ]).items;
  assert.equal(item.final_site_srch, "alpha, beta, gamma");
  assert.match(item.validation_warnings.join(" "), /중복 검색어/);
  assert.match(item.validation_warnings.join(" "), /검색어가 3개/);
});

test("more than ten keywords is invalid", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedSiteSrch: "1,2,3,4,5,6,7,8,9,10,11" }),
  ]).items;
  assert.equal(item.payload_status, "invalid");
  assert.match(item.validation_errors.join(" "), /최대 10개/);
});

test("preview summary counts all outcomes", () => {
  const result = buildKeywordShoplingPayloadPreview([
    row(),
    row({ goodsKey: "", sourceRowIndex: 3 }),
    row({ reviewStatus: "hold", sourceRowIndex: 4 }),
    row({ classification: "blocked_risk", sourceRowIndex: 5 }),
    row({ reviewStatus: "pending", sourceRowIndex: 6 }),
  ]);
  assert.deepEqual(result.summary, {
    totalReviewedRows: 5,
    approvedCount: 3,
    previewReadyCount: 1,
    invalidCount: 1,
    heldCount: 1,
    blockedRiskCount: 1,
    titleReadyCount: 1,
    titleBlankCount: 1,
    titleBlockedCount: 1,
  });
});

test("preview implementation contains no live Shopling API execution", async () => {
  const files = await Promise.all([
    readFile(
      new URL("../src/lib/keywordReviewPayloadPreview.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/app/keyword-review-queue/page.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/shopling/i);
});


test("blank mall title blocks payload preview", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedTitle: "", recommendedTitle: "", originalTitle: "", raw: {} }),
  ]).items;
  assert.equal(item.payload_status, "invalid");
  assert.equal(item.preview_payload, null);
  assert.ok(item.validation_errors.includes("쇼핑몰별 상품명이 비어 있어 실제 반영을 중단했습니다."));
});

test("numeric-only fallback is not allowed", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ goodsKey: "121044", editedTitle: "", recommendedTitle: "121044", originalTitle: "-", raw: { registered_title: "121044" } }),
  ]).items;
  assert.equal(item.payload_status, "invalid");
  assert.equal(item.final_title, "");
});

test("originalTitle fallback fills missing title", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedTitle: "", recommendedTitle: "", originalTitle: "Original fallback title" }),
  ]).items;
  assert.equal(item.payload_status, "preview_ready");
  assert.equal(item.final_title, "Original fallback title");
});

test("upload registered_title fallback fills missing title", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedTitle: "", recommendedTitle: "", originalTitle: "-", raw: { registered_title: "Upload registered title" } }),
  ]).items;
  assert.equal(item.payload_status, "preview_ready");
  assert.equal(item.final_title, "Upload registered title");
});

test("source contains strict blank title block copy", async () => {
  const source = await readFile(new URL("../src/lib/keywordReviewPayloadPreview.ts", import.meta.url), "utf8");
  assert.match(source, /쇼핑몰별 상품명이 비어 있어 실제 반영을 중단했습니다/);
  assert.match(source, /상품명 반영 대상 중 일부가 비어 있습니다/);
});
