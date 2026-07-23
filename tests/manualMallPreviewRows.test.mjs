import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildManualMallCompactPlanIdentity, buildManualMallPreviewRows } from "../src/lib/manualMallPreviewRows.ts";

function item(overrides = {}) {
  return {
    goods_key: "G1",
    mall_key: "SMALL_00001",
    source_row_index: 1,
    ptn_goods_cd: "",
    group_suffix: "",
    product_group: "Group A",
    product_group_type: "",
    product_group_status: "",
    original_title: "Original",
    recommended_title: "Recommended",
    edited_title: "",
    final_title: "Alpha Beta Gamma",
    original_site_srch: "",
    recommended_site_srch: "alpha,beta,gamma",
    edited_site_srch: "",
    edited_mall_key: "",
    final_site_srch: "alpha,beta,gamma",
    classification: "manual_review",
    review_status: "approved",
    block_reason: "",
    warning_flags: "",
    payload_status: "preview_ready",
    validation_errors: [],
    validation_warnings: [],
    preview_xml_fragment: null,
    preview_payload: null,
    market_name: "Mall One",
    title_keyword_count: 3,
    title_included_keyword_count: 3,
    title_keyword_integrity_ok: true,
    ...overrides,
  };
}

function preview(items) {
  return {
    items,
    previewableItems: items,
    excludedItems: [],
    summary: { totalReviewedRows: items.length, approvedCount: items.length, previewReadyCount: items.length, invalidCount: 0, heldCount: 0, blockedRiskCount: 0 },
    previewXml: "",
    expansionMode: "product_group_markets",
    expandedItemCount: items.length,
    groupVariantEnabled: true,
    attributeModifierMode: "safe_source_only",
    expansionErrors: [],
  };
}

function preflight(eligibleItems, blockedItems = []) {
  return {
    eligibleItems: eligibleItems.map((row) => ({ ...row, preflight_status: "eligible", block_reasons: [], preflight_warnings: [] })),
    blockedItems: blockedItems.map((row) => ({ ...row, preflight_status: "blocked", block_reasons: row.block_reasons ?? ["PREFLIGHT_BLOCK"], preflight_warnings: [] })),
    warnings: [],
    errors: [],
    summary: { totalPreviewItems: eligibleItems.length + blockedItems.length, eligibleCount: eligibleItems.length, blockedCount: blockedItems.length },
  };
}

test("null preview returns not_generated and zero rows", () => {
  const result = buildManualMallPreviewRows({ previewResult: null, preflightResult: null });
  assert.equal(result.status, "not_generated");
  assert.deepEqual(result.rows, []);
  assert.equal(result.summary.totalCount, 0);
});

test("preview without preflight uses preview items without regenerating titles", () => {
  const row = item({ final_title: "Already Generated Multi Word Title" });
  const result = buildManualMallPreviewRows({ previewResult: preview([row]), preflightResult: null });
  assert.equal(result.status, "preview_only");
  assert.equal(result.rows[0].finalTitle, "Already Generated Multi Word Title");
  assert.equal(result.rows[0].preflightStatus, "pending");
  assert.equal(result.rows[0].applyStatus, "preflight_pending");
});

test("preflight eligible rows preserve eligibleItems order", () => {
  const pf = preflight([item({ goods_key: "G2" }), item({ goods_key: "G1" })]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf });
  assert.deepEqual(result.rows.map((row) => row.goodsKey), ["G2", "G1"]);
});

test("preflight blocked rows preserve blockedItems order", () => {
  const pf = preflight([], [item({ goods_key: "B2" }), item({ goods_key: "B1" })]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf });
  assert.deepEqual(result.rows.map((row) => row.goodsKey), ["B2", "B1"]);
});

test("eligible rows appear before blocked rows", () => {
  const pf = preflight([item({ goods_key: "E1" })], [item({ goods_key: "B1" })]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf });
  assert.deepEqual(result.rows.map((row) => row.preflightStatus), ["eligible", "blocked"]);
});

