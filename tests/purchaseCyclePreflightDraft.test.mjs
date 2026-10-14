import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  preparePurchaseCycleDraft,
  purchaseCycleDraftConfirmation,
  purchaseCycleDraftPlannedTotals,
  purchaseCycleDraftPreflightOptions,
  sourcingBudgetDecisionFingerprint,
} from "../src/lib/purchaseCyclePreflightDraftCore.ts";
import { assertDraftCanBeRegenerated } from "../src/lib/purchaseCycleDraftRegenerationCore.ts";

const fp = (digit) => `sha256:${digit.repeat(64)}`;

function report() {
  return {
    targetDate: "2026-10-01",
    replacementDraftId: null,
    operatorExcludedBarcodes: [],
    replacementAudit: null,
    targetCycleMonth: "2026-10",
    cashLimitKrw: null,
    sourcingBudgetPercent: 0,
    sourcingBudgetKrw: 0,
    sourcingBudgetReturnKrw: 0,
    sourceFingerprint: fp("a"),
    planFingerprint: fp("b"),
    previewReady: true,
    blockers: [],
    candidateCount: 1,
    accountedCandidateCount: 1,
    candidateCoverageComplete: true,
    preservedReplacementLines: [],
    selected: [
      {
        barcode: "BAC1-1",
        name: "토끼 발세척매트",
        quantity: 38,
        originalRecommendedQuantity: 38,
        cashAdjusted: false,
        cashflowTier: "AUTOMATIC",
        priorityScore: 90,
        costEvidenceSource: "SOURCE_ORDER_VERIFIED_COST_EVIDENCE",
        inventoryQuantity: 0,
        openCommitment: 0,
      },
    ],
    estimatedSpendKrw: 86_678,
    estimatedAllInSpendKrw: 125_684,
    effectiveCashKrw: 1_000_000,
    effectiveBudgetKrw: 2_667_268,
    businessWritesEnabled: false,
    approvalEnabled: false,
    actualPurchaseExecuted: false,
    scheduledExecution: false,
  };
}

function sourcingPlan(value) {
  return {
    targetCycleMonth: value.targetCycleMonth,
    totalCashKrw: value.effectiveCashKrw,
    sourcingBudgetPercent: value.sourcingBudgetPercent,
    sourcingBudgetKrw: value.sourcingBudgetKrw,
    readyForConfirmation: true,
    blockers: [],
    sourceFingerprint: fp("c"),
    planFingerprint: fp("d"),
    allocation: { selected: [{ conceptId: "new-1" }], estimatedSpendKrw: 150_000 },
  };
}

function request(value = report(), plan = null) {
  return {
    targetDate: value.targetDate,
    cashLimitKrw: value.cashLimitKrw,
    sourcingBudgetPercent: value.sourcingBudgetPercent,
    allowOpenBudgetPreview: false,
    expectedSourceFingerprint: value.sourceFingerprint,
    expectedPlanFingerprint: value.planFingerprint,
    expectedSourcingSourceFingerprint: plan?.sourceFingerprint ?? null,
    expectedSourcingPlanFingerprint: plan?.planFingerprint ?? null,
    expectedSourcingDecisionFingerprint: plan
      ? sourcingBudgetDecisionFingerprint(plan)
      : null,
    confirmation: purchaseCycleDraftConfirmation(value, plan),
    excludedBarcodes: value.operatorExcludedBarcodes,
  };
}

test("draft recheck preserves the preview early-budget option", () => {
  const regular = purchaseCycleDraftPreflightOptions(request());
  assert.equal(regular.allowOpenBudgetPreview, false);
  assert.equal(regular.cashLimitKrw, null);
  assert.equal(regular.sourcingBudgetPercent, 0);
  assert.equal(regular.maxSkus, 100);
  assert.equal(regular.maxUnitsPerSku, 9_999);

  const early = purchaseCycleDraftPreflightOptions({
    ...request(),
    allowOpenBudgetPreview: true,
  });
  assert.equal(early.allowOpenBudgetPreview, true);
});

