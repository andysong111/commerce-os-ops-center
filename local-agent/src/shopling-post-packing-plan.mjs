import { normalizeBCode, normalizeTrackingNumber } from "./shopling-unshipped-reconciliation.mjs";

function unique(values) {
  return [...new Set(values)];
}

export function buildShoplingPostPackingPlan(review) {
  const reconciliation = review?.reconciliation || review;
  const invoiceCandidates = reconciliation?.proposedActions?.invoiceDeletionCandidates;
  const stockoutCandidates = reconciliation?.proposedActions?.stockoutCandidates;
  if (!Array.isArray(invoiceCandidates) || !Array.isArray(stockoutCandidates)) {
    const error = new Error("A valid unshipped reconciliation is required.");
    error.code = "UNSHIPPED_RECONCILIATION_INVALID";
    throw error;
  }

  const blockedActions = Array.isArray(reconciliation.blockedActions)
    ? reconciliation.blockedActions
    : [];
  const invoiceDeletionSteps = invoiceCandidates.map((candidate) => {
    const invoiceNo = normalizeTrackingNumber(candidate.invoiceNo);
    const shoplingOrderNos = unique((candidate.shoplingOrderNos || []).map(String).filter(Boolean));
    if (!invoiceNo || !shoplingOrderNos.length) {
      const error = new Error("Invoice deletion candidate identity is incomplete.");
      error.code = "INVOICE_DELETION_IDENTITY_INCOMPLETE";
      throw error;
    }
    return {
      actionKey: `b12-delete-invoice:${invoiceNo}`,
      channel: "SHOPLING_B12_UI",
      invoiceNo,
      shoplingOrderNos,
      expectedOrderCount: shoplingOrderNos.length,
      procedure: [
        "FILTER_EXACT_INVOICE",
        "VERIFY_MATCHED_ORDER_SET",
        "SELECT_MATCHED_B12_ORDERS",
        "CLICK_DELETE_INVOICE_NUMBER",
        "VERIFY_AND_ACCEPT_DELETE_CONFIRMATION",
        "READ_BACK_INVOICE_EMPTY_AND_COURIER_PENDING",
      ],
      status: "WAITING_FOR_OPERATOR_APPROVAL",
    };
  });

  const stockoutSteps = stockoutCandidates.map((candidate) => {
    const bCode = normalizeBCode(candidate.bCode);
    if (!bCode) {
      const error = new Error("Stockout candidate B-code is missing.");
      error.code = "STOCKOUT_IDENTITY_INCOMPLETE";
      throw error;
    }
    return {
      actionKey: `stockout-bcode:${bCode}`,
      channel: "SHOPLING_PRODUCT_API",
      bCode,
      procedure: [
        "READ_EXACT_OPTION",
        "VERIFY_CURRENT_STATUS",
        "SET_OPTION_SOLD_OUT",
        "READ_BACK_SOLD_OUT",
      ],
      status: "WAITING_FOR_OPERATOR_APPROVAL",
    };
  });

  const readyForApproval = invoiceDeletionSteps.length > 0 && blockedActions.length === 0;
  return {
    schemaVersion: 1,
    mode: "PLAN_ONLY",
    invoiceDeletionSteps,
    stockoutSteps,
    gates: {
      readyForApproval,
      b12DeletionExecutionEnabled: false,
      stockoutExecutionEnabled: false,
      marketplaceInvoiceTransmissionEnabled: false,
      marketplaceTransmissionBlockReason: invoiceDeletionSteps.length
        ? "B12_INVOICE_DELETION_READBACK_REQUIRED"
        : "NO_VERIFIED_UNSHIPPED_INVOICE_SET",
    },
    blockedActions,
  };
}
