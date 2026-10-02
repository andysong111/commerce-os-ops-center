import assert from "node:assert/strict";
import test from "node:test";
import { buildShoplingPostPackingPlan } from "../local-agent/src/shopling-post-packing-plan.mjs";

function reconciliation(overrides = {}) {
  return {
    proposedActions: {
      invoiceDeletionCandidates: [{
        invoiceNo: "5876-2537-5310",
        shoplingOrderNos: ["3493798", "3493797", "3493796", "3493798"],
      }],
      stockoutCandidates: [{ bCode: "bbc6-3" }],
    },
    blockedActions: [],
    ...overrides,
  };
}

test("post-packing plan keeps one combined invoice linked to every Shopling order", () => {
  const plan = buildShoplingPostPackingPlan(reconciliation());
  assert.equal(plan.invoiceDeletionSteps.length, 1);
  assert.deepEqual(plan.invoiceDeletionSteps[0].shoplingOrderNos, ["3493798", "3493797", "3493796"]);
  assert.equal(plan.invoiceDeletionSteps[0].expectedOrderCount, 3);
  assert.equal(plan.invoiceDeletionSteps[0].channel, "SHOPLING_B12_UI");
  assert.deepEqual(plan.invoiceDeletionSteps[0].procedure, [
    "FILTER_EXACT_INVOICE",
    "VERIFY_MATCHED_ORDER_SET",
    "SELECT_MATCHED_B12_ORDERS",
    "CLICK_DELETE_INVOICE_NUMBER",
    "VERIFY_AND_ACCEPT_DELETE_CONFIRMATION",
    "READ_BACK_INVOICE_EMPTY_AND_COURIER_PENDING",
  ]);
});

test("marketplace transmission remains blocked until B12 deletion readback", () => {
  const plan = buildShoplingPostPackingPlan(reconciliation());
  assert.equal(plan.gates.readyForApproval, true);
  assert.equal(plan.gates.b12DeletionExecutionEnabled, false);
  assert.equal(plan.gates.marketplaceInvoiceTransmissionEnabled, false);
  assert.equal(plan.gates.marketplaceTransmissionBlockReason, "B12_INVOICE_DELETION_READBACK_REQUIRED");
});

test("stockout action is normalized but remains approval-gated", () => {
  const plan = buildShoplingPostPackingPlan(reconciliation());
  assert.deepEqual(plan.stockoutSteps[0], {
    actionKey: "stockout-bcode:BBC6-3",
    channel: "SHOPLING_PRODUCT_API",
    bCode: "BBC6-3",
    procedure: [
      "READ_EXACT_OPTION",
      "VERIFY_CURRENT_STATUS",
      "SET_OPTION_SOLD_OUT",
      "READ_BACK_SOLD_OUT",
    ],
    status: "WAITING_FOR_OPERATOR_APPROVAL",
  });
  assert.equal(plan.gates.stockoutExecutionEnabled, false);
});

test("any unresolved evidence blocks operator approval", () => {
  const plan = buildShoplingPostPackingPlan(reconciliation({
    blockedActions: [{ code: "DUPLICATE_LABEL_PHOTO" }],
  }));
  assert.equal(plan.gates.readyForApproval, false);
});