test("draft recheck preserves and pins the operator cash cap", () => {
  const value = report();
  value.cashLimitKrw = 800_000;
  const input = request(value);
  assert.equal(purchaseCycleDraftPreflightOptions(input).cashLimitKrw, 800_000);
  assert.match(input.confirmation, /CASH800000/);
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input));
  input.cashLimitKrw = 700_000;
  assert.throws(
    () => preparePurchaseCycleDraft(value, input),
    /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
  );
});

test("draft recheck preserves operator exclusions and rejects exclusion drift", () => {
  const value = report();
  value.replacementDraftId = "fast-purchase-draft:1234567890abcdef1234";
  value.operatorExcludedBarcodes = ["BAA1-1"];
  value.replacementAudit = {
    previousLineCount: 1,
    selectedLineCount: 1,
    matchedCount: 0,
    added: [{ barcode: "BAC1-1", name: "토끼 발세척매트", quantity: 38 }],
    removed: [{ barcode: "BAA1-1", name: "제외 상품", quantity: 5, reasons: ["OPERATOR_DRAFT_EXCLUSION"] }],
    quantityChanged: [],
    complete: true,
  };
  const input = { ...request(value), replaceDraftId: value.replacementDraftId };
  assert.deepEqual(purchaseCycleDraftPreflightOptions(input).excludedBarcodes, ["BAA1-1"]);
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input));
  input.excludedBarcodes = ["BAA2-1"];
  assert.throws(
    () => preparePurchaseCycleDraft(value, input),
    /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
  );
});

test("draft recheck preserves and pins the sourcing budget share", () => {
  const value = report();
  value.sourcingBudgetPercent = 20;
  value.sourcingBudgetKrw = 200_000;
  value.sourcingBudgetReturnKrw = 50_000;
  const plan = sourcingPlan(value);
  const input = request(value, plan);
  assert.equal(purchaseCycleDraftPreflightOptions(input).sourcingBudgetPercent, 20);
  assert.match(input.confirmation, /SOURCING20PCT/);
  assert.match(input.confirmation, /NEWSOURCE1SKU_LIMIT200000KRW/);
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input, plan));
  input.sourcingBudgetPercent = 15;
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, plan),
    /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
  );
});

test("manual sourcing preference is pinned and cannot change between preview and save", () => {
  const value = report();
  value.sourcingBudgetPercent = 20;
  value.sourcingBudgetKrw = 200_000;
  const plan = sourcingPlan(value);
  plan.preferredConceptIds = ["concept-2"];
  const input = { ...request(value, plan), preferredSourcingConceptIds: ["concept-2"] };
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input, plan));
  input.preferredSourcingConceptIds = ["concept-3"];
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, plan),
    /PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY/,
  );
});

test("manual sourcing pins accept response reordering but reject changed values", () => {
  const value = report();
  value.sourcingBudgetPercent = 20;
  value.sourcingBudgetKrw = 200_000;
  const plan = sourcingPlan(value);
  plan.preferredConceptIds = ["concept-2", "concept-1"];
  plan.storageSizeByConceptId = { "concept-2": "L", "concept-1": "S" };
  plan.variantSelections = [
    { storageSize: "L", variantKey: "variant-2", conceptId: "concept-2" },
    { storageSize: "S", variantKey: "variant-1", conceptId: "concept-1" },
  ];
  const input = {
    ...request(value, plan),
    preferredSourcingConceptIds: ["concept-1", "concept-2"],
    sourcingStorageSizeByConceptId: { "concept-1": "S", "concept-2": "L" },
    sourcingVariantSelections: [
      { conceptId: "concept-1", variantKey: "variant-1", storageSize: "S" },
      { conceptId: "concept-2", variantKey: "variant-2", storageSize: "L" },
    ],
  };

  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input, plan));

  input.sourcingStorageSizeByConceptId["concept-2"] = "S";
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, plan),
    /PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY/,
  );
  input.sourcingStorageSizeByConceptId["concept-2"] = "L";
  input.sourcingVariantSelections[1].variantKey = "variant-changed";
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, plan),
    /PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY/,
  );
});

test("a positive sourcing share cannot save without the exact ready sourcing plan", () => {
  const value = report();
  value.sourcingBudgetPercent = 20;
  value.sourcingBudgetKrw = 200_000;
  const plan = sourcingPlan(value);
  const input = request(value, plan);
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, null),
    /PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY/,
  );
  plan.blockers = ["SOURCING_PERCENT_POLICY_MISMATCH"];
  plan.readyForConfirmation = false;
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, plan),
    /PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY/,
  );
});

