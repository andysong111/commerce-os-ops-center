import { InternalChinaFundingClosePanel } from "@/components/china-order-manager/InternalChinaFundingClosePanel";
import type { InternalChinaForwarderCostSummary } from "@/lib/internalChinaForwarderCost";
import {
  internalChinaFundingCloseMatchesForwarder,
  loadInternalChinaFundingClose,
  type InternalChinaFundingCloseSummary,
} from "@/lib/internalChinaFundingClose";
import {
  koreanMonthLabel,
  previousCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";

const number = new Intl.NumberFormat("ko-KR");

type MonthlyClose = {
  cycleMonth: string;
  productPurchaseCostKrw: number;
  domesticChinaFreightKrw: number;
  actualCostKrw: number;
  actualTotalOutflowKrw: number;
  closedAt: string | null;
};

type MonthlyBudget = {
  cycleMonth: string;
  budgetMonth: string;
  budgetMonthRevenueKrw: number;
  totalSpendingBudgetKrw: number;
  remainingAfterSpendKrw: number;
  budgetOverKrw: number;
  utilizationPercent: number;
  available: boolean;
};

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function purchaseIncludingChinaFreight(summary: MonthlyClose) {
  return summary.productPurchaseCostKrw + summary.domesticChinaFreightKrw;
}

function totalOutflow(summary: MonthlyClose) {
  return summary.actualTotalOutflowKrw;
}

function inclusiveMultiplier(summary: MonthlyClose) {
  const purchase = purchaseIncludingChinaFreight(summary);
  return purchase > 0 ? totalOutflow(summary) / purchase : null;
}

function aggregateByCycleMonth(
  summaries: InternalChinaForwarderCostSummary[],
): MonthlyClose[] {
  const byMonth = new Map<string, MonthlyClose>();
  for (const summary of summaries) {
    const existing = byMonth.get(summary.cycleMonth);
    const rowTotalOutflow =
      summary.actualTotalOutflowKrw ??
      summary.productPurchaseCostKrw +
        summary.domesticChinaFreightKrw +
        (summary.actualCostKrw ?? 0);
    if (!existing) {
      byMonth.set(summary.cycleMonth, {
        cycleMonth: summary.cycleMonth,
        productPurchaseCostKrw: summary.productPurchaseCostKrw,
        domesticChinaFreightKrw: summary.domesticChinaFreightKrw,
        actualCostKrw: summary.actualCostKrw ?? 0,
        actualTotalOutflowKrw: rowTotalOutflow,
        closedAt: summary.closedAt ?? null,
      });
      continue;
    }
    existing.productPurchaseCostKrw += summary.productPurchaseCostKrw;
    existing.domesticChinaFreightKrw += summary.domesticChinaFreightKrw;
    existing.actualCostKrw += summary.actualCostKrw ?? 0;
    existing.actualTotalOutflowKrw += rowTotalOutflow;
    if (
      summary.closedAt &&
      (!existing.closedAt || Date.parse(summary.closedAt) > Date.parse(existing.closedAt))
    ) {
      existing.closedAt = summary.closedAt;
    }
  }
  return [...byMonth.values()].sort((left, right) =>
    right.cycleMonth.localeCompare(left.cycleMonth),
  );
}

async function loadMonthlyBudget(close: MonthlyClose): Promise<MonthlyBudget> {
  const budgetMonth = previousCalendarMonth(close.cycleMonth);
  try {
    const revenue = await loadCalendarMonthNormalRevenue(budgetMonth);
    const budgetMonthRevenueKrw = money(revenue.revenueKrw);
    const totalSpendingBudgetKrw = money(budgetMonthRevenueKrw / 2);
    const spentKrw = totalOutflow(close);
    const remainingAfterSpendKrw = Math.max(
      0,
      totalSpendingBudgetKrw - spentKrw,
    );
    const budgetOverKrw = Math.max(0, spentKrw - totalSpendingBudgetKrw);
    const utilizationPercent =
      totalSpendingBudgetKrw > 0
        ? Math.round((spentKrw / totalSpendingBudgetKrw) * 10_000) / 100
        : 0;
    return {
      cycleMonth: close.cycleMonth,
      budgetMonth,
      budgetMonthRevenueKrw,
      totalSpendingBudgetKrw,
      remainingAfterSpendKrw,
      budgetOverKrw,
      utilizationPercent,
      available: budgetMonthRevenueKrw > 0 && totalSpendingBudgetKrw > 0,
    };
  } catch {
    return {
      cycleMonth: close.cycleMonth,
      budgetMonth,
      budgetMonthRevenueKrw: 0,
      totalSpendingBudgetKrw: 0,
      remainingAfterSpendKrw: 0,
      budgetOverKrw: 0,
      utilizationPercent: 0,
      available: false,
    };
  }
}

export async function InternalChinaForwarderCloseHistory({
  summaries,
}: {
  summaries: InternalChinaForwarderCostSummary[];
}) {
  if (!summaries.length) return null;
  const monthlyCloses = aggregateByCycleMonth(summaries);
  const [budgets, fundingPairs] = await Promise.all([
    Promise.all(monthlyCloses.map(loadMonthlyBudget)),
    Promise.all(
      summaries.map(async (summary) => ({
        draftId: summary.draftId,
        cycleMonth: summary.cycleMonth,
        fundingClose: await loadInternalChinaFundingClose(summary.draftId).catch(
          () => null,
        ),
      })),
    ),
  ]);
  const budgetByMonth = new Map(budgets.map((budget) => [budget.cycleMonth, budget]));
  const fundingByCycleMonth = new Map<string, InternalChinaFundingCloseSummary>();
  for (const pair of fundingPairs) {
    if (pair.fundingClose) fundingByCycleMonth.set(pair.cycleMonth, pair.fundingClose);
  }
  const latest = monthlyCloses[0];
  const latestBudget = budgetByMonth.get(latest.cycleMonth);
  const latestSummary = summaries.find(
    (summary) => summary.cycleMonth === latest.cycleMonth,
  );
  const latestFundingClose = fundingByCycleMonth.get(latest.cycleMonth) ?? null;
  const purchase = purchaseIncludingChinaFreight(latest);
  const multiplier = inclusiveMultiplier(latest);
  const fundingHistory = monthlyCloses
    .map((close) => fundingByCycleMonth.get(close.cycleMonth) ?? null)
    .filter((row): row is InternalChinaFundingCloseSummary => Boolean(row));

  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-indigo-700">
            RECENT LANDED COST CLOSE
          </span>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            최근 마감 원가 · {koreanMonthLabel(latest.cycleMonth)}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            월별 전체 지출가능금액·실제 총지출·사용 후 남은금액과 상품대금·중국내운임·실제 부대비용을 함께 확인합니다.
          </p>
        </div>
        <span className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-black text-indigo-800">
          {latest.closedAt
            ? `마감 ${new Date(latest.closedAt).toLocaleString("ko-KR")}`
            : "마감 완료"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
        <Metric label="상품대금" value={`${number.format(latest.productPurchaseCostKrw)}원`} />
        <Metric
          label="월 전체 지출가능금액"
          value={
            latestBudget?.available
              ? `${number.format(latestBudget.totalSpendingBudgetKrw)}원`
              : "조회 대기"
          }
          emphasized
        />
        <Metric
          label="사용 후 남은금액"
          value={
            latestBudget?.available
              ? latestBudget.budgetOverKrw > 0
                ? `초과 ${number.format(latestBudget.budgetOverKrw)}원`
                : `${number.format(latestBudget.remainingAfterSpendKrw)}원`
              : "조회 대기"
          }
          emphasized
        />
        <Metric label="중국내운임" value={`${number.format(latest.domesticChinaFreightKrw)}원`} />
        <Metric
          label="매입금액(중국내운임 포함)"
          value={`${number.format(purchase)}원`}
        />
        <Metric
          label="실제 부대비용"
          value={`${number.format(latest.actualCostKrw)}원`}
        />
        <Metric label="실제 총지출" value={`${number.format(totalOutflow(latest))}원`} />
        <Metric
          label="중국내운임 포함 배수"
          value={multiplier === null ? "-" : multiplier.toFixed(4)}
        />
      </div>

      <p className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-bold leading-5 text-indigo-950">
        월 전체 지출가능금액 = 직전 달력월 정상매출 ÷ 2. 실제 총지출 = 상품대금 + 중국내운임 + 실제 부대비용이며, 사용 후 남은금액 = 전체 지출가능금액 - 실제 총지출입니다. 내부 1.45 주문비용 배수를 이용한 상품대금 배분은 발주안 계산에 그대로 유지하고, 이 마감 원가 카드에서는 실제 현금지출 한도를 기준으로 보여줍니다. 표시 배수 = (상품대금 + 중국내운임 + 실제 부대비용) ÷ (상품대금 + 중국내운임). 기존 내부 원가배수 저장값은 변경하지 않고 조회용으로 분리 표시합니다.
      </p>

      {latestSummary && latestBudget?.available && (latestSummary.actualCostKrw ?? 0) > 0 ? (
        <InternalChinaFundingClosePanel
          draftId={latestSummary.draftId}
          cycleMonth={latestSummary.cycleMonth}
          totalSpendingBudgetKrw={latestBudget.totalSpendingBudgetKrw}
          actualForwarderCostKrw={latestSummary.actualCostKrw ?? 0}
          actualTotalOutflowKrw={latestSummary.actualTotalOutflowKrw ?? 0}
          stored={latestFundingClose}
          fundingEvidenceComplete={internalChinaFundingCloseMatchesForwarder(
            latestFundingClose,
            latestSummary,
          )}
        />
      ) : null}

      {fundingHistory.length ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-200 bg-white">
          <div className="border-b border-emerald-100 px-4 py-3">
            <h3 className="text-sm font-black text-emerald-950">월 자금 마감 이력</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              WorldFirst 송금은 자금이동으로, 기말잔고는 원통화로, 한국계좌 잔액은 비상금 적립으로 기록합니다.
            </p>
          </div>
          <table className="min-w-[1180px] text-left text-xs">
            <thead className="bg-emerald-50 font-bold text-slate-600">
              <tr>
                <th className="px-3 py-3">발주월</th>
                <th className="px-3 py-3 text-right">전체 지출가능</th>
                <th className="px-3 py-3 text-right">실제 총지출</th>
                <th className="px-3 py-3 text-right">WorldFirst 송금</th>
                <th className="px-3 py-3 text-right">WF 기말 USD</th>
                <th className="px-3 py-3 text-right">WF 기말 CNH</th>
                <th className="px-3 py-3 text-right">한국계좌 배정</th>
                <th className="px-3 py-3 text-right">한국계좌 지출</th>
                <th className="px-3 py-3 text-right">비상금 적립</th>
                <th className="px-3 py-3">마감시각</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fundingHistory.map((row) => (
                <tr key={row.draftId}>
                  <td className="px-3 py-3 font-black text-slate-950">
                    {koreanMonthLabel(row.cycleMonth)}
                  </td>
                  <td className="px-3 py-3 text-right font-bold">
                    {number.format(row.totalSpendingBudgetKrw)}원
                  </td>
                  <td className="px-3 py-3 text-right font-bold">
                    {number.format(row.actualTotalOutflowKrw)}원
                  </td>
                  <td className="px-3 py-3 text-right">
                    {number.format(row.worldFirstTransferKrw)}원
                  </td>
                  <td className="px-3 py-3 text-right">
                    {row.worldFirstEndingUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {row.worldFirstEndingCnh.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {number.format(row.koreaAccountAvailableKrw)}원
                  </td>
                  <td className="px-3 py-3 text-right">
                    {number.format(row.koreaAccountSpentKrw)}원
                  </td>
                  <td className="px-3 py-3 text-right font-black text-emerald-700">
                    {number.format(row.emergencyReserveTransferKrw)}원
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    {new Date(row.closedAt).toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-[1640px] text-left text-xs">
          <thead className="bg-slate-50 font-bold text-slate-500">
            <tr>
              <th className="px-3 py-3">발주월</th>
              <th className="px-3 py-3">예산 기준월</th>
              <th className="px-3 py-3 text-right">기준 정상매출</th>
              <th className="px-3 py-3 text-right">전체 지출가능금액</th>
              <th className="px-3 py-3 text-right">실제 총지출</th>
              <th className="px-3 py-3 text-right">사용 후 남은금액</th>
              <th className="px-3 py-3 text-right">지출 사용률</th>
              <th className="px-3 py-3 text-right">상품대금</th>
              <th className="px-3 py-3 text-right">중국내운임</th>
              <th className="px-3 py-3 text-right">운임포함 매입금액</th>
              <th className="px-3 py-3 text-right">실제 부대비용</th>
              <th className="px-3 py-3 text-right">운임포함 배수</th>
              <th className="px-3 py-3">마감시각</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {monthlyCloses.map((summary) => {
              const rowPurchase = purchaseIncludingChinaFreight(summary);
              const rowMultiplier = inclusiveMultiplier(summary);
              const budget = budgetByMonth.get(summary.cycleMonth);
              return (
                <tr key={summary.cycleMonth}>
                  <td className="px-3 py-3 font-black text-slate-950">
                    {koreanMonthLabel(summary.cycleMonth)}
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {budget ? koreanMonthLabel(budget.budgetMonth) : "-"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {budget?.available ? `${number.format(budget.budgetMonthRevenueKrw)}원` : "-"}
                  </td>
                  <td className="px-3 py-3 text-right font-black text-indigo-700">
                    {budget?.available ? `${number.format(budget.totalSpendingBudgetKrw)}원` : "-"}
                  </td>
                  <td className="px-3 py-3 text-right font-bold">
                    {number.format(totalOutflow(summary))}원
                  </td>
                  <td className="px-3 py-3 text-right font-black text-emerald-700">
                    {budget?.available
                      ? budget.budgetOverKrw > 0
                        ? `초과 ${number.format(budget.budgetOverKrw)}원`
                        : `${number.format(budget.remainingAfterSpendKrw)}원`
                      : "-"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {budget?.available ? `${budget.utilizationPercent.toFixed(1)}%` : "-"}
                  </td>
                  <td className="px-3 py-3 text-right">{number.format(summary.productPurchaseCostKrw)}원</td>
                  <td className="px-3 py-3 text-right">{number.format(summary.domesticChinaFreightKrw)}원</td>
                  <td className="px-3 py-3 text-right font-bold">{number.format(rowPurchase)}원</td>
                  <td className="px-3 py-3 text-right">{number.format(summary.actualCostKrw)}원</td>
                  <td className="px-3 py-3 text-right font-black text-indigo-700">
                    {rowMultiplier === null ? "-" : rowMultiplier.toFixed(4)}
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    {summary.closedAt
                      ? new Date(summary.closedAt).toLocaleString("ko-KR")
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border bg-white p-3 ${
        emphasized ? "border-indigo-300" : "border-slate-200"
      }`}
    >
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <strong
        className={`mt-1 block break-words text-base font-black ${
          emphasized ? "text-indigo-700" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </article>
  );
}
