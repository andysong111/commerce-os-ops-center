import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildKeywordExecutionIntent,
  DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION,
  exportKeywordExecutionIntent,
} from "../src/lib/keywordReviewExecutionIntent.ts";
import {
  buildKeywordExecutionPreflight,
  DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
} from "../src/lib/keywordReviewExecutionPreflight.ts";
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
    ...overrides,
  };
}

function fixture(rows = [row()], configOverrides = {}) {
  const config = {
    ...DEFAULT_KEYWORD_EXECUTION_PREFLIGHT_CONFIG,
    allowedMallKeys: ["mall-1"],
    maxRows: 10,
    ...configOverrides,
  };
  const preflight = buildKeywordExecutionPreflight(
    {
      previewResult: buildKeywordShoplingPayloadPreview(rows),
      finalConfirmationText: config.confirmationText,
    },
    config,
  );
  const input = {
    confirmationAccepted: true,
    confirmationText: DEFAULT_KEYWORD_EXECUTION_INTENT_CONFIRMATION,
    preflightConfig: config,
    createdAt: "2026-06-15T12:34:56.000Z",
    randomSuffix: "abc123",
  };
  return { config, preflight, input };
}

test("valid preflight creates a preview-only execution intent snapshot", () => {
  const { preflight, input, config } = fixture();
  const intent = buildKeywordExecutionIntent(preflight, input);
  assert.equal(intent.intentId, "keyword-intent-20260615-123456-abc123");
  assert.equal(intent.mode, "preview_only_execution_intent");
  assert.equal(intent.status, "intent_created");
  assert.equal(intent.executionDisabled, true);
  assert.equal(intent.notExecuted, true);
  assert.deepEqual(intent.preflightConfigSnapshot, config);
  assert.equal(intent.eligibleItemsSnapshot.length, 1);
  assert.equal(intent.eligibleItemsSnapshot[0].goods_key, "goods-1");
});

test("zero eligible rows fails", () => {
  const { preflight, input } = fixture([row({ reviewStatus: "hold" })]);
  assert.throws(() => buildKeywordExecutionIntent(preflight, input), /at least one/);
});

test("missing confirmation fails", () => {
  const { preflight, input } = fixture();
  assert.throws(
    () => buildKeywordExecutionIntent(preflight, { ...input, confirmationAccepted: false }),
    /must be accepted/,
  );
});

test("wrong confirmation phrase fails", () => {
  const { preflight, input } = fixture();
  assert.throws(
    () => buildKeywordExecutionIntent(preflight, { ...input, confirmationText: "wrong" }),
    /does not match/,
  );
});

test("maxRowsExceeded preflight fails", () => {
  const { preflight, input } = fixture([row()], { maxRows: 0 });
  assert.throws(() => buildKeywordExecutionIntent(preflight, input), /maxRows/);
});

test("blocked items remain blocked snapshots and never become eligible", () => {
  const { preflight, input } = fixture([
    row(),
    row({ goodsKey: "held", sourceRowIndex: 3, reviewStatus: "hold" }),
  ]);
  const intent = buildKeywordExecutionIntent(preflight, input);
  assert.deepEqual(intent.eligibleItemsSnapshot.map((item) => item.goods_key), ["goods-1"]);
  assert.deepEqual(intent.blockedItemsSnapshot.map((item) => item.goods_key), ["held"]);
});

test("exported JSON includes explicit non-execution guards", () => {
  const { preflight, input } = fixture();
  const exported = JSON.parse(
    exportKeywordExecutionIntent(buildKeywordExecutionIntent(preflight, input)),
  );
  assert.equal(exported.noShoplingApiCall, true);
  assert.equal(exported.futureExecutionRequiresSeparatePR, true);
  assert.equal(exported.executionDisabled, true);
  assert.equal(exported.notExecuted, true);
});

for (const [field, value, message] of [
  ["goods_key", "", /goods_key/],
  ["mall_key", "", /mall_key/],
  ["final_title", "", /final_title/],
  ["final_site_srch", "", /final_site_srch/],
]) {
  test(`missing ${field} fails intent validation`, () => {
    const { preflight, input } = fixture();
    preflight.eligibleItems[0][field] = value;
    assert.throws(() => buildKeywordExecutionIntent(preflight, input), message);
  });
}

test("execution intent implementation contains no live Shopling execution", async () => {
  const source = await readFile(
    new URL("../src/lib/keywordReviewExecutionIntent.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/shopling/i);
  assert.doesNotMatch(source, /SHOPLING_(API_KEY|SECRET|TOKEN)/i);
});
