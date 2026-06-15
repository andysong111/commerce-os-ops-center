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
    recommendedSiteSrch: "one, two, three, four, five, six, seven, eight, nine, ten",
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
  ["mall_key", { mallKey: "" }, "mall_key is required."],
  [
    "final_title",
    { editedTitle: "", recommendedTitle: "" },
    "final_title is required.",
  ],
  [
    "final_site_srch",
    { editedSiteSrch: "", recommendedSiteSrch: "" },
    "final_site_srch is required.",
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

test("site_srch removes empty and duplicate keywords safely", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedSiteSrch: "alpha, , beta, Alpha, gamma" }),
  ]).items;
  assert.equal(item.final_site_srch, "alpha, beta, gamma");
  assert.match(item.validation_warnings.join(" "), /Duplicate/);
  assert.match(item.validation_warnings.join(" "), /3 keywords/);
});

test("more than ten keywords is invalid", () => {
  const [item] = buildKeywordShoplingPayloadPreview([
    row({ editedSiteSrch: "1,2,3,4,5,6,7,8,9,10,11" }),
  ]).items;
  assert.equal(item.payload_status, "invalid");
  assert.match(item.validation_errors.join(" "), /no more than 10/);
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
