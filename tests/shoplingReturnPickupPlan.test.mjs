import assert from "node:assert/strict";
import test from "node:test";
import { buildShoplingReturnPickupPlan } from "../local-agent/src/shopling-return-pickup-plan.mjs";

function claim(overrides = {}) {
  return {
    claimKey: "C-1",
    claimType: "반품접수",
    claimStatus: "접수",
    orderStatus: "반품접수",
    orderNo: "3493809",
    reason: "단순변심",
    collectedReason: "",
    returnInvoiceNo: "",
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    orderNo: "3493809",
    orderStatus: "발송완료",
    productName: "상품",
    bCode: "BAF3-2",
    quantity: 1,
    unitPrice: 5000,
    paidAmount: 5000,
    courierCode: "018",
    invoiceNo: "5876-2537-5225",
    ...overrides,
  };
}

test("simple-change delivered return becomes review-only without a value decision", () => {
  const plan = buildShoplingReturnPickupPlan({ claims: [claim()], orders: [order()] });
  assert.equal(plan.reviewCandidates.length, 1);
  assert.equal(plan.reviewCandidates[0].valueDecision, "REVIEW_REQUIRED");
  assert.equal(plan.reviewCandidates[0].outboundInvoiceNo, "587625375225");
  assert.equal(plan.pickupSteps.length, 0);
  assert.equal(plan.gates.cjPickupExecutionEnabled, false);
});

test("explicit pickup-worthy decision creates a supervised CJ procedure", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order()],
    valueDecisions: [{ claimKey: "C-1", orderNo: "3493809", decision: "PICKUP_WORTHWHILE" }],
  });
  assert.equal(plan.pickupSteps.length, 1);
  assert.equal(
    plan.pickupSteps[0].status,
    "SUPERVISED_APPROVAL_REQUIRED",
  );
  assert.match(plan.pickupSteps[0].actionKey, /^cj-return-pickup:/);
  assert.equal(plan.pickupSteps[0].returnInvoiceExpectedImmediately, false);
  assert.equal(plan.pickupSteps[0].returnInvoiceReadbackTiming, "NEXT_BUSINESS_DAY");
  assert.deepEqual(plan.pickupSteps[0].immediateSuccessEvidence, [
    "SAVE_DIALOG_CLOSED",
    "ORIGINAL_INVOICE_FIELD_RESET",
    "RESERVATION_GRID_ROW_APPENDED",
  ]);
  assert.equal(plan.gates.cjFormTrainingComplete, true);
  assert.equal(plan.gates.b7ReturnRegistrationTrained, true);
  assert.equal(plan.gates.cjImmediateSaveReadbackTrained, true);
  assert.equal(plan.gates.cjNextBusinessDayTrackingReadbackTrained, false);
  assert.equal(plan.gates.cjSupervisedExecutionEnabled, true);
  assert.equal(plan.gates.cjPickupExecutionEnabled, false);
});

test("no-value decision never creates a pickup operation", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order()],
    valueDecisions: [{ claimKey: "C-1", orderNo: "3493809", decision: "SKIP_NO_VALUE" }],
  });
  assert.equal(plan.reviewCandidates[0].valueDecision, "SKIP_NO_VALUE");
  assert.equal(plan.pickupSteps.length, 0);
});

test("any existing return invoice skips reservation even when its format is unfamiliar", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim({ returnInvoiceNo: "RESERVED-BY-CJ" })],
    orders: [order()],
  });
  assert.deepEqual(plan.skipped, [{
    claimKey: "C-1",
    orderNo: "3493809",
    code: "RETURN_PICKUP_ALREADY_HAS_INVOICE",
  }]);
  assert.equal(plan.reviewCandidates.length, 0);
});

test("all order lines must carry the same exact outbound invoice", () => {
  const missingLineInvoice = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order(), order({ bCode: "BAF3-3", invoiceNo: "" })],
  });
  assert.equal(missingLineInvoice.blocked[0].code, "OUTBOUND_INVOICE_NOT_EXACT");

  const conflictingInvoices = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order(), order({ bCode: "BAF3-3", invoiceNo: "587625375310" })],
  });
  assert.equal(conflictingInvoices.blocked[0].code, "OUTBOUND_INVOICE_NOT_EXACT");
});

test("pickup planning accepts only the documented domestic CJ courier code", () => {
  const wrongCourier = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order({ courierCode: "071" })],
  });
  assert.equal(wrongCourier.blocked[0].code, "OUTBOUND_COURIER_NOT_CJ");
  assert.equal(wrongCourier.reviewCandidates.length, 0);

  const missingCourierOnOneLine = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order(), order({ bCode: "BAF3-3", courierCode: "" })],
  });
  assert.equal(missingCourierOnOneLine.blocked[0].code, "OUTBOUND_COURIER_NOT_CJ");
});

