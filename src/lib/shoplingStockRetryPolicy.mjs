export const MAX_SHOPLING_STOCK_ATTEMPTS = 3;

export function isSafeShoplingStockRetry(result) {
  if (result?.outcome !== "FAILED") return false;
  const evidence = result.evidence && typeof result.evidence === "object" ? result.evidence : {};
  const history = Array.isArray(evidence.history) ? evidence.history : [];
  const observed = [
    evidence, evidence.result, evidence.receipt, evidence.lastMileReceipt,
    ...history, ...history.map((entry) => entry?.lastMileReceipt),
  ];
  if (observed.some((item) => item && (
    item.browserMutationStarted === true || item.shoplingSubmitInvoked === true || item.shoplingTransmissionStarted === true
    || item.submitConfirmSeen === true || item.shoplingDispatchAccepted === true
    || item.responsibilityReceiptAccepted === true || item.externalWriteConfirmed === true
    || item.popupObserved === true || Number(item.popupTabId) > 0
    || Number(item.exactOwnerA21PopupTabId) > 0 || Number(item.acceptedPopupTabId) > 0
    || item.stage === "A21_POPUP" || item.stage === "WAIT_A21_RESULT"
    || item.stockStateGroupReceipts?.length > 0 || item.completedBatchKeys?.length > 0
  ))) return false;

  const code = String(evidence.code || "");
  if (evidence.retrySafe === true && code === "SHOPLING_HF72_FIRST_GROUP_DISPATCH_FAILED") return true;
  if (evidence.retrySafe === true && evidence.popupObserved === false && code === "HF93_SELECTION_DIALOG_CAUGHT") return true;
  if (evidence.browserMutationStarted !== false) return false;

  // Permission or state validation needs operator input even if nothing was sent.
  if (/LOGIN|AUTH|SESSION|TRANSITION_BLOCKED|MISMATCH|INVALID|PLAN_FAILED/i.test(code)) return false;
  if (evidence.retrySafe === true) return true;
  if (code !== "SHOPLING_STOCK_STATE_COALESCED_API_FAILED" || evidence.appliedApiCount !== 0) return false;
  return /\bHTTP[\s_:]+(?:429|502|503|504)\b/i.test(String(result.message || ""));
}
