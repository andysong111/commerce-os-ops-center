import Link from "next/link";
import { InternalChinaCashEnvelopePanel } from "@/components/china-order-manager/InternalChinaCashEnvelopePanel";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaMonthlyPurchaseClose } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import {
  koreanMonthLabel,
  previousCalendarMonth,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export default async function CashEnvelopePurchasePage() {
  const currentCycleMonth = seoulCalendarMonth(new Date());
  const budgetMonth = previousCalendarMonth(currentCycleMonth);
  const [revenueResult, purchase, monthlyClose] = await Promise.all([
    loadCalendarMonthNormalRevenue(budgetMonth)
      .then((value) => ({ revenueKrw: Math.max(0, Math.round(value.revenueKrw)), error: "" }))
      .catch((error) => ({
        revenueKrw: 0,
        error: error instanceof Error ? error.message : "MONTHLY_BUDGET_UNAVAILABLE",
      })),
    loadInternalChinaMonthlyPurchaseSummary(currentCycleMonth).catch(() => null),
    loadInternalChinaMonthlyPurchaseClose(currentCycleMonth).catch(() => null),
  ]);
  const maxGrossBudgetKrw = Math.round(revenueResult.revenueKrw / 2);
  const recorded1688SpendKrw =
    purchase?.actualOrderPaidKrwAtInternalFx ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · PURCHASE V2 · CASH CONSTRAINT"
        title="현금 제약 발주 V2"
        description="품절로 못 판 수요를 복원하고, 가격변동·성장형·핵심 안정형·44일 목표수요·추정 또는 정확재고·중국 미입고를 반영합니다. 실제 현금 안에서 14일 긴급 → 안정형 → 성장형 → 44일 완성 순으로 배분합니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/china-order-manager/stock-control"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              재고·품절 기준점
            </Link>
            <Link
              href="/fast-purchase-mvp"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              V1 비교화면
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <span className="text-[11px] font-bold text-slate-500">발주월</span>
          <strong className="mt-1 block text-lg font-black text-slate-950">
            {koreanMonthLabel(currentCycleMonth)}
          </strong>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            실제 주문일에 계산하고 예산확정
          </p>
        </article>
        <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <span className="text-[11px] font-bold text-slate-500">전체 지출가능금액</span>
          <strong className="mt-1 block text-lg font-black text-slate-950">
            {maxGrossBudgetKrw > 0 ? `${money.format(maxGrossBudgetKrw)}원` : "조회 대기"}
          </strong>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {koreanMonthLabel(budgetMonth)} 에이블리 배송비 차감 후 정상매출 ÷ 2
          </p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-[11px] font-bold text-slate-500">발주 상태</span>
          <strong className="mt-1 block text-lg font-black text-slate-950">
            {monthlyClose ? "발주 마감" : "발주 열림"}
          </strong>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {monthlyClose
              ? "기존 확정안·주문·입고 원장만 유지"
              : "계산 → 검토 → 예산확정 → 1688 주문"}
          </p>
        </article>
      </section>

      {revenueResult.error ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          전체 지출가능금액 조회가 지연됐습니다. {revenueResult.error}
        </section>
      ) : null}

      <InternalChinaCashEnvelopePanel
        cycleMonth={currentCycleMonth}
        currentCycleMonth={currentCycleMonth}
        maxGrossBudgetKrw={maxGrossBudgetKrw}
        recorded1688SpendKrw={recorded1688SpendKrw}
        monthlyClosed={Boolean(monthlyClose)}
      />

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        <strong className="text-slate-950">운영 경계</strong>
        <p className="mt-1">
          MOQ와 박스입수는 발주수량 계산에서 사용하지 않습니다. 품목당 5,000원 미만은 수량을 억지로 늘리지 않고 소액 검토로 분리합니다. 계산만으로는 주문되지 않으며, 예산확정한 불변 스냅샷만 1688 주문·발주마감 단계에 전달됩니다.
        </p>
      </section>
    </div>
  );
}
