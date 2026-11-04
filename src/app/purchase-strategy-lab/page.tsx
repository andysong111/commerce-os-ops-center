import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";
import type { PurchaseStrategyLabRow } from "@/lib/purchaseStrategyLab";
import {
  PURCHASE_STRATEGY_LAB_SAMPLE_BUDGET_KRW,
  purchaseStrategyLabSampleRows,
} from "@/lib/purchaseStrategyLabSample";
import { PurchaseStrategyLabClient } from "./PurchaseStrategyLabClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams: Promise<{ asOf?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validAsOf(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function effectiveUnitCost(row: Awaited<ReturnType<typeof loadInventoryVerificationPriority>>["rows"][number]) {
  return Math.max(
    0,
    row.verifiedPurchaseUnitCostKrw,
    row.purchaseProtectedCostKrw,
    row.protectedCostKrw,
    row.planningUnitCostKrw,
    row.recommendedQty > 0
      ? Math.round(row.expectedCost / row.recommendedQty)
      : 0,
  );
}

type StrategyLabSnapshot = {
  rows: PurchaseStrategyLabRow[];
  defaultBudgetKrw: number;
  generatedAt: string;
  sourceAsOf: string | null;
  sourceState: string;
  dataMode: "LIVE" | "SAMPLE";
};

function isExpectedLocalReadinessError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED"
  );
}

async function loadStrategyLabSnapshot(
  requestedAsOf: string | null,
): Promise<StrategyLabSnapshot> {
  try {
    const report = await loadInventoryVerificationPriority(
      requestedAsOf ? `${requestedAsOf}T12:00:00+09:00` : new Date(),
    );
    const rows: PurchaseStrategyLabRow[] = report.rows.map((row) => ({
      barcode: row.barcode,
      name: row.name,
      modelNo: row.modelNo,
      purchaseStatus: row.purchaseStatus,
      originalPurchaseStatus: row.originalPurchaseStatus,
      entrySignals: row.entrySignals,
      recommendedQuantity: row.recommendedQty,
      preGateRecommendedQuantity: row.preGateRecommendedQty,
      moq: row.moq,
      cartonQuantity: row.cartonQuantity,
      unitCostKrw: effectiveUnitCost(row),
      priorityScore: row.priorityScore,
      revenueQualifiedMonthCount: row.revenueQualifiedMonthCount,
      averageMonthlyRevenueKrw: row.averageMonthlyRevenueKrw,
      risingStrength: row.risingStrength,
      permanentlyDiscontinued: row.permanentlyDiscontinued,
      operationallyReady: row.operationallyReady,
      inventoryMode: row.inventoryMode,
    }));
    return {
      rows,
      defaultBudgetKrw: Math.max(
        0,
        report.source?.budgetKrw ??
          report.source?.grossBudgetKrw ??
          report.totalExpectedSpend,
      ),
      generatedAt: report.generatedAt,
      sourceAsOf: report.source?.analysisAsOf?.slice(0, 10) ?? requestedAsOf,
      sourceState: report.state,
      dataMode: "LIVE",
    };
  } catch (error) {
    if (
      process.env.NODE_ENV === "production" ||
      !isExpectedLocalReadinessError(error)
    ) {
      throw error;
    }
    return {
      rows: purchaseStrategyLabSampleRows(),
      defaultBudgetKrw: PURCHASE_STRATEGY_LAB_SAMPLE_BUDGET_KRW,
      generatedAt: new Date().toISOString(),
      sourceAsOf: requestedAsOf ?? "2026-11-04",
      sourceState: "LOCAL_SAMPLE_ONLY",
      dataMode: "SAMPLE",
    };
  }
}

export default async function PurchaseStrategyLabPage({ searchParams }: PageProps) {
  const requestedAsOf = validAsOf(firstParam((await searchParams).asOf));
  const snapshot = await loadStrategyLabSnapshot(requestedAsOf);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · READ-ONLY PURCHASE STRATEGY LAB"
        title="발주전략 시험장"
        description="같은 최신 판매·재고·미입고·원가 스냅샷에 여러 현금배분 전략을 즉시 적용해 비교합니다. 이 화면은 Draft 저장·재계산·1688 주문 API를 호출하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/stage8-inventory-verification-priority"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
            >
              재고·원가 근거 보기
            </Link>
            <Link
              href="/china-order-manager"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
            >
              운영 발주안으로 돌아가기
            </Link>
          </div>
        }
      />

      <section
        className={`rounded-2xl border p-5 text-sm leading-6 ${
          snapshot.dataMode === "SAMPLE"
            ? "border-amber-300 bg-amber-50 text-amber-950"
            : "border-emerald-200 bg-emerald-50 text-emerald-950"
        }`}
      >
        <strong>
          {snapshot.dataMode === "SAMPLE"
            ? "샘플 데이터 모드 · 운영 값 아님"
            : "실제 읽기 전용 스냅샷 · 운영 초안 보호됨"}
        </strong>
        <p>
          {snapshot.dataMode === "SAMPLE"
            ? "로컬 개발환경에 상품마스터 읽기 비밀값이 없어 사용자 제보 사례로 화면을 검증합니다. 이 값으로 운영 판단하거나 발주하지 마세요."
            : "11월 4일을 포함한 기존 발주초안은 읽거나 바꾸지 않습니다. 최초 스냅샷을 한 번 읽은 뒤 아래 전략 변경은 브라우저 안에서만 다시 계산됩니다."}
        </p>
      </section>

      <PurchaseStrategyLabClient
        rows={snapshot.rows}
        defaultBudgetKrw={snapshot.defaultBudgetKrw}
        generatedAt={snapshot.generatedAt}
        sourceAsOf={snapshot.sourceAsOf}
        sourceState={snapshot.sourceState}
        dataMode={snapshot.dataMode}
      />
    </div>
  );
}
