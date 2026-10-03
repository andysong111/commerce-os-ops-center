import { normalizeTrackingNumber } from "./shopling-unshipped-reconciliation.mjs";

const DELIVERED_STATUSES = new Set(["발송완료", "주문출고완료"]);
const VALUE_DECISIONS = new Set(["PICKUP_WORTHWHILE", "SKIP_NO_VALUE"]);
const OPERATOR_REASON_OVERRIDE = "ALLOW_ANY_RETURN_REASON_ONCE";
const CJ_DOMESTIC_COURIER_CODE = "018";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compact(value) {
  return clean(value).replace(/\s+/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function countsBy(values) {
  const counts = new Map();
  for (const value of values.map(clean).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function sumLineAmounts(rows) {
  return rows.reduce((total, row) => {
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    const paidAmount = Number(row.paidAmount);
    if (Number.isFinite(unitPrice) && unitPrice >= 0 && Number.isFinite(quantity) && quantity > 0) {
      return total + unitPrice * quantity;
    }
    return total + (Number.isFinite(paidAmount) && paidAmount >= 0 ? paidAmount : 0);
  }, 0);
}

function isReturnClaim(claim) {
  return [claim.claimType, claim.claimStatus, claim.orderStatus]
    .some((value) => compact(value).includes("반품"));
}

function isExchangeClaim(claim) {
  return [claim.claimType, claim.claimStatus, claim.orderStatus]
    .some((value) => compact(value).includes("교환"));
}

function isSimpleChange(claim) {
  return [claim.reason, claim.collectedReason]
    .some((value) => compact(value) === "단순변심");
}

function decisionMap(decisions = []) {
  const result = new Map();
  for (const item of decisions) {
    const claimKey = clean(item?.claimKey);
    const orderNo = clean(item?.orderNo);
    const decision = clean(item?.decision);
    const identity = `${claimKey}:${orderNo}`;
    if (!claimKey || !orderNo || !VALUE_DECISIONS.has(decision) || result.has(identity)) {
      const error = new Error("Return pickup value decisions must be unique and explicit.");
      error.code = "RETURN_PICKUP_VALUE_DECISION_INVALID";
      throw error;
    }
    result.set(identity, decision);
  }
  return result;
}

function operatorOverrideMap(overrides = []) {
  const result = new Map();
  for (const item of overrides) {
    const claimKey = clean(item?.claimKey);
    const orderNo = clean(item?.orderNo);
    const override = clean(item?.override);
    const identity = `${claimKey}:${orderNo}`;
    if (!claimKey || !orderNo || override !== OPERATOR_REASON_OVERRIDE || result.has(identity)) {
      const error = new Error("Return pickup operator overrides must be unique and exact.");
      error.code = "RETURN_PICKUP_OPERATOR_OVERRIDE_INVALID";
      throw error;
    }
    result.set(identity, override);
  }
  return result;
}

function safeOrderSummary(orderNo, rows) {
  return {
    orderNo,
    lineCount: rows.length,
    productNames: unique(rows.map((row) => clean(row.productName))).slice(0, 20),
    bCodes: unique(rows.map((row) => clean(row.bCode).toUpperCase())).slice(0, 20),
    totalQuantity: rows.reduce((total, row) => total + Math.max(0, Number(row.quantity) || 0), 0),
    estimatedItemAmount: sumLineAmounts(rows),
  };
}

export function buildShoplingReturnPickupPlan(input = {}) {
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const decisions = decisionMap(input.valueDecisions);
  const operatorOverrides = operatorOverrideMap(input.operatorOverrides);
  const actionableClaims = claims.filter((claim) => isReturnClaim(claim) || isExchangeClaim(claim));
  const claimKeyCounts = countsBy(actionableClaims.map((claim) => claim.claimKey));
  const returnOrderCounts = countsBy(
    actionableClaims.filter(isReturnClaim).map((claim) => claim.orderNo),
  );
  const ordersByNumber = new Map();
  for (const row of orders) {
    const orderNo = clean(row.orderNo);
    if (!orderNo) continue;
    const current = ordersByNumber.get(orderNo) || [];
    current.push(row);
    ordersByNumber.set(orderNo, current);
  }

  const reviewCandidates = [];
  const pickupSteps = [];
  const skipped = [];
  const blocked = [];
  const exchangeCases = [];
  const blockedClaimKeys = new Set();

  for (const claim of claims) {
    const claimKey = clean(claim.claimKey);
    const orderNo = clean(claim.orderNo);
    if (!claimKey || !orderNo) {
      blocked.push({ claimKey, orderNo, code: "CLAIM_IDENTITY_INCOMPLETE" });
      continue;
    }
    if ((claimKeyCounts.get(claimKey) || 0) > 1) {
      if (!blockedClaimKeys.has(claimKey)) {
        blocked.push({ claimKey, orderNo, code: "DUPLICATE_CLAIM_KEY" });
        blockedClaimKeys.add(claimKey);
      }
      continue;
    }

    if (isReturnClaim(claim) && isExchangeClaim(claim)) {
      blocked.push({ claimKey, orderNo, code: "CLAIM_TYPE_AMBIGUOUS" });
      continue;
    }

    if (isExchangeClaim(claim)) {
      exchangeCases.push({
        claimKey,
        orderNo,
        status: "EXCHANGE_PICKUP_AND_RESHIP_TRAINING_REQUIRED",
      });
      continue;
    }
    if (!isReturnClaim(claim)) continue;
    const decisionIdentity = `${claimKey}:${orderNo}`;
    const operatorOverride = operatorOverrides.get(decisionIdentity) || "";
    if ((returnOrderCounts.get(orderNo) || 0) > 1) {
      if (!blockedClaimKeys.has(claimKey)) {
        blocked.push({ claimKey, orderNo, code: "MULTIPLE_RETURN_CLAIMS_FOR_ORDER" });
        blockedClaimKeys.add(claimKey);
      }
      continue;
    }
    if (!isSimpleChange(claim) && operatorOverride !== OPERATOR_REASON_OVERRIDE) {
      skipped.push({ claimKey, orderNo, code: "RETURN_REASON_NOT_SIMPLE_CHANGE" });
      continue;
    }
    if (clean(claim.returnInvoiceNo)) {
      skipped.push({ claimKey, orderNo, code: "RETURN_PICKUP_ALREADY_HAS_INVOICE" });
      continue;
    }

    const orderRows = ordersByNumber.get(orderNo) || [];
    if (!orderRows.length) {
      blocked.push({ claimKey, orderNo, code: "RETURN_ORDER_NOT_FOUND" });
      continue;
    }
    if (orderRows.some((row) => !DELIVERED_STATUSES.has(clean(row.orderStatus)))) {
      blocked.push({ claimKey, orderNo, code: "RETURN_ORDER_NOT_DELIVERED" });
      continue;
    }
    if (orderRows.some((row) => clean(row.courierCode) !== CJ_DOMESTIC_COURIER_CODE)) {
      blocked.push({ claimKey, orderNo, code: "OUTBOUND_COURIER_NOT_CJ" });
      continue;
    }
    const normalizedInvoices = orderRows.map((row) => normalizeTrackingNumber(row.invoiceNo));
    const invoices = unique(normalizedInvoices);
    if (normalizedInvoices.some((invoiceNo) => !invoiceNo) || invoices.length !== 1) {
      blocked.push({ claimKey, orderNo, code: "OUTBOUND_INVOICE_NOT_EXACT" });
      continue;
    }

    const summary = safeOrderSummary(orderNo, orderRows);
    const decision = decisions.get(decisionIdentity) || "REVIEW_REQUIRED";
    const candidate = {
      claimKey,
      ...summary,
      outboundInvoiceNo: invoices[0],
      reason: isSimpleChange(claim) ? "단순변심" : clean(claim.reason || claim.collectedReason),
      valueDecision: decision,
      operatorOverride,
      b7ReadbackRequired: true,
    };
    reviewCandidates.push(candidate);

    if (decision === "PICKUP_WORTHWHILE") {
      pickupSteps.push({
        actionKey: `cj-return-pickup:${orderNo}:${invoices[0]}`,
        channel: "CJ_LOIS_UI",
        claimKey,
        orderNo,
        outboundInvoiceNo: invoices[0],
        operatorOverride,
        procedure: [
          "B7_FILTER_ONE_MONTH_DELIVERED_RETURN_CLAIMS",
          "VERIFY_B7_EXACT_ORDER_AND_OUTBOUND_INVOICE",
          "OPEN_CJ_RETURN_RESERVATION_BY_OUTBOUND_INVOICE",
          "VERIFY_ORIGINAL_SHIPMENT_IDENTITY",
          "SUBMIT_RETURN_PICKUP_AFTER_OPERATOR_APPROVAL",
          "VERIFY_SAVE_DIALOG_CLOSED_FORM_RESET_AND_ROW_APPENDED",
          "READ_BACK_RETURN_INVOICE_NEXT_BUSINESS_DAY",
        ],
        immediateSuccessEvidence: [
          "SAVE_DIALOG_CLOSED",
          "ORIGINAL_INVOICE_FIELD_RESET",
          "RESERVATION_GRID_ROW_APPENDED",
        ],
        returnInvoiceExpectedImmediately: false,
        returnInvoiceReadbackTiming: "NEXT_BUSINESS_DAY",
        status: "SUPERVISED_APPROVAL_REQUIRED",
      });
    }
  }

  const actionableDecisionIdentities = new Set(
    reviewCandidates.map((candidate) => `${candidate.claimKey}:${candidate.orderNo}`),
  );
  for (const identity of decisions.keys()) {
    if (actionableDecisionIdentities.has(identity)) continue;
    const [claimKey, orderNo] = identity.split(":", 2);
    blocked.push({ claimKey, orderNo, code: "VALUE_DECISION_TARGET_NOT_ACTIONABLE" });
  }
  for (const identity of operatorOverrides.keys()) {
    if (actionableDecisionIdentities.has(identity)) continue;
    const [claimKey, orderNo] = identity.split(":", 2);
    blocked.push({ claimKey, orderNo, code: "OPERATOR_OVERRIDE_TARGET_NOT_ACTIONABLE" });
  }

  return {
    schemaVersion: 1,
    mode: "PLAN_ONLY",
    reviewCandidates,
    pickupSteps,
    exchangeCases,
    skipped,
    blocked,
    gates: {
      b7ReadbackRequired: true,
      b7ReturnRegistrationTrained: true,
      cjFormTrainingComplete: true,
      cjImmediateSaveReadbackTrained: true,
      cjNextBusinessDayTrackingReadbackTrained: false,
      cjSupervisedExecutionEnabled: true,
      cjPickupExecutionEnabled: false,
      exchangeReshipExecutionEnabled: false,
    },
    privacy: {
      recipientNameStored: false,
      phoneStored: false,
      addressStored: false,
    },
  };
}
