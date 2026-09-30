import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import {
  koreanMonthLabel,
  monthlyPurchaseCycleForMonth,
} from "@/lib/monthlyPurchasePolicy";
import {
  DEFAULT_PURCHASE_COST_MULTIPLIER,
  calculateProductOrderBudget,
} from "@/lib/productDecisionEngine/portfolio";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProductMasterInventoryCostReadiness } from "@/lib/productMasterInventoryCostReadiness";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { effectivePurchaseUnitCostKrw } from "@/lib/verifiedPurchaseCostEvidence";

const SOURCE_SYSTEM = "fast-purchase-mvp";

export type InternalChinaPurchaseBudgetAuditStatus =
  | "WITHIN_BUDGET"
  | "OVER_BUDGET"
  | "COST_REVIEW";

export type InternalChinaPurchaseBudgetAuditLine = {
  barcode: string;
  quantity: number;
  referenceUnitCostKrw: number;
  actualUnitPriceCny: number;
  actualUnitCostKrw: number;
  effectiveUnitCostKrw: number;
  costSource: "ACTUAL_1688" | "REFERENCE" | "MISSING";
  estimatedProductCostKrw: number;
  engineRecommendedQuantity: number;
  engineExpectedCostKrw: number;
  quantityDeltaFromEngine: number;
};

