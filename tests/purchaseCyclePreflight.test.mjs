import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPurchaseCyclePreflight, buildPurchaseReplacementDraftSnapshot, readPurchaseCyclePreflight,
  validPurchaseTargetDate, samePurchaseCandidatePin,
} from "../src/lib/purchaseCyclePreflightCore.ts";
import {
  buildPurchaseOwnerCostEstimateSnapshot,
  OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE,
  OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE,
  PURCHASE_OWNER_COST_ESTIMATES,
} from "../src/lib/purchaseCycleOwnerCostEstimate.ts";

const fp = value => `sha256:${value.repeat(64)}`;
const fixture = () => {
  const before = { requestId: "sales-test-1", analysisAsOf: "2026-10-01T01:00:00.000Z", planFingerprint: fp("a"), eventFingerprint: fp("b"), planningContentFingerprint: fp("c") };
  return {
    now: "2026-10-01T02:00:00.000Z", before, after: { ...before }, sourceErrors: [],
    spendBefore: { cycleMonth: "2026-10", readAt: "2026-10-01T01:59:00Z", recordedSpendKrw: 0, contentFingerprint: fp("1") },
    spendAfter: { cycleMonth: "2026-10", readAt: "2026-10-01T01:59:00Z", recordedSpendKrw: 0, contentFingerprint: fp("1") },
    options: { targetDate: "2026-10-01", cashLimitKrw: 50000, maxSkus: 1, maxUnitsPerSku: 10 },
    gate: { generatedAt: "2026-10-01T01:59:00.000Z", state: "EXACT_MATCH", safeToApply: true, candidateSalesRequestId: before.requestId, candidatePlanFingerprint: before.planFingerprint, candidateEventFingerprint: before.eventFingerprint, promotionFingerprint: fp("d"), checks: [{ key: "context", passed: true, message: "same" }], message: "checked" },
    reconciliation: { generatedAt: "2026-10-01T01:59:00.000Z", state: "READY", ready: true, fullApplyVerified: true, candidateSalesRequestId: before.requestId, analysisAsOf: before.analysisAsOf, candidatePlanFingerprint: before.planFingerprint, candidateEventFingerprint: before.eventFingerprint, reconciliationFingerprint: fp("e"), persistedContentFingerprint: fp("f"), checks: [{ key: "full-readback", passed: true, message: "verified" }], message: "readback verified" },
    priority: { generatedAt: "2026-10-01T01:59:00.000Z", state: "READY", writesEnabled: false, purchaseShadowReady: true,
      source: { analysisAsOf: before.analysisAsOf, planningContentFingerprint: before.planningContentFingerprint, shadowPlanningContentFingerprint: before.planningContentFingerprint, canonicalContentFingerprint: fp("f"), reconciliationFingerprint: fp("e"), cycleMonth: "2026-10", budgetMonth: "2026-09", budgetKrw: 100000, grossBudgetKrw: 145000, purchaseCostMultiplier: 1.45, inventoryGeneratedAt: "2026-10-01T01:59:00Z", inventoryContentFingerprint: fp("2"), comparisonAvailable: true, sameAnalysisAsOf: true, blockerKeys: [] },
      rows: [{ barcode: "BAA1-1", name: "SIMULATION ONLY", purchaseStatus: "발주 추천", recommendedQty: 5, expectedCost: 25000, priorityScore: 90, inventoryMode: "VERIFIED", inventoryVerified: true, executionInventoryEligible: true, inventoryCalculationUsable: true, inventoryRequiresReview: false, initialZeroUnverified: false, advisoryOnly: false, inventoryQuantity: 2, openCommitment: 3, hasConfirmedReceiptCost: true, latestConfirmedReceiptAt: "2026-09-01T00:00:00Z", latestConfirmedReceiptCostKrw: 5000, protectedCostKrw: 4000, action: "NONE", operationallyReady: true }],
    },
  };
};
const locked = report => {
  for (const key of ["businessWritesEnabled", "approvalEnabled", "actualPurchaseExecuted", "scheduledExecution"]) assert.equal(report[key], false, key);
  assert.equal(report.stages.find(row => row.number === 11).state, "LOCKED");
};
const blocked = (report, key) => {
  assert.equal(report.previewReady, false);
  assert.ok(report.blockers.includes(key), JSON.stringify(report.blockers));
  assert.deepEqual(report.selected, []);
  locked(report);
};

