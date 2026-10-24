import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";
import {
  koreanMonthLabel,
  previousCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import {
  calculateProductOrderBudget,
  DEFAULT_PURCHASE_COST_MULTIPLIER,
} from "@/lib/productDecisionEngine/portfolio";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export async function InternalChinaCurrentPurchaseBudget({
  cycleMonth,
}: {
  cycleMonth: string;
}) {
  const budgetMonth = previousCalendarMonth(cycleMonth);

  try {
    const revenue = await loadCalendarMonthNormalRevenue(budgetMonth);
    const budgetMonthRevenueKrw = Math.max(0, Math.round(revenue.revenueKrw));
    const grossCogsBudgetKrw = Math.max(
      0,
      Math.round(budgetMonthRevenueKrw / 2),
    );
    const productOrderBudgetKrw = calculateProductOrderBudget(
      grossCogsBudgetKrw,
      DEFAULT_PURCHASE_COST_MULTIPLIER,
    );

    return (
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              CURRENT MONTH PURCHASE BUDGET
            </span>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              {koreanMonthLabel(cycleMonth)} 발주 지출가능금액
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {koreanMonthLabel(budgetMonth)} 1일~말일 정상매출에서 에이블리 정상 주문당 무료배송 부담 3,000원을 먼저 뺀 금액을 고정 기준으로 사용합니다. 당월 발주를 조기 마감하거나 현금흐름 사유로 주문량을 줄여도 기준 예산은 숨기지 않습니다.
            </p>
          </div>
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-blue-700">
            예산 기준 확정
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BudgetMetric
            label={`${koreanMonthLabel(budgetMonth)} 발주예산 기준매출`}
            value={`${money.format(budgetMonthRevenueKrw)}원`}
            note={`${revenue.range.start} ~ ${revenue.range.end}${revenue.ablyShippingDeductionKrw > 0 ? ` · 에이블리 ${money.format(revenue.ablyOrderCount)}건 배송비 ${money.format(revenue.ablyShippingDeductionKrw)}원 차감` : ""}`}
          />
          <BudgetMetric
            label="전체 지출가능금액"
            value={`${money.format(grossCogsBudgetKrw)}원`}
            note="배송비 차감 후 기준매출 ÷ 2"
            emphasized
          />
          <BudgetMetric
            label="상품대금 발주한도"
            value={`${money.format(productOrderBudgetKrw)}원`}
            note={`전체 지출가능금액 ÷ ${DEFAULT_PURCHASE_COST_MULTIPLIER.toFixed(2)}`}
          />
          <BudgetMetric
            label="내부 원가배수"
            value={DEFAULT_PURCHASE_COST_MULTIPLIER.toFixed(2)}
            note="배송·부대비용 포함 발주 계산 기준"
          />
        </div>
      </section>
    );
  } catch (error) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
        <strong>{koreanMonthLabel(cycleMonth)} 발주예산을 불러오지 못했습니다.</strong>
        <p className="mt-1 text-xs leading-5">
          {error instanceof Error ? error.message : "MONTHLY_PURCHASE_BUDGET_UNAVAILABLE"}
        </p>
      </section>
    );
  }
}

function BudgetMetric({
  label,
  value,
  note,
  emphasized = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasized?: boolean;
}) {
  return (
    <article className="rounded-xl border border-blue-100 bg-white p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <strong
        className={`mt-1 block text-xl font-black ${
          emphasized ? "text-blue-700" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{note}</p>
    </article>
  );
}
