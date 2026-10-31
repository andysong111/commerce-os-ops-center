import {
  PURCHASE_MONTHLY_REVENUE_FLOOR_KRW,
  PURCHASE_STOCKOUT_HISTORY_UNIT_FLOOR,
} from "./productDecisionEngine/salesOrder.ts";
import { planningCompletedCalendarMonthlySales } from "./productDecisionEngine/planningMonthlySales.ts";

export type PurchaseCandidateOmissionReason =
  | "PURCHASE_SHADOW_ROW_MISSING"
  | "SALES_ITEM_DATA_HOLD"
  | "SOLD_OUT_ACTIVE_SALES_NOT_RECOMMENDED"
  | "SHOPLING_ZERO_LEDGER_POSITIVE"
  | "RECOMMENDATION_EVIDENCE_BLOCKED"
  | "SUPPLIER_LINK_MISSING"
  | "CHINA_OPTION_MISSING"
  | "SOURCE_METADATA_CONFLICT"
  | "STOCKOUT_DEMAND_RECOVERY_ELIGIBLE"
  | "RECENT_RISING_ELIGIBLE"
  | "MONTHLY_REVENUE_40000_ELIGIBLE";

export type PurchaseCandidateOmissionReviewRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  severity: "BLOCKING" | "PREPARATION";
  reasons: PurchaseCandidateOmissionReason[];
  salesQuantity30: number;
  salesQuantity90: number;
  salesQuantity365: number;
  salesRevenue30: number;
  salesTrend: string | null;
  planningInventoryQuantity: number;
  ledgerInventoryQuantity: number | null;
  shoplingQuantity: number | null;
  shoplingSyncedAt: string | null;
  purchaseStatus: string | null;
  recommendedQuantity: number;
  openCommitment: number;
};

type PlanningProduct = {
  barcode?: unknown;
  modelNo?: unknown;
  productName?: unknown;
  skuActive?: boolean;
  inventoryQuantity?: unknown;
  salesQuantity30?: unknown;
  salesQuantity90?: unknown;
  salesQuantity365?: unknown;
  salesRevenue30?: unknown;
  salesRevenue90?: unknown;
  salesRevenue365?: unknown;
  salesMonthly?: unknown;
  purchaseStrategyMonthly?: unknown;
  salesTrend?: unknown;
  salesTrendRate?: unknown;
  orderDecision?: unknown;
  recommendedOrderQuantity?: unknown;
};

type PriorityRow = {
  barcode: string;
  purchaseStatus: string;
  originalPurchaseStatus?: string;
  demandTarget?: number;
  entrySignals?: string[];
  recommendedQty: number;
  originalRecommendedQty?: number;
  inventoryQuantity?: number;
  operatorStockBand?: "OUT" | "LOW" | "NORMAL" | "HIGH" | null;
  openCommitment: number;
};

type InventoryRow = {
  inventoryQuantity: number;
};

type SourceMetadata = {
  supplierLink: string;
  chinaOption: string;
  conflict: boolean;
  shoplingQuantity: number | null;
  shoplingSyncedAt: string | null;
};

export type PurchaseCandidateOmissionAuditInput = {
  planningProducts: PlanningProduct[];
  priorityRows: PriorityRow[];
  inventoryByBarcode: Map<string, InventoryRow>;
  sourceMetadataByBarcode: Map<string, SourceMetadata>;
  sourceMetadataAvailable: boolean;
  strategyAsOf: string;
  monthlyRevenueThresholdKrw?: number;
};

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function planningRecommendsOrder(product: PlanningProduct) {
  const decision = text(product.orderDecision).toUpperCase();
  return (
    quantity(product.recommendedOrderQuantity) > 0 ||
    decision.includes("발주 추천") ||
    decision.includes("RECOMMEND") ||
    decision === "ORDER"
  );
}

