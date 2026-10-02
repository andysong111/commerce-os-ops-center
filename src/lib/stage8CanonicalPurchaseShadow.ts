import { openChinaOrderCommitmentsByBarcode } from "@/lib/chinaOrderLedger";
import {
  koreanMonthLabel,
  monthlyPurchaseCycleFor,
} from "@/lib/monthlyPurchasePolicy";
import {
  DEFAULT_PURCHASE_COST_MULTIPLIER,
} from "@/lib/productDecisionEngine/portfolio";
import {
  loadProductMasterCanonicalSalesAudit,
  type CanonicalRollingSalesRow,
} from "@/lib/productMasterCanonicalSalesAudit";
import {
  compareLiveProductDecision,
  loadProductDecisionLiveStatus,
  loadProductPlanningSnapshot,
} from "@/lib/productDecisionLiveRefresh";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";
import {
  buildLiveProductDecisionSnapshot,
  type PlanningProduct,
  type ShoplingLiveAggregate,
} from "@/lib/shopling/shoplingLiveAggregation";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const CANONICAL_FRESHNESS_MAX_MS = 12 * 60 * 60 * 1000;
const BUCKET_COUNT = 12;

export type CanonicalPurchaseShadowBlocker = {
  key: string;
  message: string;
};

export type CanonicalPurchaseShadow = {
  generatedAt: string;
  state: "SHADOW_READY" | "BLOCKED";
  shadowReady: boolean;
  promotionReady: false;
  businessWritesEnabled: false;
  demandSource: "PRODUCT_MASTER_CANONICAL_SALES_EVENTS";
  claimSignalMode: "NEUTRAL_SHADOW_ONLY";
  analysisAsOf: string | null;
  canonicalAgeMinutes: number | null;
  canonicalFresh: boolean;
  persistedReconciliationFingerprint: string | null;
  canonicalContentFingerprint: string | null;
  planningContentFingerprint: string | null;
  planningManagedActiveCount: number;
  canonicalManagedActiveCount: number;
  exactPlanningMatchCount: number;
  planningMismatchBarcodes: string[];
  commitmentBarcodeCount: number;
  recent30Revenue: number;
  purchaseCycleMonth: string;
  purchaseBudgetMonth: string;
  purchaseBudgetMonthRevenue: number;
  snapshot: ReturnType<typeof buildLiveProductDecisionSnapshot> | null;
  legacyReference: {
    available: boolean;
    sameAnalysisAsOf: boolean;
    analysisAsOf: string | null;
    comparison: ReturnType<typeof compareLiveProductDecision> | null;
  };
  blockers: CanonicalPurchaseShadowBlocker[];
  message: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function managedBarcode(value: unknown) {
  const barcode = text(value).toUpperCase().replace(/\s+/g, "");
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
}

function emptyBuckets() {
  return Array.from({ length: BUCKET_COUNT }, () => 0);
}

function planningByBarcode(products: PlanningProduct[]) {
  const byBarcode = new Map<string, PlanningProduct[]>();
  for (const product of products) {
    const barcode = managedBarcode(product.barcode);
    if (!barcode || product.skuActive === false) continue;
    const rows = byBarcode.get(barcode) ?? [];
    rows.push({ ...product, barcode });
    byBarcode.set(barcode, rows);
  }
  return byBarcode;
}

function canonicalAggregate(
  planningProducts: PlanningProduct[],
  canonicalRows: CanonicalRollingSalesRow[],
  analysisAsOf: string,
) {
  const planningIndex = planningByBarcode(planningProducts);
  const planningMismatchBarcodes: string[] = [];
  const products: ShoplingLiveAggregate["products"] = [];

  for (const canonical of canonicalRows) {
    const barcode = managedBarcode(canonical.barcode);
    const matches = planningIndex.get(barcode) ?? [];
    if (!barcode || matches.length !== 1) {
      planningMismatchBarcodes.push(barcode || text(canonical.barcode));
      continue;
    }
    products.push({
      planning: matches[0],
      units: canonical.monthlyUnits.map(integer),
      revenue: canonical.monthlyRevenue.map(integer),
      // Purchase demand keeps using the rolling 12×30-day canonical history.
      // Only the portfolio funding cap is frozen to the previous calendar
      // month so marketplace settlement and purchase cashflow share one cycle.
      shippedOrders: emptyBuckets(),
      weightedClaims: emptyBuckets(),
      claimQuantity: emptyBuckets(),
    });
  }

  const canonicalBarcodes = new Set(
    canonicalRows.map((row) => managedBarcode(row.barcode)).filter(Boolean),
  );
  for (const [barcode, matches] of planningIndex) {
    if (matches.length !== 1 || !canonicalBarcodes.has(barcode)) {
      planningMismatchBarcodes.push(barcode);
    }
  }

  return {
    aggregate: {
      analysisAsOf,
      recent30Revenue: products.reduce(
        (total, product) => total + integer(product.revenue[0]),
        0,
      ),
      products,
    } satisfies ShoplingLiveAggregate,
    planningManagedActiveCount: [...planningIndex.values()].filter(
      (rows) => rows.length === 1,
    ).length,
    exactPlanningMatchCount: products.length,
    planningMismatchBarcodes: [...new Set(planningMismatchBarcodes)].sort(),
  };
}

export async function loadCanonicalPurchaseShadow(
  cycleAsOf: Date | string = new Date(),
  options: { commitmentOverride?: ReadonlyMap<string, number> } = {},
): Promise<CanonicalPurchaseShadow> {
  const generatedAt = new Date().toISOString();
  const blockers: CanonicalPurchaseShadowBlocker[] = [];
  const cycle = monthlyPurchaseCycleFor(cycleAsOf);

  const [reconciliation, audit, planning, legacy, budgetRevenueResult] =
    await Promise.all([
      loadPostApplyCanonicalReconciliation(),
      loadProductMasterCanonicalSalesAudit(),
      loadProductPlanningSnapshot(),
      loadProductDecisionLiveStatus(),
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

  if (!reconciliation.ready || reconciliation.state !== "READY") {
    blockers.push({
      key: "persisted-reconciliation",
      message: `Persisted canonical 대사가 ${reconciliation.state} 상태입니다.`,
    });
  }
  if (!audit.ready || !audit.snapshot) {
    blockers.push({
      key: "canonical-audit",
      message:
        audit.message || "Product Master canonical 판매원장을 읽지 못했습니다.",
    });
  }

  const purchaseBudgetMonthRevenue = integer(
    budgetRevenueResult.value?.revenueKrw,
  );
  if (budgetRevenueResult.error || purchaseBudgetMonthRevenue <= 0) {
    blockers.push({
      key: "calendar-month-purchase-budget",
      message: budgetRevenueResult.error
        ? `${koreanMonthLabel(cycle.budgetMonth)} 달력월 정상매출 조회 실패: ${budgetRevenueResult.error}`
        : `${koreanMonthLabel(cycle.budgetMonth)} 달력월 정상매출이 0원이라 월간 발주예산을 확정할 수 없습니다.`,
    });
  }

  const canonical = audit.snapshot;
  const analysisAsOf = canonical?.analysisAsOf ?? null;
  const ageMs = analysisAsOf ? Date.now() - Date.parse(analysisAsOf) : NaN;
  const canonicalAgeMinutes = Number.isFinite(ageMs)
    ? Math.max(0, Math.round(ageMs / 60_000))
    : null;
  const canonicalFresh =
    canonicalAgeMinutes !== null &&
    ageMs >= 0 &&
    ageMs <= CANONICAL_FRESHNESS_MAX_MS;
  if (!canonicalFresh) {
    blockers.push({
      key: "canonical-freshness",
      message:
        canonicalAgeMinutes === null
          ? "Canonical 분석시점을 확인할 수 없습니다."
          : `Canonical 판매 이벤트가 ${canonicalAgeMinutes}분 경과해 12시간 shadow 신선도 기준을 넘었습니다.`,
    });
  }

  if (
    reconciliation.analysisAsOf &&
    analysisAsOf &&
    reconciliation.analysisAsOf !== analysisAsOf
  ) {
    blockers.push({
      key: "analysis-time",
      message: `Persisted 대사 ${reconciliation.analysisAsOf} · canonical ${analysisAsOf}`,
    });
  }

  let snapshot: ReturnType<typeof buildLiveProductDecisionSnapshot> | null = null;
  let planningManagedActiveCount = 0;
  let exactPlanningMatchCount = 0;
  let planningMismatchBarcodes: string[] = [];
  let commitmentBarcodeCount = 0;
  let recent30Revenue = 0;

  if (canonical && analysisAsOf) {
    const built = canonicalAggregate(
      planning.products,
      canonical.rows,
      analysisAsOf,
    );
    planningManagedActiveCount = built.planningManagedActiveCount;
    exactPlanningMatchCount = built.exactPlanningMatchCount;
    planningMismatchBarcodes = built.planningMismatchBarcodes;
    recent30Revenue = built.aggregate.recent30Revenue;

    if (planningMismatchBarcodes.length) {
      blockers.push({
        key: "planning-canonical-scope",
        message: `Planning ↔ canonical active SKU 불일치 ${planningMismatchBarcodes.length}개`,
      });
    }
    if (exactPlanningMatchCount !== canonical.rows.length) {
      blockers.push({
        key: "canonical-row-coverage",
        message: `Canonical ${canonical.rows.length}개 중 engine 입력 ${exactPlanningMatchCount}개입니다.`,
      });
    }

    const commitments = options.commitmentOverride
      ? {
          commitments: new Map(options.commitmentOverride),
          error: null,
        }
      : await openChinaOrderCommitmentsByBarcode();
    if (commitments.error) {
      blockers.push({
        key: "china-order-commitments",
        message: `중국 미입고 원장 읽기 실패: ${commitments.error}`,
      });
    } else if (!budgetRevenueResult.error && purchaseBudgetMonthRevenue > 0) {
      commitmentBarcodeCount = commitments.commitments.size;
      const monthlyBudgetAggregate: ShoplingLiveAggregate = {
        ...built.aggregate,
        // buildLiveProductDecisionSnapshot uses this single portfolio funding
        // field. Demand units/revenue buckets remain untouched.
        recent30Revenue: purchaseBudgetMonthRevenue,
      };
      snapshot = buildLiveProductDecisionSnapshot(
        `canonical-purchase-shadow:${
          reconciliation.candidateSalesRequestId ?? analysisAsOf
        }`,
        monthlyBudgetAggregate,
        commitments.commitments,
      );
      snapshot = {
        ...snapshot,
        notice:
          "판매수요는 Product Master canonical 12×30일 원장을 사용하고, 상품대금 발주예산은 직전 달력월 정상매출로 고정한 월간 발주안입니다. 클레임 보조신호는 아직 중립값이며 실제 발주 실행은 차단됩니다.",
        budgetBasis:
          `${koreanMonthLabel(cycle.budgetMonth)} 1일~말일 정상매출 ` +
          `${purchaseBudgetMonthRevenue.toLocaleString("ko-KR")}원 ÷ 2 · ` +
          `배송대행 포함 배수 ${DEFAULT_PURCHASE_COST_MULTIPLIER.toFixed(2)}`,
      };
      if ((snapshot.products ?? []).length !== exactPlanningMatchCount) {
        blockers.push({
          key: "engine-output-coverage",
          message: `Engine 입력 ${exactPlanningMatchCount}개 · 출력 ${
            (snapshot.products ?? []).length
          }개`,
        });
      }
    }
  }

  const legacySnapshot = legacy.finalSnapshot;
  const legacyAnalysisAsOf = legacySnapshot?.generatedAt ?? null;
  const sameAnalysisAsOf = Boolean(
    analysisAsOf && legacyAnalysisAsOf && analysisAsOf === legacyAnalysisAsOf,
  );
  const comparison =
    snapshot && legacySnapshot
      ? compareLiveProductDecision(legacySnapshot, snapshot)
      : null;

  blockers.push({
    key: "claim-auxiliary",
    message:
      "클레임/배송건수 보조신호는 아직 canonical demand 경로에 연결하지 않았습니다. Shadow 비교만 허용합니다.",
  });

  const structuralBlockers = blockers.filter(
    (row) => row.key !== "claim-auxiliary",
  );
  const shadowReady = Boolean(snapshot) && structuralBlockers.length === 0;

  return {
    generatedAt,
    state: shadowReady ? "SHADOW_READY" : "BLOCKED",
    shadowReady,
    promotionReady: false,
    businessWritesEnabled: false,
    demandSource: "PRODUCT_MASTER_CANONICAL_SALES_EVENTS",
    claimSignalMode: "NEUTRAL_SHADOW_ONLY",
    analysisAsOf,
    canonicalAgeMinutes,
    canonicalFresh,
    persistedReconciliationFingerprint:
      reconciliation.reconciliationFingerprint,
    canonicalContentFingerprint: canonical?.contentFingerprint ?? null,
    planningContentFingerprint: planning.contentFingerprint,
    planningManagedActiveCount,
    canonicalManagedActiveCount: canonical?.rows.length ?? 0,
    exactPlanningMatchCount,
    planningMismatchBarcodes,
    commitmentBarcodeCount,
    recent30Revenue,
    purchaseCycleMonth: cycle.cycleMonth,
    purchaseBudgetMonth: cycle.budgetMonth,
    purchaseBudgetMonthRevenue,
    snapshot,
    legacyReference: {
      available: Boolean(legacySnapshot),
      sameAnalysisAsOf,
      analysisAsOf: legacyAnalysisAsOf,
      comparison,
    },
    blockers,
    message: shadowReady
      ? `${koreanMonthLabel(cycle.cycleMonth)} 발주안은 ${koreanMonthLabel(cycle.budgetMonth)} 달력월 매출예산과 최신 canonical 수요·재고·미입고를 결합해 계산했습니다.`
      : "Canonical 월간 발주 shadow의 구조 검증에서 차단 조건이 남아 있습니다.",
  };
}
