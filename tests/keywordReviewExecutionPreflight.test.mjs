import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCompactKeywordApplyExecutionPlan,
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  exportKeywordExecutionPlan,
} from "../src/lib/keywordReviewExecutionPreflight.ts";
import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";

function row(overrides = {}) {
  return {
    goodsKey: "121044",
    mallKey: "SMALL_00004",
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
    ...overrides,
  };
}

function run(rows, configOverrides = {}, confirmation = true) {
  const previewResult = buildKeywordShoplingPayloadPreview(rows);
  const config = {
    ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
    allowedMallKeys: ["SMALL_00004"],
    maxRows: 10,
    ...configOverrides,
  };
  return {
    config,
    result: buildKeywordExecutionPreflight(
      {
        previewResult,
        finalConfirmationText: confirmation ? config.confirmationText : "",
      },
      config,
    ),
  };
}

test("empty allowedMallKeys blocks all rows", () => {
  const { result } = run([row()], { allowedMallKeys: [] });
  assert.equal(result.summary.eligibleCount, 0);
  assert.equal(result.summary.mallKeyBlockedCount, 1);
  assert.ok(
    result.blockedItems[0].block_reasons.includes("MALL_KEY_NOT_ALLOWED"),
  );
});

test("default preflight does not require final confirmation", () => {
  const { result } = run([row()], {}, false);
  assert.equal(DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG.requireFinalConfirmation, false);
  assert.equal(result.summary.requiresFinalConfirmation, false);
  assert.equal(result.summary.eligibleCount, 1);
  assert.ok(
    !result.eligibleItems[0].block_reasons.includes(
      "FINAL_CONFIRMATION_REQUIRED",
    ),
  );
});

test("allowed mall_key passes and disallowed mall_key blocks", () => {
  assert.equal(run([row()]).result.summary.eligibleCount, 1);
  const { result } = run([row()], { allowedMallKeys: ["SMALL_00069"] });
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(
    result.blockedItems[0].block_reasons.includes("MALL_KEY_NOT_ALLOWED"),
  );
});

test("already-applied goods_key is excluded", () => {
  const { result } = run(
    [row()],
    { alreadyAppliedGoodsKeys: ["121044"] },
  );
  assert.equal(result.summary.alreadyAppliedBlockedCount, 1);
  assert.ok(
    result.blockedItems[0].block_reasons.includes(
      "ALREADY_APPLIED_GOODS_KEY",
    ),
  );
});

test("duplicate detection ignores non-approved duplicate rows", () => {
  const { result } = run([
    row(),
    row({ sourceRowIndex: 3, reviewStatus: "hold" }),
    row({ sourceRowIndex: 4, reviewStatus: "" }),
  ]);
  assert.equal(result.summary.eligibleCount, 1);
  assert.equal(result.summary.duplicateGoodsKeyCount, 0);
});

test("duplicate detection blocks same approved goods_key and mall_key pair", () => {
  const { result } = run([
    row(),
    row({ sourceRowIndex: 3, mallKey: "SMALL_00004" }),
  ]);
  assert.equal(result.summary.eligibleCount, 0);
  assert.equal(result.summary.duplicateGoodsKeyCount, 2);
  assert.ok(
    result.blockedItems.every((item) =>
      item.block_reasons.includes("DUPLICATE_GOODS_KEY_MALL_KEY"),
    ),
  );
});

test("same goods_key with non-approved held rows does not block approved row", () => {
  const { result } = run([
    row(),
    row({ sourceRowIndex: 3, reviewStatus: "hold", mallKey: "SMALL_00004" }),
  ]);
  assert.equal(result.summary.eligibleCount, 1);
  assert.equal(result.summary.duplicateGoodsKeyCount, 0);
  assert.ok(
    result.eligibleItems[0].block_reasons.every(
      (reason) => reason !== "DUPLICATE_GOODS_KEY_MALL_KEY",
    ),
  );
});

