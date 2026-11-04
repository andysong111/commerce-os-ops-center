import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadMonthlyPurchaseCycleGate } from "@/lib/monthlyPurchaseCycleGate";
import { koreanMonthLabel } from "@/lib/monthlyPurchasePolicy";
import { loadProductDecisionLiveStatus } from "@/lib/productDecisionLiveRefresh";
import { LiveRefreshControl } from "./LiveRefreshControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductDecisionLiveRefreshPage() {
  const [status, monthlyPolicy] = await Promise.all([
    loadProductDecisionLiveStatus().catch((error) => ({
      configured: false,
      requestId: null,
      state: "IDLE" as const,
      stage: "status-error",
      message:
        error instanceof Error
          ? error.message
          : "월간 발주 계산 상태를 불러오지 못했습니다.",
      targetDate: null,
      previousPurchaseRunStartDate: null,
      collectionMode: null,
      analysisAsOf: null,
      planningGeneratedAt: null,
      orderCompleted: 0,
      orderTotal: 0,
      claimCompleted: 0,
      claimTotal: 0,
      progress: 0,
      finalSnapshot: null,
      comparison: null,
      error:
        error instanceof Error
          ? error.message
          : "월간 발주 계산 상태를 불러오지 못했습니다.",
    })),
    loadMonthlyPurchaseCycleGate().catch(() => ({
      cycleMonth: "",
      budgetMonth: "",
      locked: false,
      existingRequestId: null,
      existingCreatedAt: null,
    })),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · 월간 발주 추천"
        title="월간 발주안 계산"
        description="발주 추천은 정산주기와 현금흐름을 맞추기 위해 월 1회만 생성합니다. 매월 새 발주차시는 직전 달력월 1일~말일 정상매출을 기준으로 상품대금 예산을 고정하고, 최근 판매·재고·미입고를 반영해 수량을 계산합니다."
        actions={
          <Link
            href="/product-decision-agent"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            발주 추천으로 돌아가기
          </Link>
        }
      />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <strong className="block text-base">업무 주기 분리</strong>
        <p className="mt-2 leading-6">
          <b>발주 추천</b>은 {monthlyPolicy.cycleMonth ? koreanMonthLabel(monthlyPolicy.cycleMonth) : "이번 달"}에 1회만 생성하고,
          예산은 {monthlyPolicy.budgetMonth ? koreanMonthLabel(monthlyPolicy.budgetMonth) : "직전 달"} 달력월 매출로 고정합니다.
          반면 <b>상품등급·가격조정</b>은 판매이력을 계속 누적해 매일 다시 판단할 수 있으며 월간 발주 잠금과 연결하지 않습니다.
        </p>
        <p className="mt-2 text-xs text-emerald-800">
          실제 1688 주문·결제·중국 전송·재고변경은 이 계산 화면에서 실행하지 않습니다.
        </p>
      </section>

      <LiveRefreshControl initialStatus={status} initialPolicy={monthlyPolicy} />
    </div>
  );
}
