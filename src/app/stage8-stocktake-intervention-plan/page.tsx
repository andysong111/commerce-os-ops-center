import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadStocktakeInterventionPlan } from "@/lib/stage8StocktakeInterventionPlan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function StocktakeInterventionPlanPage() {
  let plan: Awaited<ReturnType<typeof loadStocktakeInterventionPlan>> | null = null;
  let error: string | null = null;
  try {
    plan = await loadStocktakeInterventionPlan();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "실사 개입 계획을 읽지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · MINIMUM HUMAN INTERVENTION"
        title="선택형 재고보정 후보"
        description="발주사이클은 PROVISIONAL 추정재고로 계속 진행하며 재고실사를 요구하지 않습니다. 이 화면은 재고 불일치가 생겼을 때만 사용할 선택형 STOCKTAKE 후보를 보여주고, 실제 재고·발주는 변경하지 않습니다."
        actions={
          <Link
            href="/stage8-legacy-verified-cost-readiness"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            발주전용 원가 신뢰도
          </Link>
        }
      />

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : plan ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="상태" value={plan.state} />
            <Metric label="전체 발주후보" value={plan.purchaseCandidateCount} />
            <Metric label="비용신뢰 후보" value={plan.costTrustedCandidateCount} good />
            <Metric label="보정 후보 SKU" value={plan.eligibleStocktakeCount} good />
            <Metric
              label="80% 최소묶음"
              value={plan.minimalPriorityCountFor80PctTrustedSpend}
            />
            <Metric label="실제 write" value="0 · READ ONLY" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="첫 canary" value={plan.firstCanaryBarcode ?? "없음"} good />
            <MoneyMetric
              label="비용신뢰 전체 보수금액"
              value={plan.totalEligibleConservativeSpend}
            />
            <MoneyMetric
              label="80% 최소묶음 보수금액"
              value={plan.minimalPrioritySpendCoverage}
            />
            <Metric label="선택 입력" value="오류 교정 시 수량" />
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="text-lg font-black text-emerald-950">
              발주사이클의 필수 단계가 아닙니다
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">{plan.message}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-emerald-900">
              <span className="rounded-full bg-white px-3 py-1">
                STOCKTAKE write {String(plan.stocktakeWritesEnabled)}
              </span>
              <span className="rounded-full bg-white px-3 py-1">
                PURCHASE write {String(plan.purchaseWritesEnabled)}
              </span>
              <span className="rounded-full bg-white px-3 py-1">
                선택형 입력 physicalQuantity 1개
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">선택형 보정 후보</h2>
                <p className="mt-1 text-sm text-slate-500">
                  실제 품절은 SOLD_OUT_RESET=0으로 기준을 만들고 이후 중국 확정입고와 판매를 누적합니다. 아래 순서는 예외적으로 실사가 필요한 경우에만 사용합니다.
                </p>
              </div>
              <span className="break-all text-xs text-slate-400">{plan.planFingerprint}</span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1120px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-3 py-3">순서</th>
                    <th className="px-3 py-3">B-code</th>
                    <th className="px-3 py-3">상품</th>
                    <th className="px-3 py-3">구분</th>
                    <th className="px-3 py-3">원가 신뢰</th>
                    <th className="px-3 py-3">보수 원가</th>
                    <th className="px-3 py-3">발주 권장</th>
                    <th className="px-3 py-3">보수 발주금액</th>
                    <th className="px-3 py-3">현재 재고상태</th>
                    <th className="px-3 py-3">사람 입력</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.rows.map((row) => (
                    <tr key={row.barcode} className={row.canary ? "bg-emerald-50" : ""}>
                      <td className="px-3 py-3 font-bold">{row.sequence}</td>
                      <td className="px-3 py-3 font-mono text-xs font-black">{row.barcode}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-400">{row.modelNo ?? "-"}</div>
                      </td>
                      <td className="px-3 py-3 text-xs font-black text-emerald-800">
                        {row.canary ? "선택형 CANARY" : "예외 보정"}
                      </td>
                      <td className="px-3 py-3 text-xs">{row.purchaseCostTrustSource}</td>
                      <td className="px-3 py-3">{number.format(row.purchaseUnitCostKrw)}원</td>
                      <td className="px-3 py-3">{number.format(row.recommendedQty)}</td>
                      <td className="px-3 py-3">{number.format(row.conservativeExpectedCost)}원</td>
                      <td className="px-3 py-3 text-xs">{row.inventoryState}</td>
                      <td className="px-3 py-3 text-xs font-bold">선택 입력</td>
                    </tr>
                  ))}
                  {!plan.rows.length ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-10 text-center text-slate-500">
                        현재 안전하게 요청할 실사 후보가 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  good = false,
}: {
  label: string;
  value: string | number;
  good?: boolean;
}) {
  return (
    <article className={`rounded-xl border p-4 ${good ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}

function MoneyMetric({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">{number.format(value)}원</strong>
    </article>
  );
}