for (const [name, overrides, reason] of [
  [
    "blocked_risk row",
    { classification: "blocked_risk" },
    "BLOCKED_RISK",
  ],
  ["held row", { reviewStatus: "hold" }, "HELD"],
  ["missing goods_key", { goodsKey: "" }, "GOODS_KEY_REQUIRED"],
  ["missing mall_key", { mallKey: "" }, "MALL_KEY_REQUIRED"],
  [
    "missing final_title",
    { recommendedTitle: "" },
    "FINAL_TITLE_REQUIRED",
  ],
  [
    "missing final_site_srch",
    { recommendedSiteSrch: "" },
    "FINAL_SITE_SRCH_REQUIRED",
  ],
  [
    "more than ten keywords",
    { recommendedSiteSrch: "1,2,3,4,5,6,7,8,9,10,11" },
    "FINAL_SITE_SRCH_TOO_MANY_KEYWORDS",
  ],
]) {
  test(`${name} cannot pass`, () => {
    const { result } = run([row(overrides)]);
    assert.equal(result.summary.eligibleCount, 0);
    assert.ok(result.blockedItems[0].block_reasons.includes(reason));
  });
}

test("preview item with validation_errors cannot pass", () => {
  const previewResult = buildKeywordShoplingPayloadPreview([row()]);
  previewResult.items[0].validation_errors.push("fixture validation error");
  const config = {
    ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
    allowedMallKeys: ["SMALL_00004"],
    maxRows: 1,
  };
  const result = buildKeywordExecutionPreflight(
    {
      previewResult,
      finalConfirmationText: config.confirmationText,
    },
    config,
  );
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(
    result.blockedItems[0].block_reasons.includes(
      "VALIDATION_ERRORS_PRESENT",
    ),
  );
});

test("final_site_srch with 1 keyword is warning, not blocked", () => {
  const { result } = run([row({ recommendedSiteSrch: "one" })]);
  assert.equal(result.summary.eligibleCount, 1);
  assert.ok(
    result.eligibleItems[0].preflight_warnings.includes(
      "FINAL_SITE_SRCH_UNDERFILLED",
    ),
  );
  assert.ok(
    !result.eligibleItems[0].block_reasons.includes(
      "FINAL_SITE_SRCH_UNDERFILLED",
    ),
  );
});

test("empty final_site_srch is blocked", () => {
  const { result } = run([row({ recommendedSiteSrch: "" })]);
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(result.blockedItems[0].block_reasons.includes("FINAL_SITE_SRCH_REQUIRED"));
});

test("11 keywords is blocked", () => {
  const { result } = run([row({ recommendedSiteSrch: "1,2,3,4,5,6,7,8,9,10,11" })]);
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(result.blockedItems[0].block_reasons.includes("FINAL_SITE_SRCH_TOO_MANY_KEYWORDS"));
});

test("eligible rows export to a marked preview-only execution plan", () => {
  const { config, result } = run([row()]);
  const plan = JSON.parse(
    exportKeywordExecutionPlan(result, config, "2026-06-15T00:00:00.000Z"),
  );
  assert.equal(plan.mode, "preview_only_preflight");
  assert.equal(plan.executionStatus, "not_executed");
  assert.equal(plan.eligibleItems.length, 1);
  assert.match(plan.notices.join(" "), /No Shopling API call was performed/);
  assert.match(plan.notices.join(" "), /separate guarded PR/);
});

test("preflight implementation contains no live Shopling execution", async () => {
  const files = await Promise.all([
    readFile(
      new URL(
        "../src/lib/keywordReviewExecutionPreflight.ts",
        import.meta.url,
      ),
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
  assert.doesNotMatch(source, /SHOPLING_(API_KEY|SECRET|TOKEN)/i);
});

test("compact keyword apply execution plan includes only eligible apply fields", () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, index) =>
      row({ goodsKey: `eligible-${index}`, sourceRowIndex: index + 1 }),
    ),
    ...Array.from({ length: 100 }, (_, index) =>
      row({
        goodsKey: `blocked-${index}`,
        sourceRowIndex: index + 100,
        reviewStatus: "hold",
        raw: { preview_xml_fragment: "<xml/>", validation_errors: ["secret"] },
      }),
    ),
  ];
  const { result } = run(rows);
  const json = buildCompactKeywordApplyExecutionPlan(result);
  const parsed = JSON.parse(json);

  assert.equal(parsed.length, 6);
  assert.deepEqual(Object.keys(parsed[0]), [
    "goods_key",
    "mall_key",
    "final_title",
    "final_site_srch",
  ]);
  assert.doesNotMatch(json, /blockedItems/);
  assert.doesNotMatch(json, /preview_xml_fragment/);
  assert.doesNotMatch(json, /validation_errors/);
  assert.doesNotMatch(json, /original_title/);
  assert.ok(parsed.every((item) => item.goods_key.startsWith("eligible-")));
});