function demandEntryReasons(
  product: PlanningProduct,
  monthlyRevenueThresholdKrw: number,
  strategyAsOf: string,
) {
  const reasons: PurchaseCandidateOmissionReason[] = [];
  const salesQuantity30 = quantity(product.salesQuantity30);
  const salesQuantity90 = quantity(product.salesQuantity90);
  const salesRevenue30 = quantity(product.salesRevenue30);
  const salesRevenue90 = quantity(product.salesRevenue90);
  const calendarBuckets = Array.isArray(product.salesMonthly)
    ? product.salesMonthly
        .filter(
          (row): row is { month?: unknown; quantity?: unknown; revenue?: unknown } =>
            Boolean(row && typeof row === "object"),
        )
        .map((row) => ({
          month: text(row.month),
          quantity: quantity(row.quantity),
          revenue: quantity(row.revenue),
        }))
        .filter((row) => /^\d{4}-\d{2}$/.test(row.month))
        .sort((left, right) => right.month.localeCompare(left.month))
        .slice(0, 6)
    : [];
  const historicalBuckets = calendarBuckets.slice(1, 6);
  const historical90Quantity = Math.max(0, salesQuantity90 - salesQuantity30);
  const historical90Revenue = Math.max(0, salesRevenue90 - salesRevenue30);
  const historicalPeakQuantity = Math.max(
    historical90Quantity,
    ...historicalBuckets.map((row) => row.quantity),
  );
  const historicalPeakRevenue = Math.max(
    historical90Revenue,
    ...historicalBuckets.map((row) => row.revenue),
  );
  const soldOutHistory =
    quantity(product.inventoryQuantity) === 0 &&
    salesQuantity30 === 0 &&
    (historicalPeakQuantity >= PURCHASE_STOCKOUT_HISTORY_UNIT_FLOOR ||
      historicalPeakRevenue >= PURCHASE_MONTHLY_REVENUE_FLOOR_KRW);
  const trend = text(product.salesTrend).toUpperCase();
  const trendRate = Number(product.salesTrendRate);
  const rising =
    trend === "RISING" ||
    trend === "상승" ||
    trend === "급상승" ||
    (Number.isFinite(trendRate) && trendRate >= 0.2);
  const hasCompletedMonthlySource =
    (Array.isArray(product.salesMonthly) && product.salesMonthly.length > 0) ||
    (Array.isArray(product.purchaseStrategyMonthly) &&
      product.purchaseStrategyMonthly.length > 0);
  const strategyMonthlyBuckets = hasCompletedMonthlySource
    ? planningCompletedCalendarMonthlySales(
        product.purchaseStrategyMonthly,
        strategyAsOf,
        product.salesMonthly,
      )
    : [];
  const historicalRevenueQualified =
    strategyMonthlyBuckets.length > 0
      ? strategyMonthlyBuckets.some(
          (row) => row.revenue >= monthlyRevenueThresholdKrw,
        )
      : salesRevenue30 >= monthlyRevenueThresholdKrw;

  if (soldOutHistory) reasons.push("STOCKOUT_DEMAND_RECOVERY_ELIGIBLE");
  if (rising) reasons.push("RECENT_RISING_ELIGIBLE");
  if (historicalRevenueQualified) {
    reasons.push("MONTHLY_REVENUE_40000_ELIGIBLE");
  }
  return { reasons, hasCompletedMonthlySource };
}

