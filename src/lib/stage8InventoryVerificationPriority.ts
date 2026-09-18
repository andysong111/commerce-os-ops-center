import { DEFAULT_PURCHASE_COST_MULTIPLIER } from "@/lib/productDecisionEngine/portfolio";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import {
  loadProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostRow,
} from "@/lib/productMasterInventoryCostReadiness";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";

export type InventoryOperatingMode =
  | "VERIFIED"
  | "PROVISIONAL"
  | "REVIEW"
  | "MISSING";

export type InventoryVerificationPriorityRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  purchaseStatus: SalesOrderGroup;
  originalPurchaseStatus: string;
  recommendedQty: number;
  originalRecommendedQty: number;
  expectedCost: number;
  priorityScore: number;
  inventoryQuantity: number;
  inventoryMode: InventoryOperatingMode;
  inventoryVerified: boolean;
  inventoryVerification: string;
  inventoryRequiresReview: boolean;
  initialZeroUnverified: boolean;
  inventoryBaselineKind: string | null;
  movementCount: number;
  inboundMovementCount: number;
  openCommitment: number;
  hasConfirmedReceiptCost: boolean;
  latestConfirmedReceiptAt: string | null;
  latestConfirmedReceiptCostKrw: number;
  purchaseCostEvidenceCount: number;
  hasVerifiedPurchaseCost: boolean;
  purchaseCostTrustSource:
    | "CONFIRMED_RECEIPT"
    | "LEGACY_VERIFIED_COST_EVIDENCE"
    | "SOURCE_ORDER_VERIFIED_COST_EVIDENCE"
    | "UNVERIFIED";
  verifiedPurchaseUnitCostKrw: number;
  verifiedPurchaseCostAt: string | null;
  purchaseProtectedCostKrw: number;
  protectedCostKrw: number;
  inventoryCalculationUsable: boolean;
  executionInventoryEligible: boolean;
  advisoryOnly: boolean;
  action:
    | "NONE"
    | "LEDGER_REVIEW_REQUIRED"
    | "PROVISIONAL_DECISION_EVIDENCE_REQUIRED"
    | "COST_CONFIRMATION_REQUIRED";
  operationallyReady: boolean;
};

export type InventoryVerificationPriority = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  purchaseShadowReady: boolean;
  managedActiveSkuCount: number;
  purchaseRecommendationCount: number;
  operationallyReadyPurchaseCount: number;
  blockedPurchaseRecommendationCount: number;
  provisionalPurchaseCount: number;
  provisionalExecutionBlockedCount: number;
  verifiedPurchaseCount: number;
  reviewInventoryCount: number;
  totalExpectedSpend: number;
  operationallyReadyExpectedSpend: number;
  blockedExpectedSpend: number;
  stocktakeRequiredCount: 0;
  writesEnabled: false;
  // Optional for old stored reports; the preflight fails closed when absent.
  // Carries the existing shadow provenance without another expensive load.
  source?: {
    analysisAsOf: string | null;
    planningContentFingerprint: string;
    shadowPlanningContentFingerprint: string | null;
    canonicalContentFingerprint: string | null;
    reconciliationFingerprint: string | null;
    cycleMonth: string;
    budgetMonth: string;
    budgetKrw: number | null;
    inventoryGeneratedAt?: string;
    inventoryContentFingerprint?: string;
    grossBudgetKrw?: number;
    purchaseCostMultiplier?: number;
    comparisonAvailable: boolean;
    sameAnalysisAsOf: boolean;
    blockerKeys: string[];
  };
  rows: InventoryVerificationPriorityRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function inventoryByBarcode(rows: ProductMasterInventoryCostRow[]) {
  return new Map(rows.map((row) => [barcode(row.barcode), row]));
}

function planningByBarcode(
  products: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>["products"],
) {
  return new Map(
    products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );
}

function inventoryMode(
  row: ProductMasterInventoryCostRow | undefined,
): InventoryOperatingMode {
  if (!row) return "MISSING";
  if (row.inventoryRequiresReview || row.inventoryVerification === "REVIEW") {
    return "REVIEW";
  }
  if (row.inventoryVerified) return "VERIFIED";
  return "PROVISIONAL";
}

function actionFor(row: ProductMasterInventoryCostRow | undefined) {
  const mode = inventoryMode(row);
  if (mode === "MISSING" || mode === "REVIEW") {
    return "LEDGER_REVIEW_REQUIRED" as const;
  }
  if (mode === "PROVISIONAL") {
    return "PROVISIONAL_DECISION_EVIDENCE_REQUIRED" as const;
  }
  if (!row?.hasVerifiedPurchaseCost) {
    return "COST_CONFIRMATION_REQUIRED" as const;
  }
  return "NONE" as const;
}

