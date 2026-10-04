import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  preparePurchaseCycleDraft,
  purchaseCycleDraftConfirmation,
  purchaseCycleDraftPreflightOptions,
} from "../src/lib/purchaseCyclePreflightDraftCore.ts";
import { assertDraftCanBeRegenerated } from "../src/lib/purchaseCycleDraftRegenerationCore.ts";

const fp = (digit) => `sha256:${digit.repeat(64)}`;

function report() {
  return {
    targetDate: "2026-10-01",
    replacementDraftId: null,
    replacementAudit: null,
    targetCycleMonth: "2026-10",
    cashLimitKrw: null,
    sourcingBudgetPercent: 0,
    sourcingBudgetKrw: 0,
    sourceFingerprint: fp("a"),
    planFingerprint: fp("b"),
    previewReady: true,
    blockers: [],
    candidateCount: 1,
    accountedCandidateCount: 1,
    candidateCoverageComplete: true,
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
    effectiveBudgetKrw: 2_667_268,
    businessWritesEnabled: false,
    approvalEnabled: false,
    actualPurchaseExecuted: false,
    scheduledExecution: false,
  };
}

function request(value = report()) {
  return {
    targetDate: value.targetDate,
    cashLimitKrw: value.cashLimitKrw,
    sourcingBudgetPercent: value.sourcingBudgetPercent,
    allowOpenBudgetPreview: false,
    expectedSourceFingerprint: value.sourceFingerprint,
    expectedPlanFingerprint: value.planFingerprint,
    confirmation: purchaseCycleDraftConfirmation(value),
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

test("draft recheck preserves and pins the sourcing budget share", () => {
  const value = report();
  value.sourcingBudgetPercent = 20;
  value.sourcingBudgetKrw = 200_000;
  const input = request(value);
  assert.equal(purchaseCycleDraftPreflightOptions(input).sourcingBudgetPercent, 20);
  assert.match(input.confirmation, /SOURCING20PCT/);
  assert.doesNotThrow(() => preparePurchaseCycleDraft(value, input));
  input.sourcingBudgetPercent = 15;
  assert.throws(
    () => preparePurchaseCycleDraft(value, input),
    /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
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

for (const mutate of [
  (value) => { value.expectedSourceFingerprint = fp("c"); },
  (value) => { value.expectedPlanFingerprint = fp("c"); },
  (value) => { value.targetDate = "2026-10-02"; },
]) {
  test("changed source or target date is rejected", () => {
    const value = report();
    const input = request(value);
    mutate(input);
    assert.throws(
      () => preparePurchaseCycleDraft(value, input),
      /PURCHASE_CYCLE_DRAFT_SOURCE_CHANGED/,
    );
  });
}

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
  assert.match(service, /allowAdoptExistingReservedDraft: false/);
  assert.match(storage, /status: "RESERVED"/);
  assert.match(storage, /externalOrderExecuted: false/);
  assert.match(storage, /object\(line\.latestPayload\)\.cycleMonth/);
  assert.match(regeneration, /status: "CANCELLED"/);
  assert.match(regeneration, /status: "RESERVED"/);
  assert.match(regeneration, /externalOrderExecuted: false/);
  assert.doesNotMatch(regeneration, /status: "ORDERED"/);
  assert.doesNotMatch(regeneration, /resolution=ignore-duplicates/);
  assert.match(regeneration, /inserted\.length !== operations\.length/);
  assert.doesNotMatch(service, /ORDERED|1688|payment/i);
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /allowOpenBudgetPreview/);
  assert.match(actions, /cashLimitKrw/);
  assert.match(actions, /sourcingBudgetPercent/);
  assert.match(actions, /신규상품 소싱/);
  assert.match(actions, /1688 주문·결제는 실행하지 않습니다/);
});