test("duplicate claim keys and multiple return claims for one order fail closed", () => {
  const duplicateKey = buildShoplingReturnPickupPlan({
    claims: [claim(), claim()],
    orders: [order()],
  });
  assert.deepEqual(duplicateKey.blocked.map((item) => item.code), ["DUPLICATE_CLAIM_KEY"]);
  assert.equal(duplicateKey.reviewCandidates.length, 0);

  const duplicateOrder = buildShoplingReturnPickupPlan({
    claims: [claim(), claim({ claimKey: "C-2" })],
    orders: [order()],
  });
  assert.deepEqual(
    duplicateOrder.blocked.map((item) => item.code),
    ["MULTIPLE_RETURN_CLAIMS_FOR_ORDER", "MULTIPLE_RETURN_CLAIMS_FOR_ORDER"],
  );
  assert.equal(duplicateOrder.reviewCandidates.length, 0);
});

test("non-delivered and non-simple-change returns are not actionable", () => {
  const notDelivered = buildShoplingReturnPickupPlan({
    claims: [claim()],
    orders: [order({ orderStatus: "발송대기" })],
  });
  assert.equal(notDelivered.blocked[0].code, "RETURN_ORDER_NOT_DELIVERED");

  const wrongReason = buildShoplingReturnPickupPlan({
    claims: [claim({ reason: "상품불량" })],
    orders: [order()],
  });
  assert.equal(wrongReason.skipped[0].code, "RETURN_REASON_NOT_SIMPLE_CHANGE");

  const misleadingReason = buildShoplingReturnPickupPlan({
    claims: [claim({ reason: "단순변심 아님" })],
    orders: [order()],
  });
  assert.equal(misleadingReason.skipped[0].code, "RETURN_REASON_NOT_SIMPLE_CHANGE");
});

test("an exact one-time operator override permits a non-simple return without relaxing other gates", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim({ reason: "상품불량" })],
    orders: [order()],
    valueDecisions: [{ claimKey: "C-1", orderNo: "3493809", decision: "PICKUP_WORTHWHILE" }],
    operatorOverrides: [{
      claimKey: "C-1",
      orderNo: "3493809",
      override: "ALLOW_ANY_RETURN_REASON_ONCE",
    }],
  });
  assert.equal(plan.pickupSteps.length, 1);
  assert.equal(plan.pickupSteps[0].operatorOverride, "ALLOW_ANY_RETURN_REASON_ONCE");
  assert.equal(plan.reviewCandidates[0].reason, "상품불량");
});

test("an operator override cannot bypass existing return-invoice protection", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim({ reason: "상품불량", returnInvoiceNo: "ALREADY-RESERVED" })],
    orders: [order()],
    valueDecisions: [{ claimKey: "C-1", orderNo: "3493809", decision: "PICKUP_WORTHWHILE" }],
    operatorOverrides: [{
      claimKey: "C-1",
      orderNo: "3493809",
      override: "ALLOW_ANY_RETURN_REASON_ONCE",
    }],
  });
  assert.equal(plan.pickupSteps.length, 0);
  assert.equal(plan.skipped[0].code, "RETURN_PICKUP_ALREADY_HAS_INVOICE");
});

test("exchange cases are surfaced for training but never executed", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim({ claimType: "교환접수", orderStatus: "교환접수" })],
    orders: [order()],
  });
  assert.equal(plan.exchangeCases[0].status, "EXCHANGE_PICKUP_AND_RESHIP_TRAINING_REQUIRED");
  assert.equal(plan.pickupSteps.length, 0);
  assert.equal(plan.gates.exchangeReshipExecutionEnabled, false);
});

test("ambiguous claim type is blocked instead of choosing return or exchange", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim({ claimType: "반품", claimStatus: "교환접수" })],
    orders: [order()],
  });
  assert.equal(plan.blocked[0].code, "CLAIM_TYPE_AMBIGUOUS");
  assert.equal(plan.reviewCandidates.length, 0);
  assert.equal(plan.exchangeCases.length, 0);
});

test("plans exclude recipient contact fields even when supplied by an upstream source", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [{ ...claim(), customerName: "PII-CLAIM-NAME" }],
    orders: [{
      ...order(),
      recipientName: "PII-ORDER-NAME",
      recipientPhone: "PII-PHONE",
      recipientAddress: "PII-ADDRESS",
    }],
  });
  assert.doesNotMatch(JSON.stringify(plan), /PII-/);
  assert.deepEqual(plan.privacy, {
    recipientNameStored: false,
    phoneStored: false,
    addressStored: false,
  });
});

test("value decisions must be unique and use an explicit allowed value", () => {
  assert.throws(() => buildShoplingReturnPickupPlan({
    valueDecisions: [
      { claimKey: "C-1", orderNo: "3493809", decision: "PICKUP_WORTHWHILE" },
      { claimKey: "C-1", orderNo: "3493809", decision: "SKIP_NO_VALUE" },
    ],
  }), { code: "RETURN_PICKUP_VALUE_DECISION_INVALID" });
});

test("a stale value decision for a non-actionable claim is explicitly blocked", () => {
  const plan = buildShoplingReturnPickupPlan({
    claims: [claim({ reason: "상품불량" })],
    orders: [order()],
    valueDecisions: [{
      claimKey: "C-1",
      orderNo: "3493809",
      decision: "PICKUP_WORTHWHILE",
    }],
  });
  assert.equal(plan.pickupSteps.length, 0);
  assert.equal(plan.blocked.at(-1).code, "VALUE_DECISION_TARGET_NOT_ACTIONABLE");
});