test("exact preflight pins become one RESERVED draft line without claiming stockout", () => {
  const value = report();
  const prepared = preparePurchaseCycleDraft(value, request(value));
  assert.equal(prepared.cycleMonth, "2026-10");
  assert.equal(prepared.sourceFingerprint, value.planFingerprint);
  assert.deepEqual(
    prepared.lines.map((line) => ({
      barcode: line.barcode,
      quantity: line.plannedQuantity,
      stockSense: line.stockSense,
    })),
    [{ barcode: "BAC1-1", quantity: 38, stockSense: "LOW" }],
  );
});

test("a refreshed diagnostic source fingerprint is accepted when the exact plan is unchanged", () => {
  const value = report();
  const input = request(value);
  input.expectedSourceFingerprint = fp("c");
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input));
});

for (const mutate of [
  (value) => { value.expectedPlanFingerprint = fp("c"); },
  (value) => { value.targetDate = "2026-10-02"; },
]) {
  test("changed purchase decision or target date is rejected", () => {
    const value = report();
    const input = request(value);
    mutate(input);
    assert.throws(
      () => preparePurchaseCycleDraft(value, input),
      /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
    );
  });
}

test("sourcing approval survives FX-only cost drift but rejects product or quantity drift", () => {
  const value = report();
  value.sourcingBudgetPercent = 20;
  value.sourcingBudgetKrw = 200_000;
  value.sourcingBudgetReturnKrw = 50_000;
  const plan = sourcingPlan(value);
  plan.allocation.selected = [{
    conceptId: "new-1",
    quantity: 10,
    selectedVariants: [{
      variantKey: "gray",
      saleOption: "단품 그레이",
      chinaOption: "深空灰",
      storageSize: "S",
      quantity: 10,
      estimatedCostKrw: 31_000,
    }],
  }];
  const input = request(value, plan);

  const fxRefresh = structuredClone(plan);
  fxRefresh.sourceFingerprint = fp("e");
  fxRefresh.planFingerprint = fp("f");
  fxRefresh.allocation.estimatedSpendKrw += 39;
  fxRefresh.allocation.selected[0].selectedVariants[0].estimatedCostKrw += 39;
  assert.equal(
    sourcingBudgetDecisionFingerprint(fxRefresh),
    sourcingBudgetDecisionFingerprint(plan),
  );
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input, fxRefresh));
  assert.equal(
    purchaseCycleDraftConfirmation(value, fxRefresh),
    purchaseCycleDraftConfirmation(value, plan),
  );

  const changedQuantity = structuredClone(fxRefresh);
  changedQuantity.allocation.selected[0].selectedVariants[0].quantity = 11;
  assert.throws(
    () => preparePurchaseCycleDraft(value, input, changedQuantity),
    /PURCHASE_CYCLE_SOURCING_PLAN_NOT_READY/,
  );
});

test("exact line count and amount confirmation is mandatory", () => {
  const value = report();
  const input = request(value);
  input.confirmation = "CREATE_PURCHASE_DRAFT_2026-10_10SKU_1KRW";
  assert.throws(
    () => preparePurchaseCycleDraft(value, input),
    /PURCHASE_CYCLE_DRAFT_CONFIRMATION_REQUIRED/,
  );
});

test("replacement preview is pinned to the exact existing draft", () => {
  const value = report();
  value.replacementDraftId = "fast-purchase-draft:68b2aa56a8a0ac018141";
  value.replacementAudit = {
    previousLineCount: 2,
    selectedLineCount: 1,
    matchedCount: 1,
    added: [],
    removed: [{ barcode: "BAA2-1", name: "이전 상품", quantity: 2, reasons: ["CURRENT_ENGINE_NOT_RECOMMENDED"] }],
    quantityChanged: [{ barcode: "BAC1-1", name: "토끼 발세척매트", previousQuantity: 30, selectedQuantity: 38 }],
    complete: true,
  };
  const input = request(value);
  input.replaceDraftId = value.replacementDraftId;
  input.confirmation = purchaseCycleDraftConfirmation(value);
  assert.match(input.confirmation, /REGENERATE_PURCHASE_DRAFT/);
  assert.match(input.confirmation, /ADD0_REMOVE1_CHANGE1/);
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input));
  input.replaceDraftId = "fast-purchase-draft:11111111111111111111";
  assert.throws(
    () => preparePurchaseCycleDraft(value, input),
    /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
  );
});

