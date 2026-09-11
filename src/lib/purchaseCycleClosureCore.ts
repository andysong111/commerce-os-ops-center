import type { InventoryStockControlReport } from "./inventoryStockControl";
import type { InternalChinaReceiptFollowupStatus } from "./internalChinaReceiptFollowup";

export type CycleStageState = "VERIFIED" | "PENDING" | "NOT_STARTED";
export type PurchaseCycleClosureInput = {
  cycleMonth: string; orderClosed: boolean; orderCount: number; unassignedLineCount: number;
  orderedQuantity: number; receivedQuantity: number; openQuantity: number;
  receiptState: string; landedCostState: string; fundingState: string;
  approvedPriceCheckPending: boolean; followups: InternalChinaReceiptFollowupStatus[];
  stock: InventoryStockControlReport; warnings: string[];
};
export type PurchaseCycleClosureReport = {
  generatedAt: string; cycleMonth: string;
  state: "BLOCKED" | "NEEDS_ACTION" | "READY_FOR_NEXT_CALCULATION" | "NO_ORDER_CLOSED";
  nextAction: "RECHECK" | "OPEN_WORKSPACE" | "RETRY_RECEIPT_FOLLOWUP" | "REFRESH_STOCK_EVIDENCE" | "OPEN_STOCK_CONTROL" | "OPEN_PRICE_REVIEW" | "OPEN_NEXT_CALCULATION";
  actionLabel: string; message: string; receiptId: string | null;
  receivedQuantity: number; openQuantity: number; affectedSkuCount: number;
  verifiedReceiptCount: number; pendingReceiptCount: number; missingBaselineCount: number;
  stages: Array<{ id: string; label: string; state: CycleStageState }>;
  warnings: string[]; followups: InternalChinaReceiptFollowupStatus[];
  actualPurchaseExecuted: false;
};
export function validPurchaseCycleMonth(value: unknown): value is string {
  return typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}