test("goods_key, mall_key, final_title, final_site_srch identity exactly matches compact plan", () => {
  const pf = preflight([item({ goods_key: "G2", final_title: "Title Two" }), item({ goods_key: "G1", final_title: "Title One" })]);
  assert.deepEqual(buildManualMallCompactPlanIdentity(pf), JSON.parse(JSON.stringify(pf.eligibleItems.map((row) => ({ goods_key: row.goods_key, mall_key: row.mall_key, final_title: row.final_title, final_site_srch: row.final_site_srch })))));
});

test("multi-word generated titles remain unchanged", () => {
  const title = "Red Summer Linen Shirt XL";
  const pf = preflight([item({ final_title: title })]);
  assert.equal(buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf }).rows[0].finalTitle, title);
});

test("success message 정상 does not block", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", message: "정상" }] });
  assert.equal(result.rows[0].blocked, false);
  assert.equal(result.rows[0].applyStatus, "ready");
});

test("success message without status does not block", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goodsKey: "G1", mallKey: "SMALL_00001", message: "success" }] });
  assert.equal(result.rows[0].blocked, false);
});

test("failed status blocks", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", status: "failed" }] });
  assert.equal(result.rows[0].blocked, true);
  assert.equal(result.rows[0].applyStatus, "failed");
});

test("not_applied status blocks", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", apply_status: "not_applied" }] });
  assert.equal(result.rows[0].blocked, true);
});

test("explicit block_reason blocks", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", block_reason: "blocked by apply" }] });
  assert.deepEqual(result.rows[0].blockingReasons, ["blocked by apply"]);
});

test("explicit blocking_reason blocks", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", blocking_reason: "blocked explicitly" }] });
  assert.equal(result.rows[0].blocked, true);
});

test("explicit error blocks", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", error: "boom" }] });
  assert.equal(result.rows[0].applyStatus, "failed");
});

test("preflight block reasons are preserved", () => {
  const pf = preflight([], [item({ block_reasons: ["PREFLIGHT_A"] })]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf });
  assert.deepEqual(result.rows[0].blockingReasons, ["PREFLIGHT_A"]);
});

test("duplicate blocking reasons are removed", () => {
  const pf = preflight([item({ validation_errors: ["same"] })]);
  pf.eligibleItems[0].block_reasons = ["same"];
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", error: "same" }] });
  assert.deepEqual(result.rows[0].blockingReasons, ["same"]);
});

test("one goods_key result does not affect another goods_key", () => {
  const pf = preflight([item({ goods_key: "G1" }), item({ goods_key: "G2" })]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", status: "failed" }] });
  assert.deepEqual(result.rows.map((row) => row.applyStatus), ["failed", "ready"]);
});

test("verify success produces verified status", () => {
  const pf = preflight([item()]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, verifyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", verification_status: "success" }] });
  assert.equal(result.rows[0].applyStatus, "verified");
});

test("summary counts are exact", () => {
  const pf = preflight([item({ goods_key: "G1" }), item({ goods_key: "G2" })], [item({ goods_key: "G3" })]);
  const result = buildManualMallPreviewRows({ previewResult: preview([]), preflightResult: pf, applyResults: [{ goods_key: "G1", mall_key: "SMALL_00001", status: "applied" }, { goods_key: "G2", mall_key: "SMALL_00001", status: "failed" }] });
  assert.deepEqual(result.summary, { totalCount: 3, eligibleCount: 2, blockedCount: 2, appliedCount: 1, failedCount: 1 });
});

test("source contains no fetch, API, workflow dispatch, JSX, or Shopling write", async () => {
  const source = await readFile(new URL("../src/lib/manualMallPreviewRows.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /api\//i);
  assert.doesNotMatch(source, /workflow_dispatch|dispatch/i);
  assert.doesNotMatch(source, /<[A-Z][A-Za-z]*(\s|>|\/)/);
  assert.doesNotMatch(source, /jsx/i);
  assert.doesNotMatch(source, /shopling/i);
});
