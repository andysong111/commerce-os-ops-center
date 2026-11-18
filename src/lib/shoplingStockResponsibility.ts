type ShoplingTerminalOutcome = "SUCCEEDED" | "FAILED" | "UNCERTAIN";

export type ShoplingStockResponsibilityResult = Record<string, unknown> & {
  jobId?: string;
  job?: Record<string, unknown> | null;
  outcome?: ShoplingTerminalOutcome;
  message?: string;
  evidence?: unknown;
};

export type ShoplingStockResultDetail = {
  code: string;
  stage: string;
  marketFailureCount: number;
  marketSuccessCount: number;
  marketTotalCount: number;
  responsibilityReceiptAccepted: boolean;
};

const RESULT_FAILURE_CODE = "SHOPLING_HF87_RESULT_TABLE_FAILURE";
const NORMALIZATION_CODE =
  "SHOPLING_SUBMIT_RECEIPT_WITH_MARKET_FAILURE_ADVISORY_HF97";
const COMMITTED_RECEIPT_CODES = new Set([
  "SHOPLING_HF84_MODE_THEN_TARGET_COMMITTED",
  "SHOPLING_HF92_EXACT_POPUP_DIRECT_COMMITTED",
  "SHOPLING_HF96_REARM_RECONCILED_AND_COMMITTED",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function exactReceiptForResult(
  input: ShoplingStockResponsibilityResult,
  evidence: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const history = Array.isArray(evidence.history) ? evidence.history : [];
  const committed = history
    .map(object)
    .find((entry) => COMMITTED_RECEIPT_CODES.has(text(entry.code)));
  if (!committed) return null;

  const receipt = object(committed.lastMileReceipt);
  const receiptKey = text(receipt.receiptKey);
  const ownerKey = text(receipt.assignmentOwnerKey);
  const goodsKeyQuery = text(receipt.goodsKeyQuery);
  const goodsKeys = goodsKeyQuery.split(",").map((value) => value.trim());
  const popupTabId = integer(receipt.popupTabId);
  const popupFrameId = integer(receipt.popupFrameId);
  const resultPopupTabId = integer(result.exactOwnerA21PopupTabId);
  const resultTabId = integer(evidence.resultTabId);
  const job = object(input.job);
  const jobId = text(input.jobId || job.jobId);
  const productKind = text(receipt.productKind);
  const desiredStatus = text(receipt.desiredStatus);
  const expectedProductKind = text(job.productKind || input.productKind);
  const expectedDesiredStatus = text(job.desiredStatus || input.desiredStatus);

  const exactIdentity =
    receiptKey.length > 0 &&
    receiptKey === ownerKey &&
    (!jobId || receiptKey.startsWith(`${jobId}:`)) &&
    goodsKeys.length > 0 &&
    goodsKeys.every((value) => /^\d+$/.test(value)) &&
    new Set(goodsKeys).size === goodsKeys.length &&
    (productKind === "OPTION" || productKind === "SINGLE") &&
    (!expectedProductKind || productKind === expectedProductKind) &&
    (desiredStatus === "SOLD_OUT" || desiredStatus === "ON_SALE") &&
    (!expectedDesiredStatus || desiredStatus === expectedDesiredStatus) &&
    popupTabId !== null &&
    popupFrameId !== null &&
    popupFrameId >= 0 &&
    resultPopupTabId === popupTabId &&
    resultTabId === popupTabId;

  const submitReceipt =
    receipt.shoplingSubmitInvoked === true &&
    receipt.submitConfirmSeen === true &&
    receipt.submitControlVerified === true &&
    receipt.topChecked === true &&
    receipt.targetChecked === true;

  return exactIdentity && submitReceipt ? receipt : null;
}

/**
 * Commerce OS owns the exact Shopling submit handoff, not every marketplace row.
 * A balanced terminal result table with marketplace failures is accepted only
 * when it is bound to the original, exact popup submit receipt.
 */
export function normalizeShoplingStockResponsibilityResult<
  T extends ShoplingStockResponsibilityResult,
>(input: T): T {
  if (input.outcome !== "UNCERTAIN") return input;

  const evidence = object(input.evidence);
  const result = object(evidence.result);
  const totalCount = integer(result.totalCount);
  const successCount = integer(result.successCount);
  const failureCount = integer(result.failureCount);
  const balancedTerminalResult =
    text(evidence.code) === RESULT_FAILURE_CODE &&
    result.terminal === true &&
    result.resultHeading === true &&
    result.rowsBalanced === true &&
    totalCount !== null &&
    successCount !== null &&
    failureCount !== null &&
    totalCount > 0 &&
    successCount >= 0 &&
    failureCount > 0 &&
    successCount + failureCount === totalCount;

  if (!balancedTerminalResult) return input;
  if (!exactReceiptForResult(input, evidence, result)) return input;

  const rawMessage = text(input.message);
  return {
    ...input,
    outcome: "SUCCEEDED",
    message: `Shopling 전송 접수 완료 · 결과표 ${totalCount}건 중 마켓 실패 ${failureCount}건은 Shopling에서 별도 확인 필요`,
    evidence: {
      ...evidence,
      rawOutcome: "UNCERTAIN",
      rawMessage,
      marketFailuresAdvisory: true,
      marketFailureCount: failureCount,
      marketSuccessCount: successCount,
      marketTotalCount: totalCount,
      responsibilityReceiptAccepted: true,
      outcomeNormalization: NORMALIZATION_CODE,
    },
  } as T;
}

export function shoplingStockResultDetail(
  input: ShoplingStockResponsibilityResult,
): ShoplingStockResultDetail {
  const evidence = object(input.evidence);
  return {
    code: text(evidence.code),
    stage: text(evidence.stage),
    marketFailureCount: Math.max(0, Number(evidence.marketFailureCount) || 0),
    marketSuccessCount: Math.max(0, Number(evidence.marketSuccessCount) || 0),
    marketTotalCount: Math.max(0, Number(evidence.marketTotalCount) || 0),
    responsibilityReceiptAccepted:
      evidence.responsibilityReceiptAccepted === true,
  };
}

