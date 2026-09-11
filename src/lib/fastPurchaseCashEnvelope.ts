import { createHash } from "node:crypto";
import { openChinaOrderCommitmentsByBarcode } from "@/lib/chinaOrderLedger";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import { loadPurchaseCycleStockReport } from "@/lib/purchaseCycleStockReport";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  PURCHASE_V2_DEFAULT_COST_MULTIPLIER,
  PURCHASE_V2_DEFAULT_MINIMUM_LINE_KRW,
  PURCHASE_V2_RULE_VERSION,
  allocatePurchaseV2Portfolio,
  calculatePurchaseV2Product,
  type PurchaseV2AllocationRound,
  type PurchaseV2Decision,
  type PurchaseV2InventorySource,
  type PurchaseV2Pattern,
  type PurchaseV2PriceEffect,
} from "@/lib/productDecisionEngine/purchaseV2";
import { loadPurchaseForecastFeedback } from "@/lib/purchaseRecommendationFinalization";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

const MAX_CASH_INPUT_KRW = 100_000_000;

export type FastPurchaseCashEnvelopeRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  pattern: PurchaseV2Pattern;
  decision: PurchaseV2Decision;
  priorityScore: number;
  forecast30Quantity: number;
  target44Quantity: number;
  observedRecent30Units: number;
  restoredRecent30Units: number;
  stockoutDemandRecovered: number;
  recent30StockoutDays: number;
  priceEffect: PurchaseV2PriceEffect;
  priceChangeRate: number | null;
  feedbackMultiplier: number;
  inventorySource: PurchaseV2InventorySource;
  inventoryLowQuantity: number;
  inventoryHighQuantity: number;
  openCommitmentQuantity: number;
  recommendedQuantity: number;
  allocatedQuantity: number;
  minimumLineReview: boolean;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  budgetReduced: boolean;
  allocations: Record<PurchaseV2AllocationRound, number>;
  reasons: string[];
};

export type FastPurchaseCashEnvelopeReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  ruleVersion: string;
  calculationFingerprint: string;
  cycleMonth: string;
  budgetMonth: string;
  requestedCashKrw: number;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  effectiveCashKrw: number;
  cashClamped: boolean;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  recommendedSkuCount: number;
  allocatedSkuCount: number;
  budgetReducedSkuCount: number;
  exactInventorySkuCount: number;
  inventoryReviewSkuCount: number;
  smallReviewSkuCount: number;
  feedbackObservationCount: number;
  patternCounts: Record<PurchaseV2Pattern, number>;
  roundSpendKrw: Record<PurchaseV2AllocationRound, number>;
  rows: FastPurchaseCashEnvelopeRow[];
  blockers: string[];
};

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}
function text(value: unknown) { return String(value ?? "").normalize("NFKC").trim(); }
function barcode(value: unknown) { return text(value).toUpperCase().replace(/\s+/g, ""); }
function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function emptyPatterns(): Record<PurchaseV2Pattern, number> {
  return { GROWTH: 0, STABLE_CORE: 0, GENERAL: 0, DECLINING: 0, DORMANT: 0 };
}
function emptyRounds(): Record<PurchaseV2AllocationRound, number> {
  return { URGENT_14_DAY: 0, STABLE_CORE_30_DAY: 0, GROWTH_30_DAY: 0, FULL_44_DAY: 0 };
}
function blockedReport(input: {
  message: string; cycleMonth: string; budgetMonth: string; requestedCashKrw: number;
  maxGrossBudgetKrw?: number; recorded1688SpendKrw?: number; blockers?: string[];
}): FastPurchaseCashEnvelopeReport {
  const maxGrossBudgetKrw = money(input.maxGrossBudgetKrw);
  const recorded1688SpendKrw = money(input.recorded1688SpendKrw);
  const maxAdditionalGrossBudgetKrw = Math.max(0, maxGrossBudgetKrw - recorded1688SpendKrw);
  return {
    generatedAt: new Date().toISOString(), state: "BLOCKED", message: input.message,
    ruleVersion: PURCHASE_V2_RULE_VERSION,
    calculationFingerprint: sha256({ state: "BLOCKED", message: input.message, cycleMonth: input.cycleMonth }),
    cycleMonth: input.cycleMonth, budgetMonth: input.budgetMonth,
    requestedCashKrw: input.requestedCashKrw, maxGrossBudgetKrw, recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw, effectiveCashKrw: 0,
    cashClamped: input.requestedCashKrw > maxAdditionalGrossBudgetKrw,
    purchaseCostMultiplier: PURCHASE_V2_DEFAULT_COST_MULTIPLIER,
    productOrderBudgetKrw: 0, expectedProductSpendKrw: 0, expectedAllInSpendKrw: 0,
    remainingCashKrw: 0, recommendedSkuCount: 0, allocatedSkuCount: 0,
    budgetReducedSkuCount: 0, exactInventorySkuCount: 0, inventoryReviewSkuCount: 0,
    smallReviewSkuCount: 0, feedbackObservationCount: 0,
    patternCounts: emptyPatterns(), roundSpendKrw: emptyRounds(), rows: [], blockers: input.blockers ?? [],
  };
}

