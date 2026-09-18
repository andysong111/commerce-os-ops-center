import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadPurchaseCycleProgress } from "@/lib/purchaseCycleProgress";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const labels = {
  DONE: "완료",
  RUNNING: "자동 진행",
  WAITING: "대기",
  BLOCKED: "확인 필요",
  OWNER_ACTION: "승인 필요",
} as const;

export default async function PurchaseCycleProgressPage() {
  const report = await loadPurchaseCycleProgress();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · PURCHASE CYCLE"
        title="발주사이클 진행상황"
        description="판매근거 수집부터 Product Master 검증, 원가·재고·발주 Shadow, 소량 발주 미리보기까지 현재 위치와 사람 개입이 필요한 지점만 한 화면에서 확인합니다. 이 화면 자체는 어떤 업무 쓰기도 실행하지 않습니다."
        actions={
          <Link href="/purchase-cycle-preflight" className="rounded-xl border px-4 py-2.5 text-sm font-bold">
            발주 사전점검
          </Link>
        }
      />

      <section className={`rounded-2xl border p-5 ${
        report.operatorActionRequired
          ? "border-amber-300 bg-amber-50"
          : "border-emerald-200 bg-emerald-50"
      }`}>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
          CURRENT HANDOFF
        </p>
        <h2 className="mt-2 text-xl font-black text-slate-950">
          {report.operatorActionRequired
            ? report.operatorAction
            : report.state === "AUTOMATIC_PROGRESS"
              ? "현재 사람 개입 없이 자동 진행 중"
              : "자동 근거 준비 완료 · 실제 실행은 별도 승인"}
        </h2>
        {report.operatorActionRequired && report.operatorHref ? (
          <Link href={report.operatorHref} className="mt-4 inline-block rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">
            필요한 확인 화면 열기
          </Link>
        ) : null}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-black">구간별 상태</h2>
        <div className="mt-4 space-y-3">
          {report.stages.map((item) => (
            <Link key={item.number} href={item.href} className="grid gap-2 rounded-xl border p-4 md:grid-cols-[80px_1fr_120px] md:items-center">
              <strong>{item.number}구간</strong>
              <div>
                <p className="font-bold">{item.label}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p>
              </div>
              <span className="text-sm font-black">{labels[item.state]}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>안전 경계</strong>
        <p>
          자동화는 읽기·비교·근거 생성까지만 이어집니다. CANARY, FULL, 실제 발주·결제는 각각의 명시적 승인 게이트를 넘기 전에는 실행되지 않습니다.
        </p>
        <p className="mt-2">조회 시각 {new Date(report.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
      </section>

      <details className="rounded-2xl border p-5 text-xs">
        <summary className="font-bold">원본 추적 정보</summary>
        <p className="mt-3 break-all">판매 요청 {report.source.salesRequestId ?? "-"}</p>
        <p className="mt-2">판매 상태 {report.source.salesState} · 진행률 {report.source.salesProgress}%</p>
        <p className="mt-2 break-all">판매 plan {report.source.salesPlanFingerprint ?? "-"}</p>
        <p className="mt-2">parity {report.source.parityState ?? "-"} · evidence {report.source.evidenceState ?? "-"} · promotion {report.source.promotionState ?? "-"}</p>
        <p className="mt-2">reconciliation {report.source.reconciliationState ?? "-"} · purchase evidence {report.source.purchaseEvidenceState ?? "-"}</p>
      </details>
    </div>
  );
}
