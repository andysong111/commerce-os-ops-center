import { loadInternalChinaPurchaseCycleHandoff } from "@/lib/internalChinaPurchaseCycleHandoff";
import { loadInternalChinaMonthlyPurchaseClose } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import { loadInternalChinaReceiptFollowups } from "@/lib/internalChinaReceiptFollowup";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { buildPurchaseCycleClosureReport, followingPurchaseCycleMonth } from "@/lib/purchaseCycleClosureCore";
import { hasHistoricalOrderSettlementEvidence } from "@/lib/purchaseCycleHistoricalOrderClose";
import { loadPurchaseCycleStockReport } from "@/lib/purchaseCycleStockReport";

export type PurchaseCycleReadSource =
  | "handoff"
  | "close"
  | "purchase"
  | "followups"
  | "stock";

export class PurchaseCycleReadError extends Error {
  readonly source: PurchaseCycleReadSource;

  constructor(source: PurchaseCycleReadSource, cause: unknown) {
    super(`PURCHASE_CYCLE_READ_FAILED:${source}`, { cause });
    this.name = "PurchaseCycleReadError";
    this.source = source;
  }
}

async function sourceRead<T>(
  source: PurchaseCycleReadSource,
  pending: Promise<T>,
) {
  try {
    return await pending;
  } catch (error) {
    throw new PurchaseCycleReadError(source, error);
  }
}

export function purchaseCycleReadFailureSource(error: unknown) {
  return error instanceof PurchaseCycleReadError ? error.source : "unknown";
}

export async function loadPurchaseCycleClosure(cycleMonth: string, refreshSales = false) {
  const followingMonth = followingPurchaseCycleMonth(cycleMonth);
  const [handoff, close, purchase, followups, stock] = await Promise.all([
    sourceRead("handoff", loadInternalChinaPurchaseCycleHandoff(followingMonth)),
    sourceRead("close", loadInternalChinaMonthlyPurchaseClose(cycleMonth)),
    sourceRead("purchase", loadInternalChinaMonthlyPurchaseSummary(cycleMonth)),
    sourceRead("followups", loadInternalChinaReceiptFollowups(cycleMonth)),
    sourceRead("stock", loadPurchaseCycleStockReport({ refreshSales })),
  ]);
  const historicalOrderSettled = !close && hasHistoricalOrderSettlementEvidence({
    cycleMonth,
    currentCycleMonth: seoulCalendarMonth(),
    draftCount: handoff.draftCount,
    orderedQuantity: handoff.orderedQuantity,
    receivedQuantity: handoff.receivedQuantity,
    openQuantity: handoff.openQuantity,
    receiptState: handoff.receiptState,
    landedCostState: handoff.landedCostState,
    fundingState: handoff.fundingState,
    warnings: handoff.warnings,
  });
  return buildPurchaseCycleClosureReport({
    cycleMonth, orderClosed: Boolean(close) || historicalOrderSettled, orderCount: purchase?.orderCount ?? 0,
    unassignedLineCount: purchase?.unassignedLineCount ?? 0,
    orderedQuantity: handoff.orderedQuantity, receivedQuantity: handoff.receivedQuantity,
    cancelledQuantity: handoff.cancelledQuantity, openQuantity: handoff.openQuantity,
    receiptState: handoff.receiptState,
    landedCostState: handoff.landedCostState, fundingState: handoff.fundingState,
    approvedPriceCheckPending: Boolean(handoff.priceVerification.fingerprint) && handoff.priceVerification.state !== "COMPLETE",
    followups, stock, warnings: handoff.warnings,
  });
}