test("replacement preparation carries confirmed sourcing lines into the regenerated draft", () => {
  const value = report();
  value.replacementDraftId = "fast-purchase-draft:68b2aa56a8a0ac018141";
  value.preservedReplacementLines = [{
    barcode: "BAA3-1",
    name: "직접 추가 신규소싱 상품",
    quantity: 10,
    preserveOnRegeneration: true,
  }];
  value.replacementAudit = {
    previousLineCount: 2,
    selectedLineCount: 2,
    matchedCount: 2,
    added: [],
    removed: [],
    quantityChanged: [],
    complete: true,
  };
  const input = request(value);
  input.replaceDraftId = value.replacementDraftId;
  input.confirmation = purchaseCycleDraftConfirmation(value);

  const prepared = preparePurchaseCycleDraft(value, input);

  assert.deepEqual(
    prepared.lines.map((line) => [line.barcode, line.plannedQuantity]),
    [["BAC1-1", 38], ["BAA3-1", 10]],
  );
  assert.match(input.confirmation, /_2SKU_/);
});

test("replacement totals include reorder, preserved sourcing, and newly selected sourcing lines", () => {
  const value = report();
  value.preservedReplacementLines = [{
    barcode: "BAA3-1",
    name: "기존 신규소싱 상품",
    quantity: 10,
    preserveOnRegeneration: true,
  }];
  const plan = sourcingPlan(value);
  plan.allocation.selected = [{
    conceptId: "new-1",
    selectedVariants: [{ variantKey: "gray", quantity: 12 }],
  }, {
    conceptId: "new-2",
    selectedVariants: [{ variantKey: "small", quantity: 3 }, { variantKey: "large", quantity: 5 }],
  }];

  assert.deepEqual(purchaseCycleDraftPlannedTotals(value, plan), {
    existingReorderCount: 1,
    existingReorderQuantity: 38,
    preservedSourcingCount: 1,
    preservedSourcingQuantity: 10,
    newSourcingCount: 3,
    newSourcingQuantity: 20,
    finalLineCount: 5,
    finalQuantity: 68,
  });
});

test("replacement cannot be saved without a complete old-to-new coverage audit", () => {
  const value = report();
  value.replacementDraftId = "fast-purchase-draft:68b2aa56a8a0ac018141";
  assert.throws(
    () => purchaseCycleDraftConfirmation(value),
    /PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED/,
  );
  const input = {
    targetDate: value.targetDate,
    allowOpenBudgetPreview: false,
    expectedSourceFingerprint: value.sourceFingerprint,
    expectedPlanFingerprint: value.planFingerprint,
    replaceDraftId: value.replacementDraftId,
    confirmation: "REGENERATE_PURCHASE_DRAFT",
  };
  assert.throws(
    () => preparePurchaseCycleDraft(value, input),
    /PURCHASE_DRAFT_REPLACEMENT_AUDIT_REQUIRED/,
  );
});

const commitment = (patch = {}) => ({
  sourceRunId: "fast-purchase-draft:68b2aa56a8a0ac018141",
  barcode: "BAC1-1",
  openQuantity: 38,
  status: "RESERVED",
  orderedQuantity: 0,
  receivedQuantity: 0,
  ...patch,
});

test("only one unchanged RESERVED draft can be regenerated", () => {
  const expected = "fast-purchase-draft:68b2aa56a8a0ac018141";
  assert.equal(
    assertDraftCanBeRegenerated([commitment()], expected).length,
    1,
  );
  assert.throws(
    () =>
      assertDraftCanBeRegenerated(
        [commitment({ orderedQuantity: 1, status: "ORDERED" })],
        expected,
      ),
    /PURCHASE_DRAFT_REGENERATION_ALREADY_PROGRESSING/,
  );
  assert.throws(
    () =>
      assertDraftCanBeRegenerated(
        [commitment(), commitment({ sourceRunId: "fast-purchase-draft:11111111111111111111", barcode: "BAC1-2" })],
        expected,
      ),
    /PURCHASE_DRAFT_REGENERATION_ACTIVE_DRAFT_CHANGED/,
  );
});