function salesOrderGroup(value: unknown): SalesOrderGroup {
  const normalized = text(value);
  if (
    normalized === "발주 추천" ||
    normalized === "소량 검토" ||
    normalized === "발주 보류" ||
    normalized === "데이터 부족"
  ) {
    return normalized;
  }
  return "발주 보류";
}

function expectedCostForQuantity(
  previousCost: unknown,
  previousQuantity: unknown,
  nextQuantity: number,
) {
  const quantity = integer(previousQuantity);
  const cost = integer(previousCost);
  if (!quantity || !cost || !nextQuantity) return 0;
  return Math.round((cost / quantity) * nextQuantity);
}

export async function loadInventoryVerificationPriority(): Promise<InventoryVerificationPriority> {
  const [purchaseShadow, inventoryReadiness, planning] = await Promise.all([
    loadCanonicalPurchaseShadow(),
    loadProductMasterInventoryCostReadiness(),
    loadProductPlanningSnapshot(),
  ]);
  const purchaseProducts = purchaseShadow.snapshot?.products ?? [];
  const inventoryIndex = inventoryByBarcode(inventoryReadiness.rows);
  const planningIndex = planningByBarcode(planning.products);

  const rows: InventoryVerificationPriorityRow[] = purchaseProducts
    .map((product) => {
      const key = barcode(product.barcode);
      const inventory = inventoryIndex.get(key);
      const profile = planningIndex.get(key);
      const mode = inventoryMode(inventory);
      const inventoryCalculationUsable =
        mode === "VERIFIED" || mode === "PROVISIONAL";
      const executionInventoryEligible = mode === "VERIFIED";
      const advisoryOnly = mode === "PROVISIONAL";
      const originalGroup = salesOrderGroup(product.status);
      const originalRecommendedQty = integer(product.recommendedQty);
      const demandTarget = integer(
        product.rawRecommendedQty ?? product.recommendedQty,
      );
      const openCommitment = integer(product.openCommitment);
      const net = calculateNetRequirement({
        demandTarget,
        originalGroup,
        inventoryKnown: inventoryCalculationUsable,
        availableQuantity: inventoryCalculationUsable
          ? integer(inventory?.inventoryQuantity)
          : 0,
        reservedQuantity: 0,
        incomingQuantity: 0,
        ledgerCommitment: openCommitment,
        moq: Math.max(1, integer(profile?.moq) || 1),
        cartonQuantity: Math.max(1, integer(profile?.cartonQuantity) || 1),
      });
      const action = actionFor(inventory);
      const purchaseStatus = net.group;
      const recommendedQty = net.recommendedQuantity;
      const expectedCost = expectedCostForQuantity(
        product.expectedCost,
        originalRecommendedQty,
        recommendedQty,
      );
      const operationallyReady =
        purchaseStatus === "발주 추천" &&
        action === "NONE" &&
        executionInventoryEligible;

      return {
        barcode: key,
        name: text(product.name),
        modelNo: product.modelNo ? text(product.modelNo) : null,
        purchaseStatus,
        originalPurchaseStatus: text(product.status),
        recommendedQty,
        originalRecommendedQty,
        expectedCost,
        priorityScore: integer(product.score?.total),
        inventoryQuantity: inventory ? integer(inventory.inventoryQuantity) : 0,
        inventoryMode: mode,
        inventoryVerified: inventory?.inventoryVerified === true,
        inventoryVerification: text(inventory?.inventoryVerification) || "MISSING",
        inventoryRequiresReview: inventory?.inventoryRequiresReview === true,
        initialZeroUnverified: inventory?.initialZeroUnverified === true,
        inventoryBaselineKind: inventory?.inventoryBaselineKind ?? null,
        movementCount: integer(inventory?.movementCount),
        inboundMovementCount: integer(inventory?.inboundMovementCount),
        openCommitment,
        hasConfirmedReceiptCost: inventory?.hasConfirmedReceiptCost === true,
        latestConfirmedReceiptAt: inventory?.latestConfirmedReceiptAt ?? null,
        latestConfirmedReceiptCostKrw: integer(
          inventory?.latestConfirmedReceiptCostKrw,
        ),
        purchaseCostEvidenceCount: integer(inventory?.purchaseCostEvidenceCount),
        hasVerifiedPurchaseCost: inventory?.hasVerifiedPurchaseCost === true,
        purchaseCostTrustSource:
          inventory?.purchaseCostTrustSource ?? "UNVERIFIED",
        verifiedPurchaseUnitCostKrw: integer(
          inventory?.verifiedPurchaseUnitCostKrw,
        ),
        verifiedPurchaseCostAt: inventory?.verifiedPurchaseCostAt ?? null,
        purchaseProtectedCostKrw: integer(
          inventory?.purchaseProtectedCostKrw,
        ),
        protectedCostKrw: integer(inventory?.protectedCostKrw),
        inventoryCalculationUsable,
        executionInventoryEligible,
        advisoryOnly,
        action,
        operationallyReady,
      };
    })
    .sort(
      (left, right) =>
        Number(right.purchaseStatus === "발주 추천") -
          Number(left.purchaseStatus === "발주 추천") ||
        Number(left.operationallyReady) - Number(right.operationallyReady) ||
        right.expectedCost - left.expectedCost ||
        right.priorityScore - left.priorityScore ||
        left.barcode.localeCompare(right.barcode),
    );

  const purchaseRows = rows.filter((row) => row.purchaseStatus === "발주 추천");
  const readyRows = purchaseRows.filter((row) => row.operationallyReady);
  const totalExpectedSpend = purchaseRows.reduce(
    (sum, row) => sum + row.expectedCost,
    0,
  );
  const operationallyReadyExpectedSpend = readyRows.reduce(
    (sum, row) => sum + row.expectedCost,
    0,
  );
  const blockedExpectedSpend = Math.max(
    0,
    totalExpectedSpend - operationallyReadyExpectedSpend,
  );
  const structuralReady =
    purchaseShadow.shadowReady &&
    purchaseProducts.length === inventoryReadiness.summary.managedActiveSkuCount &&
    rows.every(
      (row) => inventoryIndex.has(row.barcode) && planningIndex.has(row.barcode),
    );

  return {
    generatedAt: new Date().toISOString(),
    state: structuralReady ? "READY" : "BLOCKED",
    message: structuralReady
      ? "PROVISIONAL 재고는 발주수량을 미리 계산하는 advisory 입력으로 사용할 수 있지만 실제 발주 Draft 실행가능 상태로 승격하지 않습니다. SOLD_OUT_RESET 또는 다른 신뢰 가능한 기준점으로 VERIFIED가 되거나, 별도 PROVISIONAL 의사결정 증거 게이트를 통과한 뒤에만 실행 경로를 열 수 있습니다. 재고실사는 필수조건이 아닙니다."
      : "Canonical 발주 shadow·Product Master 재고원장·planning 연결이 완전하지 않아 발주 수량을 확정하지 않습니다.",
    purchaseShadowReady: purchaseShadow.shadowReady,
    managedActiveSkuCount: inventoryReadiness.summary.managedActiveSkuCount,
    purchaseRecommendationCount: purchaseRows.length,
    operationallyReadyPurchaseCount: readyRows.length,
    blockedPurchaseRecommendationCount: purchaseRows.length - readyRows.length,
    provisionalPurchaseCount: purchaseRows.filter(
      (row) => row.inventoryMode === "PROVISIONAL",
    ).length,
    provisionalExecutionBlockedCount: purchaseRows.filter(
      (row) =>
        row.inventoryMode === "PROVISIONAL" &&
        row.action === "PROVISIONAL_DECISION_EVIDENCE_REQUIRED",
    ).length,
    verifiedPurchaseCount: purchaseRows.filter(
      (row) => row.inventoryMode === "VERIFIED",
    ).length,
    reviewInventoryCount: rows.filter(
      (row) => row.inventoryMode === "REVIEW" || row.inventoryMode === "MISSING",
    ).length,
    totalExpectedSpend,
    operationallyReadyExpectedSpend,
    blockedExpectedSpend,
    stocktakeRequiredCount: 0,
    writesEnabled: false,
    source: {
      analysisAsOf: purchaseShadow.analysisAsOf,
      planningContentFingerprint: planning.contentFingerprint,
      shadowPlanningContentFingerprint: purchaseShadow.planningContentFingerprint,
      canonicalContentFingerprint: purchaseShadow.canonicalContentFingerprint,
      reconciliationFingerprint: purchaseShadow.persistedReconciliationFingerprint,
      cycleMonth: purchaseShadow.purchaseCycleMonth,
      budgetMonth: purchaseShadow.purchaseBudgetMonth,
      budgetKrw: purchaseShadow.snapshot?.budget ?? null,
      inventoryGeneratedAt: inventoryReadiness.generatedAt,
      inventoryContentFingerprint: inventoryReadiness.contentFingerprint,
      grossBudgetKrw: Math.round(purchaseShadow.purchaseBudgetMonthRevenue / 2),
      purchaseCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
      comparisonAvailable: purchaseShadow.legacyReference.comparison !== null,
      sameAnalysisAsOf: purchaseShadow.legacyReference.sameAnalysisAsOf,
      blockerKeys: purchaseShadow.blockers.map((row) => row.key),
    },
    rows,
  };
}