export function buildPurchaseCandidateOmissionReview(
  input: PurchaseCandidateOmissionAuditInput,
): PurchaseCandidateOmissionReviewRow[] {
  const configuredThreshold = Number(input.monthlyRevenueThresholdKrw);
  const monthlyRevenueThresholdKrw =
    Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? Math.round(configuredThreshold)
      : PURCHASE_MONTHLY_REVENUE_FLOOR_KRW;
  const priorityByBarcode = new Map(
    input.priorityRows.map((row) => [barcode(row.barcode), row] as const),
  );
  const result: PurchaseCandidateOmissionReviewRow[] = [];

  for (const product of input.planningProducts) {
    const key = barcode(product.barcode);
    if (!MANAGED_BARCODE.test(key) || product.skuActive === false) continue;
    const salesQuantity30 = quantity(product.salesQuantity30);
    const salesQuantity90 = quantity(product.salesQuantity90);
    const salesQuantity365 = quantity(product.salesQuantity365);
    const salesRevenue30 = quantity(product.salesRevenue30);
    if (salesQuantity30 + salesQuantity90 + salesQuantity365 <= 0) continue;

    const priority = priorityByBarcode.get(key);
    const inventory = input.inventoryByBarcode.get(key);
    const metadata = input.sourceMetadataByBarcode.get(key);
    const ledgerInventoryQuantity = inventory
      ? quantity(inventory.inventoryQuantity)
      : null;
    const priorityInventoryQuantity = priority
      ? quantity(priority.inventoryQuantity)
      : null;
    const operatorStockBandAccounted = priority
      ? ["OUT", "LOW", "NORMAL", "HIGH"].includes(
          text(priority.operatorStockBand).toUpperCase(),
        )
      : false;
    const inventoryAccountedByPurchaseEngine = Boolean(
      priority &&
        (operatorStockBandAccounted ||
          (ledgerInventoryQuantity !== null &&
            priorityInventoryQuantity === ledgerInventoryQuantity)),
    );
    const recentSales = salesQuantity30 > 0 || salesQuantity90 > 0;
    const recommendedQuantity = priority
      ? quantity(priority.recommendedQty)
      : quantity(product.recommendedOrderQuantity);
    const openCommitment = quantity(priority?.openCommitment);
    const accountedAsCandidate = Boolean(
      priority?.purchaseStatus === "발주 추천" && recommendedQuantity > 0,
    );
    const reasons: PurchaseCandidateOmissionReason[] = [];
    const entryAssessment = demandEntryReasons(
      product,
      monthlyRevenueThresholdKrw,
      input.strategyAsOf,
    );
    const entryReasons = entryAssessment.reasons;
    const recordedSignals = new Set(
      (priority?.entrySignals ?? []).map((value) => text(value).toUpperCase()),
    );
    // A reversible permanent exclusion is an explicit owner decision, so it is
    // neither a silently omitted candidate nor a reason to block the Draft.
    if (recordedSignals.has("PERMANENTLY_DISCONTINUED")) continue;
    const signalsForReason: Partial<
      Record<PurchaseCandidateOmissionReason, readonly string[]>
    > = {
      STOCKOUT_DEMAND_RECOVERY_ELIGIBLE: ["STOCKOUT_DEMAND_RECOVERY"],
      RECENT_RISING_ELIGIBLE: ["RECENT_RISING"],
      MONTHLY_REVENUE_40000_ELIGIBLE: [
        "HISTORICAL_REVENUE_THRESHOLD",
        "MONTHLY_REVENUE_40000",
      ],
    };
    const demandTarget = quantity(priority?.demandTarget);
    const independentlyAuthoritativeEntryReasons = priority
      ? entryReasons.filter(
          (reason) =>
            reason === "MONTHLY_REVENUE_40000_ELIGIBLE" &&
            entryAssessment.hasCompletedMonthlySource,
        )
      : entryReasons;
    // A positive pre-budget target proves that the demand engine evaluated the
    // row even for older cached snapshots that did not persist signal
    // provenance. A zero-target row must still carry the exact entry signal;
    // otherwise a monthly-qualified product could disappear silently.
    const missingEntryReasons = demandTarget > 0
      ? []
      : independentlyAuthoritativeEntryReasons.filter((reason) => {
          const signals = signalsForReason[reason];
          return !signals?.some((signal) => recordedSignals.has(signal));
        });
    // A row with a positive pre-budget demand target has been evaluated even
    // when inventory, commitments, claim risk, or the portfolio budget keeps
    // it out of the final order. Those are explicit holds, not silent omission.
    const accountedByDemandEngine = Boolean(
      accountedAsCandidate ||
      priority &&
        (demandTarget > 0 ||
          entryReasons.length > 0 && missingEntryReasons.length === 0),
    );
    let blocking = false;

    if (missingEntryReasons.length > 0) {
      reasons.push(...missingEntryReasons);
      blocking = true;
    }

    if (!priority) {
      reasons.push("PURCHASE_SHADOW_ROW_MISSING");
      // A missing engine row is material only when the product independently
      // qualifies for purchase entry or Product Master explicitly recommends
      // it. A single low-volume historical sale must stay visible for review,
      // but it must not freeze the entire monthly Draft after the purchase
      // strategy intentionally rejected the product.
      blocking ||=
        entryReasons.length > 0 || planningRecommendsOrder(product);
    }
    if (
      priority &&
      [priority.purchaseStatus, priority.originalPurchaseStatus].some(
        (status) => text(status).includes("데이터 부족"),
      )
    ) {
      reasons.push("SALES_ITEM_DATA_HOLD");
      blocking ||= recentSales;
    }
    if (planningRecommendsOrder(product) && !accountedByDemandEngine) {
      reasons.push("RECOMMENDATION_EVIDENCE_BLOCKED");
      blocking = true;
    }
    if (
      recentSales &&
      quantity(product.inventoryQuantity) === 0 &&
      openCommitment === 0 &&
      !accountedByDemandEngine
    ) {
      reasons.push("SOLD_OUT_ACTIVE_SALES_NOT_RECOMMENDED");
      // Keep low-volume sold-out products in the preparation list, while the
      // actual purchase-entry signals above remain fail-closed. This prevents
      // 1-2 historical sales from overriding the configurable monthly revenue
      // strategy and blocking every otherwise valid Draft.
      blocking ||=
        entryReasons.length > 0 || planningRecommendsOrder(product);
    }
    if (
      metadata?.shoplingQuantity === 0 &&
      (ledgerInventoryQuantity ?? 0) > 0
    ) {
      reasons.push("SHOPLING_ZERO_LEDGER_POSITIVE");
      // Shopling 0 can mean that the sales channel is intentionally sold out
      // while the internal inventory ledger still has stock. That mismatch
      // must stay visible for channel-state repair, but it must not freeze the
      // monthly purchase draft when the exact same ledger quantity was already
      // subtracted by the purchase engine. If the row is missing or the two
      // inventory quantities differ, fail closed because the order calculation
      // may not have accounted for the stock.
      blocking ||= !inventoryAccountedByPurchaseEngine;
    }
    if (input.sourceMetadataAvailable) {
      if (!metadata?.supplierLink) reasons.push("SUPPLIER_LINK_MISSING");
      if (!metadata?.chinaOption) reasons.push("CHINA_OPTION_MISSING");
      if (metadata?.conflict) reasons.push("SOURCE_METADATA_CONFLICT");
    }
    if (!reasons.length) continue;

    result.push({
      barcode: key,
      modelNo: text(product.modelNo) || null,
      productName: text(product.productName) || key,
      severity: blocking ? "BLOCKING" : "PREPARATION",
      reasons,
      salesQuantity30,
      salesQuantity90,
      salesQuantity365,
      salesRevenue30,
      salesTrend: text(product.salesTrend) || null,
      planningInventoryQuantity: quantity(product.inventoryQuantity),
      ledgerInventoryQuantity,
      shoplingQuantity: metadata?.shoplingQuantity ?? null,
      shoplingSyncedAt: metadata?.shoplingSyncedAt ?? null,
      purchaseStatus: priority?.purchaseStatus ?? null,
      recommendedQuantity,
      openCommitment,
    });
  }

  return result.sort(
    (left, right) =>
      Number(right.severity === "BLOCKING") -
        Number(left.severity === "BLOCKING") ||
      right.salesQuantity365 - left.salesQuantity365 ||
      right.salesQuantity90 - left.salesQuantity90 ||
      left.barcode.localeCompare(right.barcode),
  );
}