for (const mutate of [
  (value) => { value.previewReady = false; },
  (value) => { value.blockers = ["SOURCE_CHANGED_OR_MISSING"]; },
  (value) => { value.candidateCoverageComplete = false; value.accountedCandidateCount = 0; },
  (value) => { value.selected = []; },
  (value) => { value.estimatedSpendKrw = value.effectiveBudgetKrw + 1; },
]) {
  test("blocked or over-budget reports cannot create a draft", () => {
    const value = report();
    mutate(value);
    assert.throws(
      () => preparePurchaseCycleDraft(value, request(value)),
      /PURCHASE_CYCLE_DRAFT_NOT_READY/,
    );
  });
}

test("route is same-origin, fingerprint-pinned, and never executes an external order", async () => {
  const [route, service, core, storage, regeneration, actions] = await Promise.all([
    readFile("src/app/api/purchase-cycle/preflight-draft/route.ts", "utf8"),
    readFile("src/lib/purchaseCyclePreflightDraft.ts", "utf8"),
    readFile("src/lib/purchaseCyclePreflightDraftCore.ts", "utf8"),
    readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
    readFile("src/lib/purchaseCycleDraftRegeneration.ts", "utf8"),
    readFile(
      "src/components/purchase-cycle-preflight/PurchaseCycleDraftActions.tsx",
      "utf8",
    ),
  ]);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(core, /maxSkus: 100/);
  assert.match(core, /maxUnitsPerSku: 9_999/);
  assert.match(service, /purchaseCycleDraftPreflightOptions\(request\)/);
  assert.match(service, /loadSourcingBudgetPlan/);
  assert.match(service, /returnableSourcingBudgetKrw/);
  assert.match(service, /sourcingBudgetReturnKrw/);
  assert.match(service, /confirmSourcingBudgetPlan/);
  assert.match(service, /complete: sourcing\?\.ok !== false/);
  assert.match(service, /allowAdoptExistingReservedDraft: false/);
  assert.match(storage, /status: "RESERVED"/);
  assert.match(storage, /externalOrderExecuted: false/);
  assert.match(storage, /object\(line\.latestPayload\)\.cycleMonth/);
  assert.match(regeneration, /status: "CANCELLED"/);
  assert.match(regeneration, /status: "RESERVED"/);
  assert.match(regeneration, /preservedSourcingBarcodes/);
  assert.match(regeneration, /previous\.sourceLineId/);
  assert.match(regeneration, /\.\.\.preservedPayload/);
  assert.match(regeneration, /externalOrderExecuted: false/);
  assert.doesNotMatch(regeneration, /status: "ORDERED"/);
  assert.doesNotMatch(regeneration, /resolution=ignore-duplicates/);
  assert.match(regeneration, /inserted\.length !== operations\.length/);
  assert.doesNotMatch(service, /ORDERED|1688|payment/i);
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /allowOpenBudgetPreview/);
  assert.match(actions, /cashLimitKrw/);
  assert.match(actions, /sourcingBudgetPercent/);
  assert.match(actions, /preferredSourcingConceptIds/);
  assert.match(actions, /신규상품 소싱/);
  assert.match(actions, /기존상품.*유지 신규소싱.*새 신규소싱.*최종/);
  assert.match(actions, /최종 \$\{selectedCount\}개 SKU · 총 \$\{totalQuantity\.toLocaleString\("ko-KR"\)\}개/);
  assert.doesNotMatch(actions, /payload\.draft\?\.lineCount \?\? selectedCount/);
  assert.match(actions, /expectedSourcingSourceFingerprint/);
  assert.match(actions, /expectedSourcingDecisionFingerprint/);
  assert.match(route, /status: result\.complete \? result\.draft\.duplicate \? 200 : 201 : 207/);
  assert.match(actions, /1688 주문·결제는 실행하지 않습니다/);
});
