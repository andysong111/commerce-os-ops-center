import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
  exportKeywordExecutionPlan,
} from "../src/lib/keywordReviewExecutionPreflight.ts";
import { buildKeywordShoplingPayloadPreview } from "../src/lib/keywordReviewPayloadPreview.ts";

function row(overrides = {}) {
  return {
    goodsKey: "121044",
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
    ...overrides,
  };
}

function run(rows, configOverrides = {}, confirmation = true) {
  const previewResult = buildKeywordShoplingPayloadPreview(rows);
  const config = {
    ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
    allowedMallKeys: ["mall-1"],
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

test("maxRows zero blocks all otherwise eligible rows", () => {
  const { result } = run([row()], { maxRows: 0 });
  assert.equal(result.summary.eligibleCount, 0);
  assert.equal(result.summary.maxRowsExceeded, true);
  assert.ok(result.blockedItems[0].block_reasons.includes("MAX_ROWS_EXCEEDED"));
});

test("allowed mall_key passes and disallowed mall_key blocks", () => {
  assert.equal(run([row()]).result.summary.eligibleCount, 1);
  const { result } = run([row()], { allowedMallKeys: ["different-mall"] });
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

test("duplicate goods_key blocks every duplicate safely", () => {
  const { result } = run([
    row(),
    row({ sourceRowIndex: 3, mallKey: "mall-1" }),
  ]);
  assert.equal(result.summary.eligibleCount, 0);
  assert.equal(result.summary.duplicateGoodsKeyCount, 2);
  assert.ok(
    result.blockedItems.every((item) =>
      item.block_reasons.includes("DUPLICATE_GOODS_KEY"),
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
    allowedMallKeys: ["mall-1"],
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

test("underfilled final_site_srch fails closed at preflight", () => {
  const { result } = run([
    row({ recommendedSiteSrch: "one, two, three" }),
  ]);
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(
    result.blockedItems[0].block_reasons.includes(
      "FINAL_SITE_SRCH_UNDERFILLED",
    ),
  );
});

test("missing final confirmation blocks the plan", () => {
  const { result } = run([row()], {}, false);
  assert.equal(result.summary.requiresFinalConfirmation, true);
  assert.equal(result.summary.eligibleCount, 0);
  assert.ok(
    result.blockedItems[0].block_reasons.includes(
      "FINAL_CONFIRMATION_REQUIRED",
    ),
  );
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
