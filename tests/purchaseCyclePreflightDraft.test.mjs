import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  preparePurchaseCycleDraft,
  purchaseCycleDraftConfirmation,
} from "../src/lib/purchaseCyclePreflightDraftCore.ts";

const fp = (digit) => `sha256:${digit.repeat(64)}`;

function report() {
  return {
    targetDate: "2026-10-01",
    targetCycleMonth: "2026-10",
    sourceFingerprint: fp("a"),
    planFingerprint: fp("b"),
    previewReady: true,
    blockers: [],
    selected: [
      {
        barcode: "BAC1-1",
        name: "토끼 발세척매트",
        quantity: 38,
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
    expectedSourceFingerprint: value.sourceFingerprint,
    expectedPlanFingerprint: value.planFingerprint,
    confirmation: purchaseCycleDraftConfirmation(value),
  };
}

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

for (const mutate of [
  (value) => { value.previewReady = false; },
  (value) => { value.blockers = ["SOURCE_CHANGED_OR_MISSING"]; },
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
  const [route, service, storage, actions] = await Promise.all([
    readFile("src/app/api/purchase-cycle/preflight-draft/route.ts", "utf8"),
    readFile("src/lib/purchaseCyclePreflightDraft.ts", "utf8"),
    readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
    readFile(
      "src/components/purchase-cycle-preflight/PurchaseCycleDraftActions.tsx",
      "utf8",
    ),
  ]);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(service, /maxSkus: 100/);
  assert.match(service, /maxUnitsPerSku: 9_999/);
  assert.match(service, /allowAdoptExistingReservedDraft: false/);
  assert.match(storage, /status: "RESERVED"/);
  assert.match(storage, /externalOrderExecuted: false/);
  assert.match(storage, /object\(line\.latestPayload\)\.cycleMonth/);
  assert.doesNotMatch(service, /ORDERED|1688|payment/i);
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /1688 주문·결제는 실행하지 않습니다/);
});
