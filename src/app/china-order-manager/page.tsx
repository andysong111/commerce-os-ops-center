import Link from "next/link";
import { MonthlyPricePanel } from "@/components/china-order-manager/MonthlyPricePanel";
import type { ReactNode } from "react";
import { InternalChinaFundingClosePanel } from "@/components/china-order-manager/InternalChinaFundingClosePanel";
import { InternalChinaForwarderCostFallback } from "@/components/china-order-manager/InternalChinaForwarderCostFallback";
import { InternalChinaMonthlyClosePanel } from "@/components/china-order-manager/InternalChinaMonthlyClosePanel";
import { InternalChinaReceiptPanel } from "@/components/china-order-manager/InternalChinaReceiptPanel";
import { PageHeader } from "@/components/PageHeader";
import {
  loadChinaOrderLedger,
  type ChinaOrderCommitmentSnapshot,
} from "@/lib/chinaOrderLedger";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import {
  loadInternalChinaForwarderCostSummary,
  type InternalChinaForwarderCostSummary,
} from "@/lib/internalChinaForwarderCost";
import { loadRecentStoredInternalChinaForwarderCloses } from "@/lib/internalChinaForwarderStoredClose";
import { loadRecentInternalChinaFundingCloses } from "@/lib/internalChinaFundingClose";
import {
  loadInternalChinaMonthlyPurchaseClose,
  loadRecentInternalChinaMonthlyPurchaseCloses,
  type InternalChinaMonthlyPurchaseCloseSummary,
} from "@/lib/internalChinaMonthlyPurchaseClose";
import {
  loadInternalChinaMonthlyPurchaseSummary,
  loadRecentInternalChinaMonthlyPurchaseSummaries,
  type InternalChinaMonthlyPurchaseSummary,
} from "@/lib/internalChinaMonthlyPurchaseSummary";
import {
  koreanMonthLabel,
  previousCalendarMonth,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadMonthlyDraftDisplayMetadata } from "@/lib/monthlyPurchaseDraftDisplayMetadata";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";
import styles from "./monthly-workspace.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const cny = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const SOURCE_SYSTEM = "fast-purchase-mvp";
const FORWARDER_TIMEOUT_MS = 4_500;
const METADATA_TIMEOUT_MS = 2_500;

type PageProps = {
  searchParams: Promise<{ month?: string | string[] }>;
};

type SelectedBudget = {
  budgetMonth: string;
  budgetMonthRevenueKrw: number;
  totalSpendingBudgetKrw: number;
  error: string | null;
};