test("real stage shapes compose a budget-limited preview, never an approval", () => {
  const report = buildPurchaseCyclePreflight(fixture());
  assert.equal(report.previewReady, true);
  assert.equal(report.state, "AWAITING_OWNER_REVIEW");
  assert.equal(report.estimatedSpendKrw, 25000);
  assert.equal(report.selected[0].quantity, 5);
  assert.equal(report.requiredBudgetMonth, "2026-09");
  assert.deepEqual(report.stages.map(row => row.number), [5, 6, 7, 8, 9, 10, 11]);
  locked(report);
});
test("coherent provisional inventory is included only in the read-only owner-review preview", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    inventoryMode: "PROVISIONAL",
    inventoryVerified: false,
    executionInventoryEligible: false,
    inventoryCalculationUsable: true,
    inventoryRequiresReview: false,
    initialZeroUnverified: true,
    advisoryOnly: true,
    action: "PROVISIONAL_DECISION_EVIDENCE_REQUIRED",
    operationallyReady: false,
  });
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true, JSON.stringify({ blockers: report.blockers, reviewBlockers: report.reviewBlockers }));
  assert.equal(report.state, "PREVIEW_ONLY");
  assert.equal(report.selected[0].inventoryMode, "PROVISIONAL");
  assert.equal(report.selected[0].inventoryVerified, false);
  assert.equal(report.selected[0].advisoryOnly, true);
  assert.ok(report.reviewBlockers.includes("PROVISIONAL_INVENTORY_OWNER_REVIEW_REQUIRED"));
  assert.match(report.stages.find(row => row.number === 8).message, /SOLD_OUT_RESET=0/);
  assert.match(report.stages.find(row => row.number === 8).message, /중국 확정입고와 판매/);
  locked(report);
});
for (const field of ["requestId", "analysisAsOf", "planFingerprint", "eventFingerprint", "planningContentFingerprint"]) {
  test(`source drift blocks at ${field}`, () => {
    const input = fixture(); input.after[field] = field === "analysisAsOf" ? "2026-10-01T01:01:00Z" : "changed";
    blocked(buildPurchaseCyclePreflight(input), "SOURCE_CHANGED_OR_MISSING");
  });
}
test("absent pins cannot match each other", () => assert.equal(samePurchaseCandidatePin(null, null), false));
for (const time of ["2026-09-29T00:00:00Z", "2026-10-02T00:00:00Z", "invalid"]) {
  test(`stale/future/invalid source is never actionable: ${time}`, () => {
    const input = fixture(); input.before.analysisAsOf = time; input.after.analysisAsOf = time;
    blocked(buildPurchaseCyclePreflight(input), "SALES_SOURCE_STALE_OR_FUTURE");
  });
}
for (const key of ["canonicalContentFingerprint", "reconciliationFingerprint", "planningContentFingerprint", "shadowPlanningContentFingerprint", "analysisAsOf"]) {
  test(`independent report context mismatch: ${key}`, () => {
    const input = fixture(); input.priority.source[key] = null;
    blocked(buildPurchaseCyclePreflight(input), "PURCHASE_SOURCE_CONTEXT_MISMATCH");
  });
}
test("old reports without provenance fail closed", () => {
  const input = fixture(); delete input.priority.source;
  blocked(buildPurchaseCyclePreflight(input), "PURCHASE_SOURCE_CONTEXT_MISMATCH");
});
test("report generation SUCCEEDED is not a promotion or readback pass", () => {
  const input = fixture(); input.gate.safeToApply = false; input.gate.state = "BLOCKED"; input.reconciliation.ready = false;
  blocked(buildPurchaseCyclePreflight(input), "SALES_PROMOTION_NOT_VERIFIED");
});
test("canary gate PASS alone cannot replace full Product Master readback", () => {
  const input = fixture(); input.reconciliation.fullApplyVerified = false;
  blocked(buildPurchaseCyclePreflight(input), "PRODUCT_MASTER_FULL_READBACK_REQUIRED");
});
test("COMPLETED source uses its verified historical readback, not a new write permit", () => {
  const input = fixture(); input.gate.state = "BLOCKED"; input.gate.safeToApply = false; input.gate.checks[0].passed = false;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true); locked(report);
});
for (const which of ["gate", "reconciliation"]) {
  test(`empty ${which} checks are not vacuous proof`, () => {
    const input = fixture(); input[which].checks = [];
    if (which === "gate") input.reconciliation.ready = false;
    assert.equal(buildPurchaseCyclePreflight(input).previewReady, false);
  });
}
test("an incoherent provisional SKU is isolated without blocking another valid SKU", () => {
  const input = fixture(); const bad = { ...input.priority.rows[0], barcode: "BAA2-1", inventoryMode: "PROVISIONAL", inventoryVerified: false, hasConfirmedReceiptCost: false };
  input.priority.rows.push(bad);
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true); assert.equal(report.selected.length, 1);
  assert.deepEqual(report.stages.filter(row => [7, 8].includes(row.number)).map(row => row.state), ["PARTIAL", "PARTIAL"]);
  assert.ok(report.excluded.find(row => row.barcode === bad.barcode).reasons.includes("VERIFIED_INVENTORY_REQUIRED"));
});
for (const patch of [
  { inventoryMode: "PROVISIONAL" }, { inventoryMode: "REVIEW" }, { inventoryVerified: false },
  { initialZeroUnverified: true }, { advisoryOnly: true }, { inventoryRequiresReview: true },
  { executionInventoryEligible: false }, { inventoryQuantity: -1 }, { openCommitment: -1 },
  { hasConfirmedReceiptCost: false }, { latestConfirmedReceiptCostKrw: 0 },
  { latestConfirmedReceiptAt: "2026-10-02T00:00:00Z" }, { recommendedQty: 1.5 },
  { recommendedQty: NaN }, { priorityScore: Infinity }, { barcode: "AAA001" },
  { action: "COST_CONFIRMATION_REQUIRED" }, { operationallyReady: false },
]) {
  test(`unverified or malformed row excluded: ${Object.keys(patch).join(",")}:${String(Object.values(patch)[0])}`, () => {
    const input = fixture(); Object.assign(input.priority.rows[0], patch);
    blocked(buildPurchaseCyclePreflight(input), "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  });
}
test("duplicate barcode blocks even if only one duplicate is a purchase recommendation", () => {
  const input = fixture(); input.priority.rows.push({ ...input.priority.rows[0], purchaseStatus: "발주 보류" });
  blocked(buildPurchaseCyclePreflight(input), "DUPLICATE_BARCODE");
});
test("omitted duplicate cash cap uses the automatic previous-month cost envelope", () => {
  const input = fixture(); input.options.cashLimitKrw = null;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.equal(report.automaticGrossBudgetKrw, 145000);
  assert.equal(report.effectiveCashKrw, 145000);
  assert.equal(report.effectiveBudgetKrw, 100000);
  locked(report);
});
test("explicit cash cap reduces a line without exceeding the entered all-in cash", () => {
  const input = fixture(); input.options.cashLimitKrw = 29000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.equal(report.effectiveBudgetKrw, 20000);
  assert.equal(report.selected[0].originalRecommendedQuantity, 5);
  assert.equal(report.selected[0].quantity, 4);
  assert.equal(report.selected[0].cashAdjusted, true);
  assert.equal(report.cashAdjustedCount, 1);
  assert.equal(report.estimatedSpendKrw, 20000);
  assert.equal(input.priority.rows[0].recommendedQty, 5);
});
test("explicit cash replaces a smaller automatic envelope and remains safe for a large amount", () => {
  const input = fixture();
  input.options.cashLimitKrw = 10_000_000_000;
  input.priority.source.budgetKrw = 20000;
  input.priority.source.grossBudgetKrw = 29000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.equal(report.effectiveCashKrw, 10_000_000_000);
  assert.equal(report.effectiveBudgetKrw, Math.floor(10_000_000_000 / 1.45));
  assert.equal(report.selected[0].quantity, report.selected[0].originalRecommendedQuantity);
  assert.equal(report.estimatedSpendKrw, 25000);
  assert.equal(report.estimatedAllInSpendKrw, 36250);
  assert.ok(report.estimatedAllInSpendKrw <= report.effectiveCashKrw);
});
test("automatic budget reserves sourcing cash before calculating the reorder product budget", () => {
  const input = fixture();
  input.options.cashLimitKrw = null;
  input.options.sourcingBudgetPercent = 20;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.effectiveCashKrw, 145000);
  assert.equal(report.sourcingBudgetPercent, 20);
  assert.equal(report.sourcingBudgetKrw, 29000);
  assert.equal(report.reorderCashKrw, 116000);
  assert.equal(report.effectiveBudgetKrw, 80000);
  assert.equal(report.selected[0].quantity, 5);
  assert.match(report.stages.find(row => row.number === 10).message, /신규상품 소싱 20%/);
});
test("explicit cash applies sourcing reserve before cashflow quantity allocation", () => {
  const input = fixture();
  input.options.cashLimitKrw = 29000;
  input.options.sourcingBudgetPercent = 20;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.sourcingBudgetKrw, 5800);
  assert.equal(report.reorderCashKrw, 23200);
  assert.equal(report.effectiveBudgetKrw, 16000);
  assert.equal(report.selected[0].quantity, 3);
  assert.equal(report.estimatedSpendKrw, 15000);
  assert.ok(report.estimatedAllInSpendKrw <= report.reorderCashKrw);
});
test("large explicit cash calculates an exact sourcing reserve without over-ordering", () => {
  const input = fixture();
  input.options.cashLimitKrw = Number.MAX_SAFE_INTEGER;
  input.options.sourcingBudgetPercent = 37;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.sourcingBudgetKrw, 3_332_663_724_254_166);
  assert.equal(report.reorderCashKrw, 5_674_535_530_486_825);
  assert.equal(report.selected[0].quantity, report.selected[0].originalRecommendedQuantity);
  assert.ok(Number.isSafeInteger(report.sourcingBudgetKrw));
  assert.ok(report.estimatedAllInSpendKrw <= report.reorderCashKrw);
});
test("one hundred percent sourcing reserve leaves no reorder draft budget", () => {
  const input = fixture();
  input.options.sourcingBudgetPercent = 100;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.sourcingBudgetKrw, report.effectiveCashKrw);
  assert.equal(report.reorderCashKrw, 0);
  assert.equal(report.effectiveBudgetKrw, 0);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
test("quantity cap excludes the whole line rather than breaking carton/MOQ", () => {
  const input = fixture(); input.options.maxUnitsPerSku = 4;
  const report = buildPurchaseCyclePreflight(input);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS"); assert.ok(report.excluded[0].reasons.includes("CANARY_QUANTITY_LIMIT"));
});
test("selection is deterministic, bounded, and does not mutate source arrays", () => {
  const input = fixture(); input.options.maxSkus = 2; input.options.cashLimitKrw = 50000;
  input.priority.rows.push({ ...input.priority.rows[0], barcode: "BAA2-1", expectedCost: 10000, latestConfirmedReceiptCostKrw: 2000, protectedCostKrw: 2000 }, { ...input.priority.rows[0], barcode: "BAA3-1", expectedCost: 15000, latestConfirmedReceiptCostKrw: 3000, protectedCostKrw: 3000, priorityScore: 95 });
  const original = structuredClone(input); const a = buildPurchaseCyclePreflight(input);
  assert.deepEqual(input, original); assert.deepEqual(a.selected.map(row => row.barcode), ["BAA3-1", "BAA2-1"]);
  input.priority.rows.reverse(); const b = buildPurchaseCyclePreflight(input);
  assert.deepEqual(a.selected, b.selected); assert.equal(a.planFingerprint, b.planFingerprint); assert.equal(a.estimatedSpendKrw, 25000);
});
for (const mutate of [i => i.options.cashLimitKrw++, i => { i.options.sourcingBudgetPercent = 10; }, i => i.options.maxSkus++, i => i.priority.rows[0].openCommitment++, i => i.priority.rows[0].expectedCost++, i => i.priority.rows[0].inventoryQuantity++, i => i.priority.rows[0].latestConfirmedReceiptCostKrw++]) {
  test("material evidence or limits change the pinned preview fingerprint", () => {
    const input = fixture(); const previous = buildPurchaseCyclePreflight(input); mutate(input);
    assert.notEqual(buildPurchaseCyclePreflight(input).planFingerprint, previous.planFingerprint);
  });
}
test("September snapshot cannot stand in for October purchase funding", () => {
  const input = fixture(); input.priority.source.cycleMonth = "2026-09"; input.priority.source.budgetMonth = "2026-08";
  blocked(buildPurchaseCyclePreflight(input), "TARGET_CYCLE_RECALCULATION_REQUIRED");
});
test("future September totals remain provisional before October 1 in Seoul", () => {
  const input = fixture(); input.now = "2026-09-30T14:59:59Z";
  const report = buildPurchaseCyclePreflight(input); assert.equal(report.dateState, "BEFORE_TARGET");
  assert.ok(report.blockers.includes("BUDGET_MONTH_NOT_CLOSED")); locked(report);
});
test("owner-authorized early preview uses the automatic budget but requires closed-data recalculation", () => {
  const input = fixture();
  const analysisAsOf = "2026-09-30T14:00:00.000Z";
  input.now = "2026-09-30T14:59:59.000Z";
  input.before.analysisAsOf = analysisAsOf;
  input.after.analysisAsOf = analysisAsOf;
  input.reconciliation.analysisAsOf = analysisAsOf;
  input.priority.source.analysisAsOf = analysisAsOf;
  input.priority.generatedAt = "2026-09-30T14:55:00.000Z";
  input.priority.source.inventoryGeneratedAt = "2026-09-30T14:55:00.000Z";
  input.gate.generatedAt = "2026-09-30T14:55:00.000Z";
  input.reconciliation.generatedAt = "2026-09-30T14:55:00.000Z";
  input.spendBefore.readAt = "2026-09-30T14:55:00.000Z";
  input.spendAfter.readAt = "2026-09-30T14:55:00.000Z";
  input.options.cashLimitKrw = null;
  input.options.allowOpenBudgetPreview = true;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true, JSON.stringify({ blockers: report.blockers, reviewBlockers: report.reviewBlockers }));
  assert.equal(report.state, "PREVIEW_ONLY");
  assert.equal(report.automaticGrossBudgetKrw, 145000);
  assert.ok(report.reviewBlockers.includes("OPEN_BUDGET_EARLY_PREVIEW_RECHECK_REQUIRED"));
  assert.ok(!report.blockers.includes("BUDGET_MONTH_NOT_CLOSED"));
  assert.match(report.stages.find(row => row.number === 10).message, /월 마감 전 조기 미리보기/);
  locked(report);
});
test("Seoul October 1 boundary is not UTC October 1 and never auto-approves", () => {
  const input = fixture(); input.now = "2026-09-30T15:00:00Z";
  const report = buildPurchaseCyclePreflight(input); assert.equal(report.dateState, "ON_TARGET");
  assert.ok(!report.blockers.includes("BUDGET_MONTH_NOT_CLOSED")); locked(report);
});
test("past target date requests reconfirmation rather than scheduling an order", () => {
  const input = fixture(); input.options.targetDate = "2026-09-30";
  const report = buildPurchaseCyclePreflight(input); assert.equal(report.dateState, "TARGET_PASSED");
  assert.ok(report.reviewBlockers.includes("TARGET_DATE_RECONFIRM_REQUIRED")); locked(report);
});
test("January purchase uses the previous December budget", () => {
  const input = fixture(); input.options.targetDate = "2027-01-01";
  assert.equal(buildPurchaseCyclePreflight(input).requiredBudgetMonth, "2026-12");
});
for (const options of [{ targetDate: "2026-02-30" }, { targetDate: "2026-13-01" }, { cashLimitKrw: 0 }, { cashLimitKrw: -1 }, { cashLimitKrw: "50000" }, { cashLimitKrw: Number.MAX_SAFE_INTEGER + 1 }, { sourcingBudgetPercent: -1 }, { sourcingBudgetPercent: 101 }, { sourcingBudgetPercent: 1.5 }, { sourcingBudgetPercent: "10" }, { maxSkus: 0 }, { maxSkus: 101 }, { maxUnitsPerSku: 0 }]) {
  test(`invalid options rejected: ${JSON.stringify(options)}`, () => {
    const input = fixture(); Object.assign(input.options, options); assert.throws(() => buildPurchaseCyclePreflight(input));
  });
}
test("valid leap date accepted, invalid non-leap date rejected", () => { assert.equal(validPurchaseTargetDate("2028-02-29"), true); assert.equal(validPurchaseTargetDate("2026-02-29"), false); });
test("different-time comparison and claim auxiliary blockers never disappear", () => {
  const input = fixture(); input.priority.source.sameAnalysisAsOf = false; input.priority.source.blockerKeys = ["claim-auxiliary"];
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true); assert.equal(report.state, "PREVIEW_ONLY"); assert.equal(report.comparable, false);
  assert.ok(report.reviewBlockers.includes("UPSTREAM:claim-auxiliary")); locked(report);
});
test("empty purchase universe is waiting, not 0/0 verified", () => {
  const input = fixture(); input.priority.rows = [];
  const report = buildPurchaseCyclePreflight(input);
  assert.deepEqual(report.stages.filter(row => [7, 8].includes(row.number)).map(row => row.state), ["WAITING", "WAITING"]);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
test("reader adapter brackets the source and loads the expensive priority only once", async () => {
  const input = fixture(); const counts = { candidate: 0, gate: 0, reconciliation: 0, priority: 0, monthlySpend: 0 };
  const readers = Object.fromEntries(Object.keys(counts).map(key => [key, async () => { counts[key]++; return key === "candidate" ? input.before : key === "monthlySpend" ? input.spendBefore : input[key]; }]));
  const report = await readPurchaseCyclePreflight(input.options, readers, () => input.now);
  assert.equal(report.previewReady, true); assert.deepEqual(counts, { candidate: 2, gate: 1, reconciliation: 1, priority: 1, monthlySpend: 2 }); locked(report);
});
test("replacement reader brackets the exact active draft and carries its audit into the report", async () => {
  const input = fixture();
  const draftId = "fast-purchase-draft:68b2aa56a8a0ac018141";
  input.options.replaceDraftId = draftId;
  const snapshot = buildPurchaseReplacementDraftSnapshot(
    draftId,
    input.now,
    [{ barcode: "BAA1-1", name: "기존 상품", quantity: 3 }],
  );
  let replacementReads = 0;
  const report = await readPurchaseCyclePreflight(input.options, {
    candidate: async () => input.before,
    gate: async () => input.gate,
    reconciliation: async () => input.reconciliation,
    priority: async () => input.priority,
    monthlySpend: async () => input.spendBefore,
    replacementDraft: async () => {
      replacementReads++;
      return { ...snapshot, readAt: new Date(Date.parse(input.now) + replacementReads * 1000).toISOString() };
    },
  }, () => input.now);
  assert.equal(replacementReads, 2);
  assert.equal(report.previewReady, true);
  assert.equal(report.replacementAudit.complete, true);
  assert.equal(report.replacementAudit.quantityChanged.length, 1);
});
test("reader failure preserves a diagnostic report without leaking raw errors or using a stale fallback", async () => {
  const input = fixture(); const secret = "do-not-expose-raw-db-url-secret";
  const report = await readPurchaseCyclePreflight(input.options, { candidate: async () => input.before, gate: async () => { throw new Error(secret); }, reconciliation: async () => input.reconciliation, priority: async () => input.priority, monthlySpend: async () => input.spendBefore }, () => input.now);
  blocked(report, "PROMOTION_GATE_READ_FAILED"); assert.ok(!JSON.stringify(report).includes(secret));
});
test("reader catches a candidate superseded during downstream reads", async () => {
  const input = fixture(); let called = 0;
  const report = await readPurchaseCyclePreflight(input.options, { candidate: async () => called++ ? { ...input.before, requestId: "new" } : input.before, gate: async () => input.gate, reconciliation: async () => input.reconciliation, priority: async () => input.priority, monthlySpend: async () => input.spendBefore }, () => input.now);
  blocked(report, "SOURCE_CHANGED_OR_MISSING");
});
test("invalid request is rejected before any source reader is called", async () => {
  const input = fixture(); input.options.cashLimitKrw = -1; let calls = 0;
  const read = async () => { calls++; throw new Error("must not run"); };
  await assert.rejects(readPurchaseCyclePreflight(input.options, { candidate: read, gate: read, reconciliation: read, priority: read, monthlySpend: read }, () => input.now)); assert.equal(calls, 0);
});
test("preflight source has no write executor, credentials, background timer, or synthetic evidence pin", () => {
  for (const name of ["purchaseCyclePreflightCore.ts", "purchaseCyclePreflight.ts"]) {
    const source = readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.from\(|\.insert\(|\.upsert\(|\.rpc\(|setInterval\(|process\.env|\bfetch\(/);
    assert.doesNotMatch(source, /report\??\.candidateSalesRequestId/);
  }
  const service = readFileSync(new URL("../src/lib/purchaseCyclePreflight.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /loadCanonicalPurchaseShadow|loadReceiptCostRecoveryReadiness/);
  assert.match(service, /loadInventoryVerificationPriority\(options\.targetDate/);
  assert.match(service, /excludeCommitmentDraftId: options\.replaceDraftId/);
});
test("operator page accepts an all-in cash cap while preserving the automatic envelope", () => {
  const page = readFileSync(new URL("../src/app/purchase-cycle-preflight/page.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../src/components/purchase-cycle-preflight/PurchasePreflightForm.tsx", import.meta.url), "utf8");
  const sourcingForm = readFileSync(new URL("../src/components/purchase-cycle-preflight/SourcingCandidateSelectionForm.tsx", import.meta.url), "utf8");
  assert.match(page, /name="cash"/);
  assert.match(page, /이번 발주에 쓸 총 현금/);
  assert.match(page, /현금을 비우면 전월 매출원가 예산/);
  assert.match(page, /입력한 현금이 있으면 그 금액을 우선 사용/);
  assert.match(page, /현금이 충분해도 엔진 권장수량을 초과하지 않습니다/);
  assert.match(page, /name="sourcing"/);
  assert.match(page, /신규상품 소싱 예산 비율/);
  assert.match(page, /신규상품 소싱 예산을 먼저 분리/);
  assert.match(page, /report\.sourcingBudgetKrw/);
  assert.match(page, /loadSourcingBudgetPlan/);
  assert.match(page, /소싱엔진에서 선택/);
  assert.match(page, /B코드 배정이 끝나면 상품출시 진행관리/);
  assert.match(page, /‘입고 대기’로 생성/);
  assert.match(sourcingForm, /name=\{`storage\.\$\{candidate\.conceptId\}`\}/);
  assert.match(sourcingForm, /소형 수납/);
  assert.match(sourcingForm, /대형 수납/);
  assert.match(page, /sourcingStorageSizeByConceptId/);
  assert.match(page, /expectedSourcingSourceFingerprint/);
  assert.match(page, /sourcingPlan\?\.readyForConfirmation === true/);
  assert.doesNotMatch(page, /name="skus"/);
  assert.doesNotMatch(page, /name="units"/);
  assert.match(page, /maxSkus: ENGINE_MAX_SKUS/);
  assert.match(page, /maxUnitsPerSku: ENGINE_MAX_UNITS_PER_SKU/);
  assert.match(page, /cashLimitKrw/);
  assert.match(page, /권장 → 현금반영/);
  assert.match(page, /name="early"/);
  assert.match(page, /월 마감 전 조기 미리보기/);
  assert.match(page, /기존 Draft와 새 계산 전체 대조/);
  assert.match(page, /replacementAudit\.added/);
  assert.match(page, /<PurchasePreflightForm>/);
  assert.match(form, /event\.preventDefault\(\)/);
  assert.match(form, /useTransition\(\)/);
  assert.match(form, /startTransition\(\(\) =>/);
  assert.match(form, /router\.push\(`\/purchase-cycle-preflight\?\$\{params\.toString\(\)\}`\)/);
  assert.match(form, /onSubmit=\{submit\}/);
  assert.match(form, /disabled=\{pending\}/);
  assert.match(form, /aria-busy=\{pending\}/);
  assert.match(form, /예산·후보 확인 중\.\.\./);
  assert.match(form, /role="status"/);
});

test("operator page presents a simple guided flow and keeps technical evidence collapsed", () => {
  const page = readFileSync(new URL("../src/app/purchase-cycle-preflight/page.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("../src/components/purchase-cycle-preflight/PurchasePreflightForm.tsx", import.meta.url), "utf8");
  const sourcingForm = readFileSync(new URL("../src/components/purchase-cycle-preflight/SourcingCandidateSelectionForm.tsx", import.meta.url), "utf8");
  const finalCalculate = readFileSync(new URL("../src/components/purchase-cycle-preflight/NewProductConfigurationCalculateButton.tsx", import.meta.url), "utf8");
  assert.match(page, /title="다음 발주 준비"/);
  assert.match(page, /1단계/);
  assert.match(page, /발주 준비 단계/);
  assert.match(page, /총현금이 이렇게 나뉩니다/);
  assert.match(page, /지금 확인할 내용/);
  assert.match(page, /기존상품 재발주/);
  assert.match(page, /상세 검증 내역 보기/);
  assert.match(page, /id="new-product-configuration"/);
  assert.match(page, /신규상품 구성/);
  assert.match(page, /id="sourcing-selection"/);
  assert.match(page, /id="manual-sourcing-intake"/);
  assert.match(page, /<ManualProductIntakeForm/);
  assert.match(page, /calculationFormId=\{sourcingPlan \? NEW_PRODUCT_CONFIGURATION_FORM_ID : undefined\}/);
  assert.match(page, /<NewProductConfigurationCalculateButton/);
  assert.doesNotMatch(page, /후보·수납 반영 후 다시 계산/);
  assert.match(page, /3단계 · 계산 결과/);
  assert.match(page, /sourcingPolicyPreparationCodes/);
  assert.match(page, /오류나 사용자 할 일로 세지 않습니다/);
  assert.match(page, /기술 검증 내역/);
  assert.match(page, /소싱엔진 연동 설정을 확인하지 못했습니다/);
  assert.match(page, /confirmation=\{draftReady \? purchaseCycleDraftConfirmation\(report, sourcingPlan\) : ""\}/);
  assert.match(page, /className="min-w-0 space-y-5"/);
  assert.ok(page.indexOf('id="new-product-configuration"') < page.indexOf('id="sourcing-selection"'));
  assert.ok(page.indexOf('id="sourcing-selection"') < page.indexOf('id="manual-sourcing-intake"'));
  assert.ok(page.indexOf('id="manual-sourcing-intake"') < page.indexOf("3단계 · 계산 결과"));
  assert.ok(page.lastIndexOf("<ManualProductIntakeForm") < page.lastIndexOf("<NewProductConfigurationCalculateButton"));
  assert.equal(page.match(/id="manual-sourcing-intake"/g)?.length, 1);
  assert.doesNotMatch(page, /신규상품 소싱 \{report\.sourcingBudgetPercent\}% 배정 미리보기/);
  assert.doesNotMatch(page, /visibleIssues\.length/);
  assert.doesNotMatch(page, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(form, /예산 확인 · 후보 불러오기/);
  assert.match(form, /예산 기준과 현재 후보를 불러옵니다/);
  assert.match(form, /Draft 저장, 1688 주문, 결제는 실행하지 않습니다/);
  assert.match(sourcingForm, /마지막 계산은 두 입력 영역 아래에서 한 번만 실행합니다/);
  assert.match(sourcingForm, /checked=\{checked\}/);
  assert.match(sourcingForm, /name=\{`storage\.\$\{candidate\.conceptId\}`\}/);
  assert.match(sourcingForm, /required/);
  assert.doesNotMatch(sourcingForm, /type="submit"/);
  assert.match(finalCalculate, /new FormData\(configurationForm\)/);
  assert.match(finalCalculate, /작성 중인 수동상품이 있습니다/);
  assert.match(finalCalculate, /신규상품 구성 완료 · 발주안 한 번 계산/);
  assert.match(finalCalculate, /최종 발주안 계산 중/);
});


test("confirmed cost, not cheap planning fallback, determines line amount", () => {
  const input = fixture(); input.priority.rows[0].expectedCost = 1;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.estimatedSpendKrw, 25000);
  assert.equal(report.selected[0].confirmedUnitCostKrw, 5000);
  assert.equal(report.estimatedAllInSpendKrw, 36250);
  assert.ok(report.estimatedAllInSpendKrw <= report.effectiveCashKrw);
});
test("high confirmed cost cannot fit using an unrelated cheaper expectedCost", () => {
  const input = fixture(); input.priority.rows[0].expectedCost = 1;
  input.priority.rows[0].latestConfirmedReceiptCostKrw = 40000;
  blocked(buildPurchaseCyclePreflight(input), "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
test("protected cost greater than receipt cost stays conservative", () => {
  const input = fixture(); input.priority.rows[0].protectedCostKrw = 6000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.estimatedSpendKrw, 30000); assert.equal(report.estimatedAllInSpendKrw, 43500);
});
test("canonical purchase-only verified cost can satisfy Stage 7 without becoming receipt truth", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    hasConfirmedReceiptCost: false,
    latestConfirmedReceiptCostKrw: 0,
    hasVerifiedPurchaseCost: true,
    verifiedPurchaseCostReady: true,
    purchaseCostTrustSource: "LEGACY_VERIFIED_COST_EVIDENCE",
    verifiedPurchaseUnitCostKrw: 5200,
    purchaseProtectedCostKrw: 5400,
    verifiedPurchaseCostAt: "2026-09-01T00:00:00Z",
    purchaseCostEvidenceCount: 1,
  });
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.equal(report.selected[0].verifiedUnitCostKrw, 5400);
  assert.equal(report.selected[0].confirmedUnitCostKrw, 5400);
  assert.equal(report.selected[0].costEvidenceSource, "LEGACY_VERIFIED_COST_EVIDENCE");
  assert.equal(report.estimatedSpendKrw, 27000);
});
test("canonical cost contract rejected by Stage 8 stays blocked after numeric normalization", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    hasConfirmedReceiptCost: false,
    latestConfirmedReceiptCostKrw: 0,
    hasVerifiedPurchaseCost: true,
    verifiedPurchaseCostReady: false,
    purchaseCostTrustSource: "LEGACY_VERIFIED_COST_EVIDENCE",
    verifiedPurchaseUnitCostKrw: 5200,
    purchaseProtectedCostKrw: 5400,
    verifiedPurchaseCostAt: "2026-09-01T00:00:00Z",
    purchaseCostEvidenceCount: 1,
  });
  blocked(buildPurchaseCyclePreflight(input), "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
test("active wholesale sale-price estimate can enter the draft preview without becoming verified purchase cost", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    hasConfirmedReceiptCost: false,
    latestConfirmedReceiptCostKrw: 0,
    hasVerifiedPurchaseCost: false,
    verifiedPurchaseCostReady: false,
    purchaseCostTrustSource: "NONE",
    verifiedPurchaseUnitCostKrw: 0,
    purchaseProtectedCostKrw: 0,
    protectedCostKrw: 0,
    action: "COST_CONFIRMATION_REQUIRED",
    operationallyReady: false,
  });
  input.wholesaleCosts = {
    generatedAt: "2026-10-01T01:59:00.000Z",
    planningContentFingerprint: input.before.planningContentFingerprint,
    contentFingerprint: fp("9"),
    state: "PARTIAL",
    estimatedCount: 1,
    missingCount: 0,
    writesEnabled: false,
    rows: [{
      barcode: "BAA1-1", state: "ESTIMATED", estimatedUnitCostKrw: 6000,
      source: "SHOPLING_ACTIVE_WHOLESALE_SALE_PRICE_ESTIMATE", reason: null, evidence: [],
    }],
  };
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.equal(report.estimatedSpendKrw, 30000);
  assert.equal(report.selected[0].estimatedUnitCostKrw, 6000);
  assert.equal(report.selected[0].verifiedUnitCostKrw, 0);
  assert.equal(report.selected[0].confirmedUnitCostKrw, 0);
  assert.equal(report.selected[0].executionCostVerified, false);
  assert.equal(report.selected[0].costBasis, "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE");
  assert.equal(report.wholesaleEstimatedSelectedCount, 1);
  assert.ok(report.reviewBlockers.includes("WHOLESALE_COST_ESTIMATE_OWNER_REVIEW_REQUIRED"));
  locked(report);
});

test("replacement audit accounts for every old and new line and explains the delta", () => {
  const input = fixture();
  const draftId = "fast-purchase-draft:68b2aa56a8a0ac018141";
  input.options.replaceDraftId = draftId;
  const snapshot = buildPurchaseReplacementDraftSnapshot(
    draftId,
    input.now,
    [
      { barcode: "BAA1-1", name: "기존 공통 상품", quantity: 3 },
      { barcode: "BAA2-1", name: "현재 비추천 상품", quantity: 7 },
    ],
  );
  input.replacementBefore = snapshot;
  input.replacementAfter = { ...snapshot, readAt: "2026-10-01T02:00:01.000Z" };
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.deepEqual(
    {
      previous: report.replacementAudit.previousLineCount,
      selected: report.replacementAudit.selectedLineCount,
      matched: report.replacementAudit.matchedCount,
      added: report.replacementAudit.added.length,
      removed: report.replacementAudit.removed.length,
      changed: report.replacementAudit.quantityChanged.length,
      complete: report.replacementAudit.complete,
    },
    { previous: 2, selected: 1, matched: 1, added: 0, removed: 1, changed: 1, complete: true },
  );
  assert.deepEqual(report.replacementAudit.removed[0].reasons, ["CURRENT_ENGINE_NOT_RECOMMENDED"]);
  assert.deepEqual(report.replacementAudit.quantityChanged[0], {
    barcode: "BAA1-1",
    name: "SIMULATION ONLY",
    previousQuantity: 3,
    selectedQuantity: 5,
  });
});

test("replacement draft drift during calculation fails closed", () => {
  const input = fixture();
  const draftId = "fast-purchase-draft:68b2aa56a8a0ac018141";
  input.options.replaceDraftId = draftId;
  input.replacementBefore = buildPurchaseReplacementDraftSnapshot(
    draftId,
    input.now,
    [{ barcode: "BAA1-1", name: "상품", quantity: 3 }],
  );
  input.replacementAfter = buildPurchaseReplacementDraftSnapshot(
    draftId,
    input.now,
    [{ barcode: "BAA1-1", name: "상품", quantity: 4 }],
  );
  blocked(buildPurchaseCyclePreflight(input), "REPLACEMENT_DRAFT_CHANGED_OR_UNVERIFIED");
});
test("a fresh wholesale observation time does not invalidate an unchanged draft preview", () => {
  const first = fixture();
  Object.assign(first.priority.rows[0], {
    hasConfirmedReceiptCost: false,
    latestConfirmedReceiptCostKrw: 0,
    hasVerifiedPurchaseCost: false,
    verifiedPurchaseCostReady: false,
    purchaseCostTrustSource: "NONE",
    verifiedPurchaseUnitCostKrw: 0,
    purchaseProtectedCostKrw: 0,
    protectedCostKrw: 0,
    action: "COST_CONFIRMATION_REQUIRED",
    operationallyReady: false,
  });
  first.wholesaleCosts = {
    generatedAt: "2026-10-01T01:58:00.000Z",
    planningContentFingerprint: first.before.planningContentFingerprint,
    contentFingerprint: fp("9"),
    state: "PARTIAL",
    estimatedCount: 1,
    missingCount: 0,
    writesEnabled: false,
    rows: [{
      barcode: "BAA1-1", state: "ESTIMATED", estimatedUnitCostKrw: 6000,
      source: "SHOPLING_ACTIVE_WHOLESALE_SALE_PRICE_ESTIMATE", reason: null, evidence: [],
    }],
  };
  const second = structuredClone(first);
  second.wholesaleCosts.generatedAt = "2026-10-01T01:59:00.000Z";

  const a = buildPurchaseCyclePreflight(first);
  const b = buildPurchaseCyclePreflight(second);

  assert.equal(a.previewReady, true);
  assert.equal(b.previewReady, true);
  assert.notEqual(a.selected[0].costEvidenceAt, b.selected[0].costEvidenceAt);
  assert.equal(a.sourceFingerprint, b.sourceFingerprint);
  assert.equal(a.planFingerprint, b.planFingerprint);
});
test("owner-provided approximate cost fills only a missing preview cost and keeps execution locked", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    hasConfirmedReceiptCost: false,
    latestConfirmedReceiptCostKrw: 0,
    hasVerifiedPurchaseCost: false,
    verifiedPurchaseCostReady: false,
    purchaseCostTrustSource: "NONE",
    verifiedPurchaseUnitCostKrw: 0,
    purchaseProtectedCostKrw: 0,
    protectedCostKrw: 0,
    action: "COST_CONFIRMATION_REQUIRED",
    operationallyReady: false,
  });
  input.ownerCosts = buildPurchaseOwnerCostEstimateSnapshot([{
    barcode: "BAA1-1", modelNo: "AAA001", productName: "SIMULATION ONLY",
    estimatedUnitCostKrw: 700, evidenceAt: "2026-10-02T00:00:00+09:00",
    source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null,
  }]);
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.previewReady, true);
  assert.equal(report.estimatedSpendKrw, 3500);
  assert.equal(report.selected[0].costBasis, OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE);
  assert.equal(report.selected[0].costModelNo, "AAA001");
  assert.equal(report.selected[0].verifiedUnitCostKrw, 0);
  assert.equal(report.selected[0].confirmedUnitCostKrw, 0);
  assert.equal(report.selected[0].executionCostVerified, false);
  assert.equal(report.wholesaleEstimatedSelectedCount, 0);
  assert.equal(report.ownerEstimatedSelectedCount, 1);
  assert.ok(report.reviewBlockers.includes("OWNER_COST_ESTIMATE_REVIEW_REQUIRED"));
  locked(report);
});
test("verified cost and active wholesale estimate both outrank an owner estimate", () => {
  const verified = fixture();
  verified.ownerCosts = buildPurchaseOwnerCostEstimateSnapshot([{
    barcode: "BAA1-1", modelNo: "AAA001", productName: "SIMULATION ONLY",
    estimatedUnitCostKrw: 700, evidenceAt: "2026-10-02T00:00:00+09:00",
    source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null,
  }]);
  assert.equal(buildPurchaseCyclePreflight(verified).selected[0].costBasis, "VERIFIED_PURCHASE_COST");

  const wholesale = fixture();
  Object.assign(wholesale.priority.rows[0], {
    hasConfirmedReceiptCost: false, latestConfirmedReceiptCostKrw: 0,
    action: "COST_CONFIRMATION_REQUIRED", operationallyReady: false,
  });
  wholesale.wholesaleCosts = {
    generatedAt: "2026-10-01T01:59:00.000Z",
    planningContentFingerprint: wholesale.before.planningContentFingerprint,
    contentFingerprint: fp("7"), state: "PARTIAL", estimatedCount: 1,
    missingCount: 0, writesEnabled: false,
    rows: [{ barcode: "BAA1-1", state: "ESTIMATED", estimatedUnitCostKrw: 6000, source: "SHOPLING_ACTIVE_WHOLESALE_SALE_PRICE_ESTIMATE", reason: null, evidence: [] }],
  };
  wholesale.ownerCosts = verified.ownerCosts;
  const report = buildPurchaseCyclePreflight(wholesale);
  assert.equal(report.selected[0].costBasis, "SHOPLING_WHOLESALE_SALE_PRICE_ESTIMATE");
  assert.equal(report.selected[0].estimatedUnitCostKrw, 6000);
  assert.equal(report.ownerEstimatedSelectedCount, 0);
});
test("the nine owner estimates retain exact model numbers and similar-product provenance", () => {
  assert.equal(PURCHASE_OWNER_COST_ESTIMATES.rows.length, 9);
  const bge = PURCHASE_OWNER_COST_ESTIMATES.rows.find((row) => row.barcode === "BGE4-1");
  assert.deepEqual(bge, {
    barcode: "BGE4-1", modelNo: "LEGACY-BGE4-1",
    productName: "정글모 사하라캡 뒷목가리개 성인플랩캡", estimatedUnitCostKrw: 2251,
    evidenceAt: "2026-10-02T00:00:00+09:00",
    source: OWNER_SIMILAR_PRODUCT_PURCHASE_COST_ESTIMATE, referenceModelNo: "AAA128",
  });
  assert.equal(PURCHASE_OWNER_COST_ESTIMATES.rows.find((row) => row.barcode === "BGF3-1").modelNo, "AAA048");
  assert.equal(PURCHASE_OWNER_COST_ESTIMATES.rows.find((row) => row.barcode === "BGF4-1").modelNo, "AAA048");
});
test("tampered owner estimate fingerprint is rejected", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    hasConfirmedReceiptCost: false, latestConfirmedReceiptCostKrw: 0,
    action: "COST_CONFIRMATION_REQUIRED", operationallyReady: false,
  });
  input.ownerCosts = buildPurchaseOwnerCostEstimateSnapshot([{
    barcode: "BAA1-1", modelNo: "AAA001", productName: "SIMULATION ONLY",
    estimatedUnitCostKrw: 700, evidenceAt: "2026-10-02T00:00:00+09:00",
    source: OWNER_APPROXIMATE_PURCHASE_COST_ESTIMATE, referenceModelNo: null,
  }]);
  input.ownerCosts.rows[0].estimatedUnitCostKrw = 1;
  const report = buildPurchaseCyclePreflight(input);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  assert.ok(report.reviewBlockers.includes("OWNER_COST_ESTIMATE_INVALID"));
});
test("stale wholesale estimate cannot bypass confirmed cost", () => {
  const input = fixture();
  Object.assign(input.priority.rows[0], {
    hasConfirmedReceiptCost: false, latestConfirmedReceiptCostKrw: 0,
    action: "COST_CONFIRMATION_REQUIRED", operationallyReady: false,
  });
  input.wholesaleCosts = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    planningContentFingerprint: input.before.planningContentFingerprint,
    contentFingerprint: fp("8"), state: "PARTIAL", estimatedCount: 1,
    missingCount: 0, writesEnabled: false,
    rows: [{ barcode: "BAA1-1", state: "ESTIMATED", estimatedUnitCostKrw: 6000, source: "SHOPLING_ACTIVE_WHOLESALE_SALE_PRICE_ESTIMATE", reason: null, evidence: [] }],
  };
  const report = buildPurchaseCyclePreflight(input);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  assert.ok(report.reviewBlockers.includes("WHOLESALE_COST_ESTIMATE_STALE_OR_UNPINNED"));
});
for (const patch of [{ latestConfirmedReceiptCostKrw: Number.MAX_SAFE_INTEGER }, { protectedCostKrw: Infinity }, { protectedCostKrw: -1 }]) {
  test(`unsafe confirmed-cost arithmetic fails closed: ${Object.keys(patch)[0]}:${String(Object.values(patch)[0])}`, () => {
    const input = fixture(); Object.assign(input.priority.rows[0], patch);
    blocked(buildPurchaseCyclePreflight(input), "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  });
}
for (const inventoryGeneratedAt of ["2026-09-30T01:59:00Z", "2026-10-02T01:59:00Z", "", undefined]) {
  test(`fresh wrapper does not launder stale/missing inventory timestamp: ${inventoryGeneratedAt}`, () => {
    const input = fixture(); input.priority.source.inventoryGeneratedAt = inventoryGeneratedAt;
    const report = buildPurchaseCyclePreflight(input);
    blocked(report, "INVENTORY_EVIDENCE_STALE_OR_UNPINNED");
    assert.equal(report.stages.find(row => row.number === 8).state, "BLOCKED");
  });
}
test("missing inventory content fingerprint blocks", () => {
  const input = fixture(); delete input.priority.source.inventoryContentFingerprint;
  blocked(buildPurchaseCyclePreflight(input), "INVENTORY_EVIDENCE_STALE_OR_UNPINNED");
});
test("a changed stock snapshot fingerprint invalidates the preparation", () => {
  const input = fixture(); const a = buildPurchaseCyclePreflight(input);
  input.priority.source.inventoryContentFingerprint = fp("3");
  assert.notEqual(buildPurchaseCyclePreflight(input).planFingerprint, a.planFingerprint);
});
test("a fresh inventory observation time does not invalidate unchanged content", () => {
  const first = fixture(); first.priority.source.inventoryGeneratedAt = "2026-10-01T01:58:00.000Z";
  const second = fixture(); second.priority.source.inventoryGeneratedAt = "2026-10-01T01:59:00.000Z";
  const a = buildPurchaseCyclePreflight(first); const b = buildPurchaseCyclePreflight(second);
  assert.equal(a.previewReady, true); assert.equal(b.previewReady, true);
  assert.equal(a.sourceFingerprint, b.sourceFingerprint);
  assert.equal(a.planFingerprint, b.planFingerprint);
});
test("automatic budget removes recorded cycle spend before freight reserve", () => {
  const input = fixture(); input.options.cashLimitKrw = null; input.spendBefore.recordedSpendKrw = 120000; input.spendAfter.recordedSpendKrw = 120000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.remainingMonthlyCashKrw, 25000); assert.equal(report.effectiveCashKrw, 25000);
  assert.equal(report.effectiveBudgetKrw, Math.floor(25000 / 1.45));
  assert.equal(report.previewReady, false);
  assert.equal(report.selected.length, 0);
  assert.ok(report.excluded[0].reasons.includes("CASH_BUDGET_LIMIT"));
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
  locked(report);
});
test("explicit cash is current available cash and is not reduced by recorded cycle spend", () => {
  const input = fixture(); input.spendBefore.recordedSpendKrw = 120000; input.spendAfter.recordedSpendKrw = 120000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.remainingMonthlyCashKrw, 25000);
  assert.equal(report.effectiveCashKrw, 50000);
  assert.equal(report.effectiveBudgetKrw, Math.floor(50000 / 1.45));
  assert.equal(report.selected[0].quantity, 5);
  assert.equal(report.estimatedSpendKrw, 25000);
});
test("fully spent monthly budget cannot generate another purchase preview", () => {
  const input = fixture(); input.options.cashLimitKrw = null; input.spendBefore.recordedSpendKrw = 145000; input.spendAfter.recordedSpendKrw = 145000;
  const report = buildPurchaseCyclePreflight(input); assert.equal(report.effectiveCashKrw, 0);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
for (const patch of [null, { recordedSpendKrw: -1 }, { cycleMonth: "2026-09" }, { contentFingerprint: "" }, { readAt: "2026-09-01T00:00:00Z" }, { recordedSpendKrw: 1 }]) {
  test(`unreadable or changed cycle spend is never silently zero: ${JSON.stringify(patch)}`, () => {
    const input = fixture(); input.spendAfter = patch === null ? null : { ...input.spendAfter, ...patch };
    blocked(buildPurchaseCyclePreflight(input), "CYCLE_SPEND_CHANGED_OR_UNVERIFIED");
  });
}
for (const patch of [{ grossBudgetKrw: undefined }, { purchaseCostMultiplier: undefined }, { purchaseCostMultiplier: 0.5 }]) {
  test(`missing/invalid gross funding basis blocks: ${Object.keys(patch)[0]}`, () => {
    const input = fixture(); Object.assign(input.priority.source, patch);
    blocked(buildPurchaseCyclePreflight(input), "GROSS_FUNDING_BASIS_UNVERIFIED");
  });
}
test("a spend reader failure propagates without zero-spend fallback", async () => {
  const input = fixture();
  const report = await readPurchaseCyclePreflight(input.options, {
    candidate: async () => input.before, gate: async () => input.gate,
    reconciliation: async () => input.reconciliation, priority: async () => input.priority,
    monthlySpend: async () => { throw new Error("sensitive diagnostic"); },
  }, () => input.now);
  blocked(report, "CYCLE_SPEND_READ_FAILED"); assert.equal(report.recordedCycleSpendKrw, null);
});
