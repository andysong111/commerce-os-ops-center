import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPurchaseCyclePreflight, readPurchaseCyclePreflight,
  validPurchaseTargetDate, samePurchaseCandidatePin,
} from "../src/lib/purchaseCyclePreflightCore.ts";

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
test("a partial verified SKU can be isolated without requiring all stocktakes", () => {
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
test("missing budget is not zero nor an inferred permission", () => {
  const input = fixture(); input.options.cashLimitKrw = null;
  blocked(buildPurchaseCyclePreflight(input), "OWNER_CASH_LIMIT_REQUIRED");
});
test("cash and monthly budgets cap the selection; MOQ quantity is never resized", () => {
  const input = fixture(); input.priority.source.budgetKrw = 20000;
  const report = buildPurchaseCyclePreflight(input);
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS"); assert.equal(report.effectiveBudgetKrw, 20000);
  assert.deepEqual(report.excluded[0].reasons, ["CASH_BUDGET_LIMIT"]);
  assert.equal(input.priority.rows[0].recommendedQty, 5);
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
for (const mutate of [i => i.options.cashLimitKrw++, i => i.options.maxSkus++, i => i.priority.rows[0].openCommitment++, i => i.priority.rows[0].expectedCost++, i => i.priority.rows[0].inventoryQuantity++, i => i.priority.rows[0].latestConfirmedReceiptCostKrw++]) {
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
for (const options of [{ targetDate: "2026-02-30" }, { targetDate: "2026-13-01" }, { cashLimitKrw: 0 }, { cashLimitKrw: -1 }, { cashLimitKrw: "50000" }, { cashLimitKrw: Number.MAX_SAFE_INTEGER + 1 }, { maxSkus: 0 }, { maxSkus: 11 }, { maxUnitsPerSku: 0 }]) {
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
  input.priority.rows[0].latestConfirmedReceiptCostKrw = 20000;
  blocked(buildPurchaseCyclePreflight(input), "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
test("protected cost greater than receipt cost stays conservative", () => {
  const input = fixture(); input.priority.rows[0].protectedCostKrw = 6000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.estimatedSpendKrw, 30000); assert.equal(report.estimatedAllInSpendKrw, 43500);
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
test("recorded cycle spend is removed before freight reserve and cash clamp", () => {
  const input = fixture(); input.spendBefore.recordedSpendKrw = 120000; input.spendAfter.recordedSpendKrw = 120000;
  const report = buildPurchaseCyclePreflight(input);
  assert.equal(report.remainingMonthlyCashKrw, 25000); assert.equal(report.effectiveCashKrw, 25000);
  assert.equal(report.effectiveBudgetKrw, Math.floor(25000 / 1.45));
  blocked(report, "NO_VERIFIED_CANDIDATE_WITHIN_LIMITS");
});
test("fully spent monthly budget cannot generate another purchase preview", () => {
  const input = fixture(); input.spendBefore.recordedSpendKrw = 145000; input.spendAfter.recordedSpendKrw = 145000;
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