type CostRow = {
  draftId: string;
  summary: InternalChinaForwarderCostSummary | null;
  warning: string;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function cycleOf(row: ChinaOrderCommitmentSnapshot) {
  return seoulCalendarMonth(row.reservedAt || row.updatedAt);
}

function total<T>(rows: T[], select: (row: T) => number) {
  return rows.reduce((sum, row) => sum + select(row), 0);
}

async function timebox<T>(task: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadBudget(cycleMonth: string): Promise<SelectedBudget> {
  const budgetMonth = previousCalendarMonth(cycleMonth);
  try {
    const revenue = await loadCalendarMonthNormalRevenue(budgetMonth);
    const budgetMonthRevenueKrw = Math.max(0, Math.round(revenue.revenueKrw));
    return {
      budgetMonth,
      budgetMonthRevenueKrw,
      totalSpendingBudgetKrw: Math.round(budgetMonthRevenueKrw / 2),
      error: null,
    };
  } catch (error) {
    return {
      budgetMonth,
      budgetMonthRevenueKrw: 0,
      totalSpendingBudgetKrw: 0,
      error:
        error instanceof Error ? error.message : "MONTHLY_BUDGET_UNAVAILABLE",
    };
  }
}

function purchaseMap(values: InternalChinaMonthlyPurchaseSummary[]) {
  return new Map(values.map((row) => [row.cycleMonth, row] as const));
}

function closeMap(values: InternalChinaMonthlyPurchaseCloseSummary[]) {
  return new Map(values.map((row) => [row.cycleMonth, row] as const));
}

function statusLabel(value: string) {
  if (value === "RESERVED") return "주문초안";
  if (value === "EXPORTED") return "중국주문 전송";
  if (value === "ORDERED") return "실주문";
  if (value === "PARTIALLY_RECEIVED") return "부분입고";
  if (value === "RECEIVED") return "정상입고 완료";
  if (value === "CANCELLED") return "취소·해제";
  if (value === "FAILED") return "처리 실패";
  return value;
}

function statusTone(value: string) {
  if (value === "RECEIVED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["RESERVED", "EXPORTED", "ORDERED", "PARTIALLY_RECEIVED"].includes(value)) {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  if (value === "FAILED") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export default async function ChinaOrderManagerPage({
  searchParams,
}: PageProps) {
  const currentCycleMonth = seoulCalendarMonth(new Date());
  const requestedMonth = firstParam((await searchParams).month);

  const [
    draftState,
    ledger,
    purchaseSummaries,
    purchaseCloses,
    forwarderCloses,
    fundingCloses,
  ] = await Promise.all([
    loadFastPurchaseInternalDrafts(),
    loadChinaOrderLedger(),
    loadRecentInternalChinaMonthlyPurchaseSummaries(24).catch(() => []),
    loadRecentInternalChinaMonthlyPurchaseCloses(24).catch(() => []),
    loadRecentStoredInternalChinaForwarderCloses(12).catch(() => []),
    loadRecentInternalChinaFundingCloses(24).catch(() => []),
  ]);

  const selectedMonth = isMonth(requestedMonth)
    ? requestedMonth
    : currentCycleMonth;
  const monthSet = new Set<string>([
    currentCycleMonth,
    selectedMonth,
    ...draftState.drafts.map((draft) => draft.cycleMonth),
    ...purchaseSummaries.map((row) => row.cycleMonth),
    ...purchaseCloses.map((row) => row.cycleMonth),
    ...forwarderCloses.map((row) => row.cycleMonth),
    ...fundingCloses.map((row) => row.cycleMonth),
  ]);
  const sortedMonths = [...monthSet]
    .filter(isMonth)
    .sort((left, right) => right.localeCompare(left));
  const months = sortedMonths.slice(0, 12);
  if (!months.includes(selectedMonth)) {
    if (months.length === 12) months.pop();
    months.push(selectedMonth);
    months.sort((left, right) => right.localeCompare(left));
  }

  const purchaseByMonth = purchaseMap(purchaseSummaries);
  const closeByMonth = closeMap(purchaseCloses);
  const [budget, purchaseFallback, closeFallback] = await Promise.all([
    loadBudget(selectedMonth),
    purchaseByMonth.has(selectedMonth)
      ? Promise.resolve(null)
      : loadInternalChinaMonthlyPurchaseSummary(selectedMonth).catch(() => null),
    closeByMonth.has(selectedMonth)
      ? Promise.resolve(null)
      : loadInternalChinaMonthlyPurchaseClose(selectedMonth).catch(() => null),
  ]);
  const purchase = purchaseByMonth.get(selectedMonth) ?? purchaseFallback;
  const monthlyClose = closeByMonth.get(selectedMonth) ?? closeFallback;
  if (purchase && !purchaseByMonth.has(selectedMonth)) {
    purchaseByMonth.set(selectedMonth, purchase);
  }
  if (monthlyClose && !closeByMonth.has(selectedMonth)) {
    closeByMonth.set(selectedMonth, monthlyClose);
  }

  const selectedRows = ledger.commitments
    .filter(
      (row) =>
        row.sourceSystem === SOURCE_SYSTEM && cycleOf(row) === selectedMonth,
    )
    .sort((left, right) => {
      const active = Number(right.openQuantity > 0) - Number(left.openQuantity > 0);
      return active || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  const selectedDrafts = draftState.drafts.filter(
    (draft) => draft.cycleMonth === selectedMonth,
  );
  const orderedQuantity = total(selectedRows, (row) => row.orderedQuantity);
  const receivedQuantity = total(selectedRows, (row) => row.receivedQuantity);
  const openQuantity = total(selectedRows, (row) => row.openQuantity);
  const releasableRows = selectedRows.filter(
    (row) =>
      row.openQuantity > 0 &&
      row.orderedQuantity === 0 &&
      row.receivedQuantity === 0 &&
      (row.status === "RESERVED" || row.status === "EXPORTED"),
  );
  const releasableQuantity = total(releasableRows, (row) => row.openQuantity);

  const selectedBarcodes = selectedDrafts.flatMap((draft) =>
    draft.lines.map((line) => line.barcode),
  );
  const metadata: Awaited<
    ReturnType<typeof loadMonthlyDraftDisplayMetadata>
  > = selectedBarcodes.length
    ? ((await timebox(
        loadMonthlyDraftDisplayMetadata(selectedBarcodes),
        METADATA_TIMEOUT_MS,
      )) ?? {
        byBarcode: {},
        warnings: ["상품 표시정보 조회가 지연되어 B-code 중심으로 표시합니다."],
      })
    : { byBarcode: {}, warnings: [] };

  const costRows: CostRow[] = await Promise.all(
    selectedDrafts
      .filter((draft) => draft.orderedQuantity > 0)
      .map(async (draft) => {
        const stored = forwarderCloses.find(
          (row) => row.draftId === draft.draftId,
        );
        try {
          const summary = await timebox(
            loadInternalChinaForwarderCostSummary(draft.draftId, selectedMonth),
            FORWARDER_TIMEOUT_MS,
          );
          const legacyRebased =
            Boolean(stored && summary?.actualCostKrw) &&
            (
              stored?.productPurchaseCostKrw !== summary?.productPurchaseCostKrw ||
              stored?.domesticChinaFreightKrw !== summary?.domesticChinaFreightKrw ||
              stored?.actualTotalOutflowKrw !== summary?.actualTotalOutflowKrw ||
              stored?.actualMultiplier !== summary?.actualMultiplier
            );
          return {
            draftId: draft.draftId,
            summary,
            warning: summary
              ? legacyRebased
                ? "과거 저장 원가를 현재 확정 1688 주문원장 기준으로 재계산해 표시합니다."
                : ""
              : "실시간 원가요약 조회가 4.5초를 넘었습니다.",
          };
        } catch (error) {
          return {
            draftId: draft.draftId,
            summary: null,
            warning:
              error instanceof Error
                ? error.message
                : "배송대행 비용 요약을 불러오지 못했습니다.",
          };
        }
      }),
  );

  const selectedForwarderCloses = forwarderCloses.filter(
    (row) => row.cycleMonth === selectedMonth,
  );
  const selectedFundingCloses = fundingCloses.filter(
    (row) => row.cycleMonth === selectedMonth,
  );
  const effectiveForwarderByDraft = new Map(
    costRows
      .filter((row) => row.summary?.actualCostKrw)
      .map((row) => [row.draftId, row.summary!] as const),
  );
  const selectedDraftIds = new Set(selectedDrafts.map((draft) => draft.draftId));
  const selectedEffectiveForwarderCloses = selectedForwarderCloses.flatMap((stored) => {
    const effective = effectiveForwarderByDraft.get(stored.draftId);
    if (effective) return [effective];
    // Old archived months may no longer have a reconstructable draft in memory.
    // For a currently loaded draft, never fall back to a possibly stale stored
    // subtotal; show the reconciliation warning instead of a wrong total.
    return selectedDraftIds.has(stored.draftId) ? [] : [stored];
  });
  const forwarderCostKrw = total(
    selectedForwarderCloses,
    (row) => row.actualCostKrw ?? 0,
  );
  const actualOutflowKrw =
    selectedForwarderCloses.length > 0 &&
    selectedEffectiveForwarderCloses.length === selectedForwarderCloses.length
      ? total(
          selectedEffectiveForwarderCloses,
          (row) => row.actualTotalOutflowKrw ?? 0,
        )
      : 0;
  const actual1688Krw = purchase?.actualOrderPaidKrwAtInternalFx ?? 0;
  const remainingBeforeFinalCost = Math.max(
    0,
    budget.totalSpendingBudgetKrw - actual1688Krw,
  );
  const budgetUsage =
    budget.totalSpendingBudgetKrw > 0
      ? Math.min(
          100,
          Math.round(
            (actual1688Krw / budget.totalSpendingBudgetKrw) * 1_000,
          ) / 10,
        )
      : 0;
  const displayedOrderQuantity = purchase?.totalQuantity || orderedQuantity;
  const hasOrder = (purchase?.orderCount ?? 0) > 0 || orderedQuantity > 0;
  const receiptDone = orderedQuantity > 0 && openQuantity === 0;
  const forwarderDone = selectedForwarderCloses.length > 0;
  const fundingDone = selectedFundingCloses.length > 0;
  const currentFundingTarget = costRows.find(
    (row) => (row.summary?.actualCostKrw ?? 0) > 0,
  );
  const currentFundingStored = currentFundingTarget
    ? fundingCloses.find(
        (row) => row.draftId === currentFundingTarget.draftId,
      ) ?? null
    : null;
  const actionNeeded =
    (!monthlyClose && selectedMonth === currentCycleMonth) ||
    openQuantity > 0 ||
    (receiptDone && !forwarderDone) ||
    (forwarderDone && !fundingDone);
  const warnings = [
    draftState.error,
    ledger.error,
    budget.error,
    ...metadata.warnings,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · MONTHLY PURCHASE WORKSPACE"
        title="월별 발주·입고 관리"
        description="월 하나를 선택해 예산 → 1688 주문 → 배송대행지 바코드 출력 → 입고 → 실제 원가 → 가격조정 → 자금 마감 순서로 처리합니다. 바코드 단계에서는 해당 월 실제 주문정보를 온돌패스 신청서와 자동 연결합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              빠른 발주안
            </Link>
            {selectedDrafts[0] ? (
              <Link
                href={`/china-order-manager/drafts/${encodeURIComponent(selectedDrafts[0].draftId)}`}
                className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800"
              >
                중국 주문초안
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              SELECTED MONTH
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-black text-slate-950">
                {koreanMonthLabel(selectedMonth)}
              </h2>
              <Badge tone={monthlyClose ? "emerald" : "amber"}>
                {monthlyClose ? "발주 마감" : "발주 열림"}
              </Badge>
              {openQuantity > 0 ? (
                <Badge tone="blue">입고 진행 중</Badge>
              ) : receiptDone ? (
                <Badge tone="emerald">추적 품목 입고 완료</Badge>
              ) : null}
              {forwarderDone ? <Badge tone="emerald">실제 비용 저장</Badge> : null}
              {fundingDone ? <Badge tone="emerald">자금 마감</Badge> : null}
            </div>
          </div>
          <nav
            className="flex max-w-full gap-2 overflow-x-auto pb-1"
            aria-label="발주월 선택"
          >
            {months.map((month) => (
              <Link
                key={month}
                href={`/china-order-manager?month=${month}`}
                className={`whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-black ${
                  month === selectedMonth
                    ? "border-blue-700 bg-blue-700 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                }`}
              >
                {koreanMonthLabel(month)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard
            label="전체 지출가능금액"
            value={
              budget.totalSpendingBudgetKrw > 0
                ? `${money.format(budget.totalSpendingBudgetKrw)}원`
                : "조회 대기"
            }
            note={`${koreanMonthLabel(budget.budgetMonth)} 정상매출 ÷ 2`}
            tone="blue"
          />
          <SummaryCard
            label="1688 실제 결제"
            value={`${money.format(actual1688Krw)}원`}
            note="상품 + 중국내운임 + 서비스비"
          />
          <SummaryCard
            label="최종비용 전 남은 한도"
            value={`${money.format(remainingBeforeFinalCost)}원`}
            note="국제운송·세금·작업비 입력 전"
            tone="amber"
          />
          <SummaryCard
            label="1688 주문"
            value={`${money.format(purchase?.orderCount ?? 0)}건 · ${money.format(displayedOrderQuantity)}개`}
            note={`${money.format(purchase?.lineCount ?? selectedRows.length)}개 품목 줄`}
          />
          <SummaryCard
            label="입고 추적"
            value={`${money.format(receivedQuantity)} / ${money.format(orderedQuantity)}개`}
            note={`남은 미입고 ${money.format(openQuantity)}개`}
          />
          <SummaryCard
            label="최종 실제지출"
            value={actualOutflowKrw ? `${money.format(actualOutflowKrw)}원` : "마감 전"}
            note={
              forwarderCostKrw
                ? `배송대행 실제비용 ${money.format(forwarderCostKrw)}원`
                : "전량 입고 후 최종 청구액 입력"
            }
            tone={actualOutflowKrw ? "emerald" : "slate"}
          />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-600">
            <span>1688 결제 기준 예산 사용률</span>
            <span>{budgetUsage.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-blue-600"
              style={{ width: `${budgetUsage}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            배송대행지 국제운송·관세·부가세·라벨 작업비가 입력되면 최종 실제지출이 확정됩니다.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <Legend tone="amber">노란색 · 사용자 직접 입력</Legend>
          <Legend tone="blue">파란색 · 자동 계산·원장</Legend>
          <Legend tone="emerald">초록색 · 완료·마감</Legend>
        </div>
      </section>

      {purchase?.unassignedLineCount ? (
        <section className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-950">
          <strong>B-code 미연결 품목 {purchase.unassignedLineCount}건</strong>이 실제 1688 결제에는 포함되어 있지만 입고 원장에는 연결되지 않았습니다. 아래 1688 원가 상세에서 해당 품목을 확인해 B-code를 배정해야 수량·원가·입고가 일치합니다.
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-xs font-black tracking-[0.12em] text-amber-700">
                OPERATOR ACTIONS
              </span>
              <h2 className="mt-1 text-xl font-black text-slate-950">
                지금 해야 할 입력
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                자동 계산값은 건드리지 않고, 노란색 입력칸과 실행 버튼만 처리합니다.
              </p>
            </div>
            <Badge tone={actionNeeded ? "amber" : "emerald"}>
              {actionNeeded ? "작업 필요" : "현재 작업 없음"}
            </Badge>
          </div>

          <div className={`mt-4 space-y-4 ${styles.inputScope}`}>
            <InternalChinaMonthlyClosePanel
              cycleMonth={selectedMonth}
              currentCycleMonth={currentCycleMonth}
              totalSpendingBudgetKrw={budget.totalSpendingBudgetKrw}
              recorded1688SpendKrw={actual1688Krw}
              releasableLineCount={releasableRows.length}
              releasableQuantity={releasableQuantity}
              stored={monthlyClose}
            />

            {costRows.map((row) => {
              const draft = selectedDrafts.find(
                (candidate) => candidate.draftId === row.draftId,
              );
              if (!draft) return null;
              if (!row.summary) {
                return draft.openQuantity > 0 ? (
                  <section
                    key={row.draftId}
                    className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"
                  >
                    <strong>입고 입력용 원가요약 조회가 지연됐습니다.</strong>
                    <p className="mt-1 text-xs leading-5">
                      {row.warning} 원장은 변경되지 않았습니다. 잠시 뒤 새로고침하세요.
                    </p>
                  </section>
                ) : (
                  <InternalChinaForwarderCostFallback
                    key={row.draftId}
                    draftId={row.draftId}
                    cycleMonth={selectedMonth}
                    warning={row.warning}
                  />
                );
              }
              return (
                <InternalChinaReceiptPanel
                  key={row.draftId}
                  draftId={row.draftId}
                  cycleMonth={selectedMonth}
                  forwarderCost={row.summary}
                  lines={draft.lines.map((line) => {
                    const display = metadata.byBarcode[line.barcode];
                    return {
                      barcode: line.barcode,
                      modelNo: display?.modelNo ?? "",
                      modelName: display?.modelName ?? "",
                      saleOption: display?.saleOption ?? "",
                      orderedQuantity: line.orderedQuantity,
                      receivedQuantity: line.receivedQuantity,
                      openQuantity: line.openQuantity,
                      status: line.status,
                    };
                  })}
                />
              );
            })}

            {currentFundingTarget?.summary?.actualCostKrw ? (
              <InternalChinaFundingClosePanel
                draftId={currentFundingTarget.draftId}
                cycleMonth={selectedMonth}
                totalSpendingBudgetKrw={budget.totalSpendingBudgetKrw}
                actualForwarderCostKrw={currentFundingTarget.summary.actualCostKrw}
                stored={currentFundingStored}
              />
            ) : null}

            {!costRows.length && monthlyClose && !hasOrder ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
                이 달은 실제 1688 주문 없이 발주 사이클이 마감되었습니다. 추가 입고·원가 입력이 없습니다.
              </section>
            ) : null}
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
          <span className="text-xs font-black tracking-[0.12em] text-cyan-300">
            MONTHLY FLOW
          </span>
          <h2 className="mt-1 text-xl font-black">월 처리 단계</h2>
          <div className="mt-5 space-y-3">
            <FlowStep
              number="1"
              title="예산 확정"
              state={budget.totalSpendingBudgetKrw ? "done" : "wait"}
              detail={`${koreanMonthLabel(budget.budgetMonth)} 정상매출 기준`}
            />
            <FlowStep
              number="2"
              title="1688 주문·발주 마감"
              state={monthlyClose ? "done" : hasOrder ? "active" : "wait"}
              detail={
                monthlyClose
                  ? monthlyClose.closeReason
                  : hasOrder
                    ? "실제 주문 기록됨 · 추가 발주 종료 여부 결정"
                    : "주문 또는 무발주 마감 결정"
              }
            />
            <FlowStep
              number="3"
              title="배송대행지 바코드 출력"
              state={receiptDone ? "done" : hasOrder ? "active" : "wait"}
              detail={
                receiptDone
                  ? "입고 단계 통과 · 필요 시 월 주문정보로 다시 출력 가능"
                  : hasOrder
                    ? `${money.format(purchase?.assignedLineCount ?? selectedRows.length)}개 주문 품목 전달 · 온돌패스 주문번호로 B-code 자동연결`
                    : "실주문 후 진행"
              }
              href={
                hasOrder
                  ? `/freight-barcode-request/monthly?month=${encodeURIComponent(selectedMonth)}`
                  : undefined
              }
              actionLabel="바코드 출력으로 이동"
            />
            <FlowStep
              number="4"
              title="입고"
              state={openQuantity ? "active" : receiptDone ? "done" : "wait"}
              detail={
                openQuantity
                  ? `남은 미입고 ${money.format(openQuantity)}개`
                  : receiptDone
                    ? "추적 품목 입고 완료"
                    : "실주문 후 진행"
              }
            />
            <FlowStep
              number="5"
              title="배송대행 실제비용·원가"
              state={forwarderDone ? "done" : receiptDone ? "active" : "wait"}
              detail={
                forwarderDone
                  ? `실제 부대비용 ${money.format(forwarderCostKrw)}원`
                  : receiptDone
                    ? "최종 청구액 직접 입력"
                    : "전량 입고 후 진행"
              }
            />
            <MonthlyPricePanel month={selectedMonth} ready={receiptDone && forwarderDone} />
            <FlowStep
              number="7"
              title="월 자금 마감"
              state={fundingDone ? "done" : forwarderDone ? "active" : "wait"}
              detail={
                fundingDone
                  ? "WorldFirst·한국계좌 마감 완료"
                  : "실제 원가 마감 후 진행"
              }
            />
          </div>
          <p className="mt-5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-xs leading-5 text-slate-300">
            발주 마감 후 배송대행지 바코드 출력에서 해당 월 주문번호·B-code를 온돌패스 신청서와 연결합니다. 이후 입고·실제 원가·가격조정·자금 마감을 계속 진행합니다.
          </p>
        </aside>
      </section>

      <details
        className={`${styles.detailsCard} rounded-2xl border border-blue-200 bg-white shadow-sm`}
      >
        <summary className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              ACTUAL 1688 COST
            </span>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              1688 주문 원가 기록
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {purchase ? (
              <span className="hidden text-right text-xs font-bold leading-5 text-slate-600 lg:block">
                상품 {cny.format(purchase.goodsPaidCny)}위안 · 중국내운임 {cny.format(purchase.domesticChinaFreightCny)}위안
                <br />
                서비스비 {cny.format(purchase.serviceFeeCny)}위안 · 합계 {cny.format(purchase.actualOrderPaidCny)}위안
              </span>
            ) : null}
            <span className={`${styles.detailsChevron} text-lg text-slate-400`}>⌄</span>
          </div>
        </summary>
        <div className="border-t border-blue-100 p-5">
          {purchase ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <MiniCard label="상품대금" value={`${cny.format(purchase.goodsPaidCny)}위안`} />
                <MiniCard label="중국내운임" value={`${cny.format(purchase.domesticChinaFreightCny)}위안`} tone="violet" />
                <MiniCard label="1688 서비스비" value={`${cny.format(purchase.serviceFeeCny)}위안`} tone="violet" />
                <MiniCard label="1688 결제합계" value={`${cny.format(purchase.actualOrderPaidCny)}위안`} tone="blue" />
                <MiniCard label={`내부환율 ${cny.format(purchase.exchangeRateKrwPerCny)}원`} value={`${money.format(purchase.actualOrderPaidKrwAtInternalFx)}원`} tone="blue" />
              </div>
              <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold leading-5 text-blue-950">
                상품대금·중국 내륙운임·1688 서비스비는 분리 저장됩니다. 국제운송·관세·부가세·라벨 작업 등 배송대행지 최종 청구액은 위 사용자 입력 단계에서 별도 마감합니다.
              </p>
              <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-[1180px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 font-bold text-slate-500">
                    <tr>
                      <th className="px-3 py-3">B-code / 상품</th>
                      <th className="px-3 py-3">주문번호</th>
                      <th className="px-3 py-3 text-right">수량</th>
                      <th className="px-3 py-3 text-right">상품대금</th>
                      <th className="px-3 py-3 text-right">중국내운임</th>
                      <th className="px-3 py-3 text-right">서비스비</th>
                      <th className="px-3 py-3 text-right">실제 결제</th>
                      <th className="px-3 py-3">연결</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {purchase.lines.map((line, index) => (
                      <tr key={`${line.draftId}:${line.orderNumber}:${line.barcode}:${index}`}>
                        <td className="px-3 py-3">
                          <strong className="font-mono text-slate-950">
                            {line.barcode}
                          </strong>
                          <span className="mt-1 block text-slate-600">
                            {[line.modelNo, line.modelName, line.chinaOption]
                              .filter(Boolean)
                              .join(" · ") || "상품정보 없음"}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-600">
                          {line.orderNumber || "-"}
                        </td>
                        <td className="px-3 py-3 text-right font-bold">
                          {money.format(line.quantity)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {cny.format(line.goodsPaidCny)}위안
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-blue-700">
                          {cny.format(line.domesticChinaFreightCny)}위안
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-violet-700">
                          {cny.format(line.serviceFeeCny)}위안
                        </td>
                        <td className="px-3 py-3 text-right font-black text-slate-950">
                          {cny.format(line.actualLinePaidCny)}위안
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full border px-2 py-1 text-[11px] font-black ${
                              line.assigned
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-rose-200 bg-rose-50 text-rose-800"
                            }`}
                          >
                            {line.assigned ? "B-code 연결" : "배정 필요"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              선택한 월에 실제 1688 주문 원가 기록이 없습니다.
            </p>
          )}
        </div>
      </details>

      <details
        className={`${styles.detailsCard} rounded-2xl border border-slate-200 bg-white shadow-sm`}
      >
        <summary className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">
              MONTHLY ARCHIVE
            </span>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              월별 마감 이력
            </h2>
          </div>
          <span className={`${styles.detailsChevron} text-lg text-slate-400`}>⌄</span>
        </summary>
        <div className="border-t border-slate-200 p-5">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[1040px] text-left text-xs">
              <thead className="bg-slate-50 font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">발주월</th>
                  <th className="px-3 py-3">발주상태</th>
                  <th className="px-3 py-3 text-right">전체 예산</th>
                  <th className="px-3 py-3 text-right">1688 결제</th>
                  <th className="px-3 py-3 text-right">주문 / 입고 / 미입고</th>
                  <th className="px-3 py-3">실제 원가</th>
                  <th className="px-3 py-3">자금</th>
                  <th className="px-3 py-3">보기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {months.map((month) => {
                  const monthPurchase = purchaseByMonth.get(month);
                  const monthClose = closeByMonth.get(month);
                  const monthRows = ledger.commitments.filter(
                    (row) =>
                      row.sourceSystem === SOURCE_SYSTEM && cycleOf(row) === month,
                  );
                  const monthOrdered = total(monthRows, (row) => row.orderedQuantity);
                  const monthReceived = total(monthRows, (row) => row.receivedQuantity);
                  const monthOpen = total(monthRows, (row) => row.openQuantity);
                  const monthForwarder = forwarderCloses.filter(
                    (row) => row.cycleMonth === month,
                  );
                  const monthFunding = fundingCloses.find(
                    (row) => row.cycleMonth === month,
                  );
                  const monthBudget =
                    monthFunding?.totalSpendingBudgetKrw ||
                    monthClose?.totalSpendingBudgetKrw ||
                    (month === selectedMonth ? budget.totalSpendingBudgetKrw : 0);
                  return (
                    <tr key={month}>
                      <td className="px-3 py-3 font-black text-slate-950">
                        {koreanMonthLabel(month)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full border px-2 py-1 text-[11px] font-black ${
                            monthClose
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                        >
                          {monthClose ? "발주 마감" : "발주 열림"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold">
                        {monthBudget ? `${money.format(monthBudget)}원` : "-"}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-blue-700">
                        {monthPurchase
                          ? `${money.format(monthPurchase.actualOrderPaidKrwAtInternalFx)}원`
                          : "-"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {money.format(monthOrdered)} / {money.format(monthReceived)} / {money.format(monthOpen)}
                      </td>
                      <td className="px-3 py-3">
                        {monthForwarder.length ? (
                          <span className="font-black text-emerald-700">마감</span>
                        ) : monthOrdered > 0 && monthOpen === 0 ? (
                          <span className="font-black text-amber-700">입력 대기</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {monthFunding ? (
                          <span className="font-black text-emerald-700">마감</span>
                        ) : monthForwarder.length ? (
                          <span className="font-black text-amber-700">입력 대기</span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/china-order-manager?month=${month}`}
                          className="font-black text-blue-700 hover:underline"
                        >
                          월 상세
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details
        className={`${styles.detailsCard} rounded-2xl border border-slate-200 bg-white shadow-sm`}
      >
        <summary className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">
              DETAIL LEDGER
            </span>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              {koreanMonthLabel(selectedMonth)} 발주·입고 상세 원장
            </h2>
          </div>
          <span className={`${styles.detailsChevron} text-lg text-slate-400`}>⌄</span>
        </summary>
        <div className="border-t border-slate-200 p-5">
          <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>원장 줄 {money.format(selectedRows.length)}건</span>
            <span>이벤트 중복 {money.format(ledger.duplicateEventCount)}건</span>
            <span>형식 제외 {money.format(ledger.invalidEventCount)}건</span>
          </div>
          <div className="max-h-[660px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[1050px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">B-code / 원본 줄</th>
                  <th className="px-3 py-3">상태</th>
                  <th className="px-3 py-3 text-right">요청</th>
                  <th className="px-3 py-3 text-right">실주문</th>
                  <th className="px-3 py-3 text-right">정상입고</th>
                  <th className="px-3 py-3 text-right">취소·해제</th>
                  <th className="px-3 py-3 text-right">남은 미입고</th>
                  <th className="px-3 py-3">최근 갱신</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedRows.length ? (
                  selectedRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-3">
                        <strong className="font-mono text-slate-950">
                          {row.barcode}
                        </strong>
                        <span className="mt-1 block max-w-sm truncate text-slate-500">
                          {row.sourceLineId}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${statusTone(row.status)}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        {money.format(row.requestedQuantity)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        {money.format(row.orderedQuantity)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        {money.format(row.receivedQuantity)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        {money.format(row.cancelledQuantity)}
                      </td>
                      <td className="px-3 py-3 text-right font-black text-blue-700">
                        {money.format(row.openQuantity)}
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {new Date(row.updatedAt).toLocaleString("ko-KR")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                      선택한 월의 발주·입고 원장 줄이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {warnings.length ? (
        <details
          className={`${styles.detailsCard} rounded-xl border border-amber-200 bg-amber-50`}
        >
          <summary className="flex items-center justify-between gap-3 px-4 py-3 text-xs font-black text-amber-900">
            <span>시스템 조회 경고 {warnings.length}건</span>
            <span className={styles.detailsChevron}>⌄</span>
          </summary>
          <div className="border-t border-amber-200 px-4 py-3 text-xs leading-5 text-amber-900">
            {warnings.slice(0, 8).join(" · ")}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "blue" | "amber" | "emerald";
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>
      {children}
    </span>
  );
}

function Legend({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "blue" | "amber" | "emerald";
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <span className={`rounded-full border px-3 py-1.5 ${className}`}>
      {children}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  note,
  tone = "slate",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "slate" | "blue" | "amber" | "emerald";
}) {
  const className =
    tone === "blue"
      ? "border-blue-200 bg-blue-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "emerald"
          ? "border-emerald-200 bg-emerald-50"
          : "border-slate-200 bg-white";
  return (
    <article className={`rounded-xl border p-4 ${className}`}>
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <strong className="mt-1 block break-words text-lg font-black text-slate-950">
        {value}
      </strong>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{note}</p>
    </article>
  );
}

function MiniCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "blue" | "violet";
}) {
  const className =
    tone === "blue"
      ? "border-blue-200 bg-blue-50"
      : tone === "violet"
        ? "border-violet-200 bg-violet-50"
        : "border-slate-200 bg-white";
  return (
    <article className={`rounded-xl border p-3 ${className}`}>
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <strong className="mt-1 block text-base font-black text-slate-950">
        {value}
      </strong>
    </article>
  );
}

function FlowStep({
  number,
  title,
  state,
  detail,
  href,
  actionLabel,
}: {
  number: string;
  title: string;
  state: "done" | "active" | "wait";
  detail: string;
  href?: string;
  actionLabel?: string;
}) {
  const marker =
    state === "done"
      ? "bg-emerald-400 text-emerald-950"
      : state === "active"
        ? "bg-amber-300 text-amber-950"
        : "bg-slate-700 text-slate-300";
  const border =
    state === "done"
      ? "border-emerald-900/60"
      : state === "active"
        ? "border-amber-800/60"
        : "border-slate-800";
  return (
    <div className={`flex gap-3 rounded-xl border bg-slate-900 p-3 ${border}`}>
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg text-sm font-black ${marker}`}>
        {state === "done" ? "✓" : number}
      </span>
      <div className="min-w-0 flex-1">
        <strong className="text-sm text-white">{title}</strong>
        <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
        {href && actionLabel ? (
          <Link
            href={href}
            className="mt-2 inline-flex rounded-lg border border-cyan-500/60 bg-cyan-400/10 px-3 py-1.5 text-xs font-black text-cyan-200 hover:bg-cyan-400/20"
          >
            {actionLabel} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