export type InternalChinaPurchaseBudgetAudit = {
  generatedAt: string;
  analysisAsOf: string | null;
  cycleMonth: string;
  budgetMonth: string;
  budgetMonthRangeStart: string;
  budgetMonthRangeEnd: string;
  budgetMonthRevenueKrw: number;
  budgetRevenueError: string | null;
  basisLabel: string;
  recent30RevenueKrw: number;
  grossCogsBudgetKrw: number;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  engineExpectedSpendKrw: number;
  selectedDraftEstimatedProductCostKrw: number;
  selectedDraftDomesticChinaFreightKrw: number;
  selectedDraftEstimatedLandedCostKrw: number;
  selectedDraftBudgetRemainingKrw: number;
  selectedDraftBudgetOverKrw: number;
  selectedDraftBudgetUtilizationPercent: number;
  allActiveDraftEstimatedProductCostKrw: number;
  otherActiveDraftEstimatedProductCostKrw: number;
  otherActiveDraftQuantity: number;
  otherActiveDraftCount: number;
  missingCostBarcodes: string[];
  actualPriceCount: number;
  referencePriceCount: number;
  quantityChangedFromEngineCount: number;
  quantityAboveEngineCount: number;
  quantityBelowEngineCount: number;
  status: InternalChinaPurchaseBudgetAuditStatus;
  lines: InternalChinaPurchaseBudgetAuditLine[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export async function loadInternalChinaPurchaseBudgetAudit(
  draftId: string,
): Promise<InternalChinaPurchaseBudgetAudit> {
  // The budget month belongs to the Draft's explicit purchase cycle. A Draft
  // created early for October must still use September, even on September 30.
  const draft = await loadInternalChinaPurchaseDraft(draftId);
  const cycle = monthlyPurchaseCycleForMonth(draft.cycleMonth);

  const [shadow, planning, inventoryCost, ledger, calendarRevenue] = await Promise.all([
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
    loadProductMasterInventoryCostReadiness().catch(() => null),
    loadChinaOrderLedger(),
    loadCalendarMonthNormalRevenue(cycle.budgetMonth)
      .then((value) => ({ value, error: null as string | null }))
      .catch((error) => ({
        value: null,
        error:
          error instanceof Error
            ? error.message
            : "CALENDAR_MONTH_REVENUE_UNAVAILABLE",
      })),
  ]);

  const snapshot = shadow.snapshot;
  const recent30RevenueKrw = money(shadow.recent30Revenue);
  const budgetMonthRevenueKrw = money(calendarRevenue.value?.revenueKrw);
  const grossCogsBudgetKrw = money(budgetMonthRevenueKrw / 2);
  const purchaseCostMultiplier = DEFAULT_PURCHASE_COST_MULTIPLIER;
  const productOrderBudgetKrw = money(
    calculateProductOrderBudget(grossCogsBudgetKrw, purchaseCostMultiplier),
  );
  const engineExpectedSpendKrw = money(snapshot?.expectedSpend);

  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );
  const inventoryCostByBarcode = new Map(
    (inventoryCost?.rows ?? [])
      .map((row) => [barcode(row.barcode), row] as const)
      .filter(([key]) => Boolean(key)),
  );
  const engineByBarcode = new Map(
    (snapshot?.products ?? [])
      .map((row) => [barcode(row.barcode), row] as const)
      .filter(([key]) => Boolean(key)),
  );

  function referenceUnitCostKrw(key: string) {
    const verifiedPurchaseCost = effectivePurchaseUnitCostKrw(
      inventoryCostByBarcode.get(key),
      Date.now(),
    );
    if (verifiedPurchaseCost > 0) return verifiedPurchaseCost;
    const profile = planningByBarcode.get(key);
    const stored = money(profile?.latestCostKrw);
    if (stored > 0) return stored;
    const engine = engineByBarcode.get(key);
    const recommended = quantity(engine?.recommendedQty);
    const expectedCost = money(engine?.expectedCost);
    return recommended > 0 && expectedCost > 0
      ? Math.round(expectedCost / recommended)
      : 0;
  }

  const lines: InternalChinaPurchaseBudgetAuditLine[] = draft.lines.map((line) => {
    const key = barcode(line.barcode);
    const referenceUnitCost = referenceUnitCostKrw(key);
    const actualUnitPriceCny = decimal(line.unitPriceCny);
    const actualUnitCostKrw = money(
      actualUnitPriceCny * draft.exchangeRateKrwPerCny,
    );
    const effectiveUnitCostKrw = actualUnitCostKrw || referenceUnitCost;
    const costSource: InternalChinaPurchaseBudgetAuditLine["costSource"] =
      actualUnitCostKrw > 0
        ? "ACTUAL_1688"
        : referenceUnitCost > 0
          ? "REFERENCE"
          : "MISSING";
    const engine = engineByBarcode.get(key);
    const engineRecommendedQuantity = quantity(engine?.recommendedQty);
    const engineExpectedCostKrw = money(engine?.expectedCost);
    return {
      barcode: key,
      quantity: quantity(line.quantity),
      referenceUnitCostKrw: referenceUnitCost,
      actualUnitPriceCny,
      actualUnitCostKrw,
      effectiveUnitCostKrw,
      costSource,
      estimatedProductCostKrw: money(
        effectiveUnitCostKrw * quantity(line.quantity),
      ),
      engineRecommendedQuantity,
      engineExpectedCostKrw,
      quantityDeltaFromEngine:
        quantity(line.quantity) - engineRecommendedQuantity,
    };
  });

  const missingCostBarcodes = lines
    .filter((line) => line.costSource === "MISSING")
    .map((line) => line.barcode);
  const actualPriceCount = lines.filter(
    (line) => line.costSource === "ACTUAL_1688",
  ).length;
  const referencePriceCount = lines.filter(
    (line) => line.costSource === "REFERENCE",
  ).length;
  const selectedDraftEstimatedProductCostKrw = lines.reduce(
    (sum, line) => sum + line.estimatedProductCostKrw,
    0,
  );
  const selectedDraftDomesticChinaFreightKrw = money(
    draft.lines.reduce(
      (sum, line) => sum + decimal(line.domesticChinaFreightCny),
      0,
    ) * draft.exchangeRateKrwPerCny,
  );
  const selectedDraftEstimatedLandedCostKrw = money(
    (selectedDraftEstimatedProductCostKrw + selectedDraftDomesticChinaFreightKrw) *
      purchaseCostMultiplier,
  );
  const selectedDraftBudgetRemainingKrw = Math.max(
    0,
    productOrderBudgetKrw - selectedDraftEstimatedProductCostKrw,
  );
  const selectedDraftBudgetOverKrw = Math.max(
    0,
    selectedDraftEstimatedProductCostKrw - productOrderBudgetKrw,
  );
  const selectedDraftBudgetUtilizationPercent =
    productOrderBudgetKrw > 0
      ? Math.round(
          (selectedDraftEstimatedProductCostKrw / productOrderBudgetKrw) *
            10_000,
        ) / 100
      : 0;

  const activeCommitments = ledger.commitments.filter(
    (row) =>
      row.sourceSystem === SOURCE_SYSTEM &&
      row.openQuantity > 0 &&
      row.sourceRunId,
  );
  const activeDraftIds = new Set(
    activeCommitments.map((row) => text(row.sourceRunId)).filter(Boolean),
  );
  let allActiveDraftEstimatedProductCostKrw = 0;
  let otherActiveDraftEstimatedProductCostKrw = 0;
  let otherActiveDraftQuantity = 0;
  for (const commitment of activeCommitments) {
    // Other Drafts are only a collision warning here. Their detailed 1688 prep
    // may not be saved, so use the stable reference cost for this side panel.
    const unitCost = referenceUnitCostKrw(barcode(commitment.barcode));
    const estimated = money(unitCost * quantity(commitment.openQuantity));
    allActiveDraftEstimatedProductCostKrw += estimated;
    if (text(commitment.sourceRunId) !== draft.draftId) {
      otherActiveDraftEstimatedProductCostKrw += estimated;
      otherActiveDraftQuantity += quantity(commitment.openQuantity);
    }
  }

  const quantityChangedFromEngineCount = lines.filter(
    (line) => line.quantityDeltaFromEngine !== 0,
  ).length;
  const quantityAboveEngineCount = lines.filter(
    (line) => line.quantityDeltaFromEngine > 0,
  ).length;
  const quantityBelowEngineCount = lines.filter(
    (line) => line.quantityDeltaFromEngine < 0,
  ).length;

  const status: InternalChinaPurchaseBudgetAuditStatus =
    calendarRevenue.error ||
    budgetMonthRevenueKrw <= 0 ||
    missingCostBarcodes.length > 0 ||
    productOrderBudgetKrw <= 0
      ? "COST_REVIEW"
      : selectedDraftEstimatedProductCostKrw > productOrderBudgetKrw
        ? "OVER_BUDGET"
        : "WITHIN_BUDGET";

  const budgetRange = calendarRevenue.value?.range ?? cycle.budgetRange;

  return {
    generatedAt: new Date().toISOString(),
    analysisAsOf: shadow.analysisAsOf,
    cycleMonth: cycle.cycleMonth,
    budgetMonth: cycle.budgetMonth,
    budgetMonthRangeStart: budgetRange.start,
    budgetMonthRangeEnd: budgetRange.end,
    budgetMonthRevenueKrw,
    budgetRevenueError: calendarRevenue.error,
    basisLabel: `${koreanMonthLabel(cycle.budgetMonth)} 1일~말일 정상매출 ${budgetMonthRevenueKrw.toLocaleString("ko-KR")}원 ÷ 2 · 내부 주문 수수료율 ${purchaseCostMultiplier.toFixed(2)}`,
    recent30RevenueKrw,
    grossCogsBudgetKrw,
    purchaseCostMultiplier,
    productOrderBudgetKrw,
    engineExpectedSpendKrw,
    selectedDraftEstimatedProductCostKrw,
    selectedDraftDomesticChinaFreightKrw,
    selectedDraftEstimatedLandedCostKrw,
    selectedDraftBudgetRemainingKrw,
    selectedDraftBudgetOverKrw,
    selectedDraftBudgetUtilizationPercent,
    allActiveDraftEstimatedProductCostKrw,
    otherActiveDraftEstimatedProductCostKrw,
    otherActiveDraftQuantity,
    otherActiveDraftCount: Math.max(
      0,
      activeDraftIds.size - (activeDraftIds.has(draft.draftId) ? 1 : 0),
    ),
    missingCostBarcodes,
    actualPriceCount,
    referencePriceCount,
    quantityChangedFromEngineCount,
    quantityAboveEngineCount,
    quantityBelowEngineCount,
    status,
    lines,
  };
}