export async function loadFastPurchaseCashEnvelope(cashInputKrw: unknown): Promise<FastPurchaseCashEnvelopeReport> {
  const requestedCashKrw = money(cashInputKrw);
  if (requestedCashKrw <= 0 || requestedCashKrw > MAX_CASH_INPUT_KRW) throw new Error("FAST_PURCHASE_CASH_ENVELOPE_AMOUNT_INVALID");
  const cycleMonth = seoulCalendarMonth(new Date());
  const [shadow, audit, planning, purchase, stockControl, diagnostics, salesEvents, commitments] = await Promise.all([
    loadCanonicalPurchaseShadow(),
    loadProductMasterCanonicalSalesAudit(),
    loadProductPlanningSnapshot(),
    loadInternalChinaMonthlyPurchaseSummary(cycleMonth).catch(() => null),
    // The explicit V2 calculation uses the same latest stocktake/reset/Tail
    // evidence as stock operations, not the stale reset-only base report.
    loadPurchaseCycleStockReport({ refreshSales: true }),
    loadProvisionalInventoryDiagnostics(),
    loadStage8CanonicalSalesEventSnapshot(),
    openChinaOrderCommitmentsByBarcode(),
  ]);
  const maxGrossBudgetKrw = money(shadow.purchaseBudgetMonthRevenue / 2);
  const recorded1688SpendKrw = money(purchase?.actualOrderPaidKrwAtInternalFx);
  const maxAdditionalGrossBudgetKrw = Math.max(0, maxGrossBudgetKrw - recorded1688SpendKrw);
  const effectiveCashKrw = Math.min(requestedCashKrw, maxAdditionalGrossBudgetKrw);
  const cashClamped = requestedCashKrw !== effectiveCashKrw;
  const blockers: string[] = [];
  if (!audit.ready || !audit.snapshot) blockers.push(audit.message || "Canonical 12×30일 판매원장이 준비되지 않았습니다.");
  if (!planning.products.length) blockers.push("Product Planning 상품정보가 없습니다.");
  if (stockControl.state !== "READY") blockers.push(...stockControl.blockers);
  if (salesEvents.state !== "READY_READ_ONLY") blockers.push("Canonical 판매 이벤트 원장을 읽지 못했습니다.");
  if (commitments.error) blockers.push(commitments.error);
  if (maxGrossBudgetKrw <= 0) blockers.push("이번 발주월의 전체 지출가능금액을 확정하지 못했습니다.");
  if (effectiveCashKrw <= 0) blockers.push("이미 기록된 1688 결제액이 전체 지출가능금액을 사용해 신규 발주 현금이 없습니다.");
  if (blockers.length) return blockedReport({
    message: "V2 수요·재고·미입고·현금 입력 중 차단 조건이 있어 발주권장안을 만들지 않았습니다.",
    cycleMonth, budgetMonth: shadow.purchaseBudgetMonth, requestedCashKrw, maxGrossBudgetKrw,
    recorded1688SpendKrw, blockers: [...new Set(blockers)],
  });

  const feedback = await loadPurchaseForecastFeedback(salesEvents.events).catch(() => ({
    multipliers: new Map<string, number>(), observationCount: 0, fingerprint: "feedback-unavailable",
  }));
  const planningByBarcode = new Map(planning.products.filter((row) => row.skuActive !== false).map((row) => [barcode(row.barcode), row] as const));
  const exactByBarcode = new Map(stockControl.rows.filter((row) => row.salesCoverageReady).map((row) => [row.barcode, row] as const));
  const diagnosticByBarcode = new Map(diagnostics.rows.map((row) => [barcode(row.barcode), row] as const));
  const products = (audit.snapshot?.rows ?? []).map((salesRow) => {
    const key = barcode(salesRow.barcode);
    const profile = planningByBarcode.get(key);
    if (!key || !profile) return null;
    const exact = exactByBarcode.get(key);
    const diagnostic = diagnosticByBarcode.get(key);
    let inventorySource: PurchaseV2InventorySource = "UNKNOWN";
    let inventoryLowQuantity = 0, inventoryHighQuantity = 0, recent30StockoutDays = 0;
    if (exact) {
      inventorySource = "EXACT_AFTER_STOCKOUT_RESET";
      inventoryLowQuantity = exact.exactInventoryQuantity;
      inventoryHighQuantity = exact.exactInventoryQuantity;
      recent30StockoutDays = exact.recent30StockoutDays;
    } else if (diagnostic?.state === "BAND_READY" && diagnostic.diagnosticLowQuantity !== null && diagnostic.diagnosticHighQuantity !== null) {
      inventorySource = "ESTIMATED_BAND";
      inventoryLowQuantity = money(diagnostic.diagnosticLowQuantity);
      inventoryHighQuantity = money(diagnostic.diagnosticHighQuantity);
    } else if (diagnostic?.cumulativeResidualCandidate !== null && diagnostic?.cumulativeResidualCandidate !== undefined) {
      inventorySource = "ESTIMATED_BAND";
      inventoryLowQuantity = money(diagnostic.cumulativeResidualCandidate);
      inventoryHighQuantity = money(diagnostic.cumulativeResidualCandidate);
    }
    const recentUnits = (salesRow.monthlyUnits ?? []).slice(0, 3).reduce((total, value) => total + money(value), 0);
    const recentRevenue = (salesRow.monthlyRevenue ?? []).slice(0, 3).reduce((total, value) => total + money(value), 0);
    const storedCost = money(profile.latestCostKrw || profile.protectedCostKrw);
    const unitCostKrw = storedCost > 0 ? storedCost : recentUnits > 0 ? Math.round((recentRevenue / recentUnits) * 0.5) : 0;
    return calculatePurchaseV2Product({
      barcode: key, name: text(profile.productName) || key, modelNo: text(profile.modelNo) || null,
      monthlyUnits: salesRow.monthlyUnits, monthlyRevenue: salesRow.monthlyRevenue, unitCostKrw,
      inventorySource, inventoryLowQuantity, inventoryHighQuantity,
      openCommitmentQuantity: money(commitments.commitments.get(key)), recent30StockoutDays,
      feedbackMultiplier: feedback.multipliers.get(key) ?? 1,
    }, PURCHASE_V2_DEFAULT_MINIMUM_LINE_KRW);
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const allocation = allocatePurchaseV2Portfolio({
    grossCashBudgetKrw: effectiveCashKrw, purchaseCostMultiplier: PURCHASE_V2_DEFAULT_COST_MULTIPLIER,
    minimumLineAmountKrw: PURCHASE_V2_DEFAULT_MINIMUM_LINE_KRW, products,
  });
  const rows: FastPurchaseCashEnvelopeRow[] = allocation.products.map((row) => {
    const unitCostKrw = row.recommendedQuantity > 0 ? money(row.expectedProductCostKrw / row.recommendedQuantity) : 0;
    return {
      barcode: row.barcode, modelNo: row.modelNo, productName: row.name, pattern: row.pattern,
      decision: row.decision, priorityScore: row.score.total, forecast30Quantity: row.forecast30Quantity,
      target44Quantity: row.target44Quantity, observedRecent30Units: row.observedRecent30Units,
      restoredRecent30Units: row.restoredRecent30Units, stockoutDemandRecovered: row.stockoutDemandRecovered,
      recent30StockoutDays: row.recent30StockoutDays, priceEffect: row.priceEffect, priceChangeRate: row.priceChangeRate,
      feedbackMultiplier: row.feedbackMultiplier, inventorySource: row.inventorySource,
      inventoryLowQuantity: row.inventoryLowQuantity, inventoryHighQuantity: row.inventoryHighQuantity,
      openCommitmentQuantity: row.openCommitmentQuantity, recommendedQuantity: row.recommendedQuantity,
      allocatedQuantity: row.allocatedQuantity, minimumLineReview: row.minimumLineReview,
      unitCostKrw, expectedProductCostKrw: row.expectedAllocatedProductCostKrw,
      budgetReduced: row.budgetReduced, allocations: row.allocations, reasons: row.reasons,
    };
  });
  const patternCounts = emptyPatterns();
  for (const row of rows) patternCounts[row.pattern] += 1;
  const calculationFingerprint = sha256({
    ruleVersion: PURCHASE_V2_RULE_VERSION, cycleMonth, budgetMonth: shadow.purchaseBudgetMonth,
    requestedCashKrw, effectiveCashKrw, canonicalFingerprint: audit.snapshot?.contentFingerprint,
    stockFingerprint: stockControl.fingerprint, feedbackFingerprint: feedback.fingerprint,
    commitmentRows: [...commitments.commitments.entries()].sort(([left], [right]) => left.localeCompare(right)),
    rows: rows.map((row) => ({
      barcode: row.barcode, pattern: row.pattern, decision: row.decision, forecast30Quantity: row.forecast30Quantity,
      target44Quantity: row.target44Quantity, inventoryLowQuantity: row.inventoryLowQuantity,
      inventoryHighQuantity: row.inventoryHighQuantity, openCommitmentQuantity: row.openCommitmentQuantity,
      recommendedQuantity: row.recommendedQuantity, allocatedQuantity: row.allocatedQuantity,
      priceEffect: row.priceEffect, priorityScore: row.priorityScore,
    })),
  });
  return {
    generatedAt: new Date().toISOString(), state: "READY",
    message: cashClamped
      ? "입력 현금이 추가 지출가능 상한을 넘어 상한까지만 적용했습니다. V2는 품절수요·가격변동·성장형·안정형·44일 목표·추정/정확재고·미입고를 계산한 뒤 다단계로 현금을 배분합니다."
      : "V2는 품절수요·가격변동·성장형·안정형·44일 목표·추정/정확재고·미입고를 계산한 뒤 다단계로 현금을 배분합니다.",
    ruleVersion: PURCHASE_V2_RULE_VERSION, calculationFingerprint, cycleMonth,
    budgetMonth: shadow.purchaseBudgetMonth, requestedCashKrw, maxGrossBudgetKrw, recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw, effectiveCashKrw, cashClamped,
    purchaseCostMultiplier: allocation.purchaseCostMultiplier, productOrderBudgetKrw: allocation.productOrderBudgetKrw,
    expectedProductSpendKrw: allocation.expectedProductSpendKrw, expectedAllInSpendKrw: allocation.expectedAllInSpendKrw,
    remainingCashKrw: allocation.remainingGrossCashKrw, recommendedSkuCount: allocation.recommendedSkuCount,
    allocatedSkuCount: allocation.allocatedSkuCount, budgetReducedSkuCount: allocation.budgetReducedSkuCount,
    exactInventorySkuCount: rows.filter((row) => row.inventorySource === "EXACT_AFTER_STOCKOUT_RESET").length,
    inventoryReviewSkuCount: rows.filter((row) => row.decision === "INVENTORY_REVIEW").length,
    smallReviewSkuCount: rows.filter((row) => row.decision === "SMALL_REVIEW").length,
    feedbackObservationCount: feedback.observationCount, patternCounts, roundSpendKrw: allocation.roundSpendKrw, rows, blockers: [],
  };
}