export function followingPurchaseCycleMonth(value: string) {
  if (!validPurchaseCycleMonth(value)) throw new Error("PURCHASE_CYCLE_MONTH_INVALID");
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}
export function buildPurchaseCycleClosureReport(input: PurchaseCycleClosureInput): PurchaseCycleClosureReport {
  if (!validPurchaseCycleMonth(input.cycleMonth)) throw new Error("PURCHASE_CYCLE_MONTH_INVALID");
  const warnings = [...input.warnings];
  for (const count of [input.orderCount, input.unassignedLineCount, input.orderedQuantity, input.receivedQuantity, input.openQuantity]) {
    if (!Number.isSafeInteger(count) || count < 0) warnings.push("발주·입고 수량 원장을 확인하지 못했습니다.");
  }
  const receiptIds = new Set(input.followups.map((row) => row.receiptId));
  const scopedReceipts = receiptIds.size === input.followups.length && input.followups.every((row) => row.cycleMonth === input.cycleMonth && Number.isSafeInteger(row.receivedQuantity) && row.receivedQuantity > 0 && row.lineCount === row.barcodes.length && row.lineCount > 0);
  const evidencedQuantity = input.followups.reduce((total, row) => total + row.receivedQuantity, 0);
  if (!scopedReceipts || evidencedQuantity !== input.receivedQuantity) warnings.push("입고 원장 합계와 후속 반영 검증 범위가 일치하지 않습니다.");
  const codes = [...new Set(input.followups.flatMap((row) => row.barcodes))];
  const stockRows = codes.map((code) => input.stock.rows.filter((row) => row.barcode === code));
  const missingBaselineCount = stockRows.filter((rows) => rows.length !== 1).length;
  const quantitiesVerified = codes.length > 0 && missingBaselineCount === 0 && input.stock.state === "READY" && stockRows.every(([row]) => row.salesCoverageReady && Number.isSafeInteger(row.exactInventoryQuantity) && row.exactInventoryQuantity >= 0);
  const saleVerified = quantitiesVerified && stockRows.every(([row]) => !row.syncNeeded && !row.syncBlocked && row.latestSyncOutcome === "SUCCEEDED");
  const verifiedReceiptCount = input.followups.filter((row) => row.state === "VERIFIED").length;
  const pending = input.followups.filter((row) => row.state !== "VERIFIED");
  const receiptVerified = input.receiptState === "COMPLETE" && input.orderedQuantity > 0 && input.openQuantity === 0 && input.receivedQuantity >= input.orderedQuantity;
  const masterVerified = input.followups.length > 0 && pending.length === 0 && scopedReceipts && evidencedQuantity === input.receivedQuantity;
  const stages: PurchaseCycleClosureReport["stages"] = [
    { id: "order", label: "주문·발주마감", state: input.orderClosed ? "VERIFIED" : "PENDING" },
    { id: "receipt", label: "입고확정", state: receiptVerified ? "VERIFIED" : input.receivedQuantity > 0 ? "PENDING" : "NOT_STARTED" },
    { id: "master", label: "상품마스터 원가 반영", state: masterVerified ? "VERIFIED" : "PENDING" },
    { id: "inventory", label: "현재 정확재고", state: quantitiesVerified ? "VERIFIED" : "PENDING" },
    { id: "sale", label: "품절·판매재개 반영", state: saleVerified ? "VERIFIED" : "PENDING" },
    { id: "cost", label: "최종 원가 마감", state: input.landedCostState === "COMPLETE" ? "VERIFIED" : "PENDING" },
    { id: "funding", label: "자금 마감", state: input.fundingState === "COMPLETE" ? "VERIFIED" : "PENDING" },
    { id: "next", label: "다음 발주계산", state: "NOT_STARTED" },
  ];
  const report: PurchaseCycleClosureReport = {
    generatedAt: new Date().toISOString(), cycleMonth: input.cycleMonth,
    state: "NEEDS_ACTION", nextAction: "OPEN_WORKSPACE", actionLabel: "아래 발주·입고 단계 확인",
    message: "저장된 입고와 실제 후속 반영을 구분해 확인합니다.", receiptId: null,
    receivedQuantity: input.receivedQuantity, openQuantity: input.openQuantity,
    affectedSkuCount: codes.length, verifiedReceiptCount, pendingReceiptCount: pending.length,
    missingBaselineCount, stages, warnings: [...new Set(warnings)], followups: input.followups,
    actualPurchaseExecuted: false,
  };
  if (warnings.length) return { ...report, state: "BLOCKED", nextAction: "RECHECK", actionLabel: "원장 다시 확인", message: "일부 근거를 읽지 못해 완료로 표시하지 않았습니다." };
  if (input.unassignedLineCount > 0) return { ...report, message: `실주문 ${input.unassignedLineCount}개 품목의 B코드 연결을 먼저 확인하세요.` };
  if (!input.orderCount && !input.orderedQuantity && !input.receivedQuantity && !input.followups.length && input.orderClosed) return {
    ...report, state: "NO_ORDER_CLOSED", nextAction: "OPEN_NEXT_CALCULATION", actionLabel: "다음 발주계산으로 이동",
    message: "실제 주문 없이 마감한 달입니다. 입고·판매재개를 실행한 것으로 간주하지 않습니다.",
    stages: stages.map((stage) => stage.id === "order" ? stage : { ...stage, state: "NOT_STARTED" }),
  };
  if (!input.orderClosed) return { ...report, message: "이번 달 주문을 마쳤는지 확인하고 발주 마감을 진행하세요." };
  if (!receiptVerified) return { ...report, message: "입고되지 않은 수량 또는 입고 근거가 남아 있습니다. 실제 도착 수량만 확정하세요." };
  if (!masterVerified) {
    const retry = pending.find((row) => row.canRetry);
    return { ...report, nextAction: retry ? "RETRY_RECEIPT_FOLLOWUP" : "OPEN_WORKSPACE", actionLabel: retry ? "입고 후속 반영만 재시도" : "입고 원가·상품 연결 확인", receiptId: retry?.receiptId ?? null, message: "입고수량은 다시 추가하지 않습니다. 상품마스터에 실제 저장된 원가를 확인한 뒤 다음 단계로 넘어갑니다." };
  }
  if (missingBaselineCount) return { ...report, nextAction: "OPEN_STOCK_CONTROL", actionLabel: "재고 기준점 확인", message: `${missingBaselineCount}개 품목은 확인된 재고 기준점이 없습니다. 입고수량을 전체 실재고로 임의 대체하지 않습니다.` };
  if (!quantitiesVerified) return { ...report, nextAction: "REFRESH_STOCK_EVIDENCE", actionLabel: "판매범위 최신화 후 재확인", message: "기준점 이후 최신 판매범위를 확인해야 정확재고를 다음 발주계산에 사용할 수 있습니다." };
  if (!saleVerified) return { ...report, nextAction: "OPEN_STOCK_CONTROL", actionLabel: "품절·판매재개 반영 확인", message: "계산된 판매상태와 실제 전송 성공 기록을 확인하세요. 요청 접수만으로 전송 완료 처리하지 않습니다." };
  if (input.landedCostState !== "COMPLETE") return { ...report, message: "모든 발주 묶음의 배송대행 실제비용·최종 원가를 마감하세요." };
  if (input.approvedPriceCheckPending) return { ...report, nextAction: "OPEN_PRICE_REVIEW", actionLabel: "승인된 가격 반영 검증", message: "이미 승인한 가격변경에 대한 실제 반영 확인이 남아 있습니다. 새 가격변경은 실행하지 않습니다." };
  if (input.fundingState !== "COMPLETE") return { ...report, message: "실제 지출과 남은 자금을 확인해 월 자금 마감을 진행하세요." };
  return { ...report, state: "READY_FOR_NEXT_CALCULATION", nextAction: "OPEN_NEXT_CALCULATION", actionLabel: "최신 재고로 다음 발주계산", message: "이번 사이클의 후속 반영을 확인했습니다. 다음 발주계산은 최신 재고·미입고·실제 투입현금으로 새로 실행합니다. 계산만으로 주문·결제되지 않습니다." };
}
