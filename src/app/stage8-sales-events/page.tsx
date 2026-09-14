import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadProductMasterShoplingSalesEventSyncStatus } from "@/lib/productMasterShoplingSalesEventSync";
import { SalesEventSyncControls } from "./SalesEventSyncControls";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8SalesEventsPage() {
  const status = await loadProductMasterShoplingSalesEventSyncStatus();
  const report = status.report;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · CANONICAL SALES"
        title="정확한 30일 구간 판매 이벤트"
        description="달력 월 원장을 억지로 30일로 환산하지 않고, Shopling 주문행의 실제 주문시각을 Product Master 안정 SKU에 보존해 기존 발주추천의 12×30일 계산을 그대로 재현합니다."
        actions={<Link href="/stage8-readiness" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Stage8 준비도</Link>}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={status.state} />
        <Metric label="수집 구간" value={`${status.completedRanges}/${status.totalRanges}`} />
        <Metric label="진행률" value={`${status.progress}%`} />
        <Metric label="주문 이벤트" value={report ? number.format(report.sourceEventCount) : "-"} />
        <Metric label="취소·반품 tombstone" value={report ? number.format(report.tombstoneCount) : "-"} />
        <Metric label="차단" value={number.format(status.blockerCount)} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">{status.stage}</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">{status.message}</p>
          </div>
          <SalesEventSyncControls state={status.state} requestId={status.requestId} planFingerprint={report?.planFingerprint ?? null} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          후보 분석시점: {status.analysisAsOf ? new Date(status.analysisAsOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "아직 없음"} (한국시간).
          재수집 접수는 공식 판매원장 반영 완료가 아닙니다. 새 후보의 비교·근거 검증과 정상 반영 게이트를 다시 확인해야 합니다.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm font-semibold text-slate-700">
          <Link href="/stage8-candidate-demand-parity">후보 비교 검증</Link>
          <Link href="/stage8-candidate-promotion-gate">공식 반영 게이트</Link>
          <Link href="/china-order-manager/reentry-shadow">다음 발주 사전 점검</Link>
        </div>
        {status.state === "STORAGE_NOT_READY" ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Product Master의 `202608080001_sku_sales_events.sql`을 기존 Product Master Supabase에 정확히 한 번 적용해야 다음 카나리 단계로 진행됩니다.
          </div>
        ) : null}
      </section>

      {report ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">수집 결과</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Shopling 읽은 행" value={number.format(report.fetchedRows)} />
            <Metric label="유효 판매행" value={number.format(report.validEventCount)} />
            <Metric label="미연결" value={number.format(report.unmappedRows)} />
            <Metric label="identity 충돌" value={number.format(report.identityConflictCount)} />
            <Metric label="기본재고 판매수량" value={number.format(report.totalBaseUnits)} />
            <Metric label="판매매출" value={`${number.format(report.totalRevenue)}원`} />
            <Metric label="중복행" value={number.format(report.duplicateRows)} />
            <Metric label="무관·제외행" value={number.format(report.ignoredRows)} />
          </div>
          <p className="mt-4 break-all text-xs text-slate-400">event {report.eventFingerprint}</p>
          <p className="mt-1 break-all text-xs text-slate-400">plan {report.planFingerprint}</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>안전 규칙</strong> · 수집 단계는 Shopling GET만 사용합니다. Product Master 적재는 migration 적용 뒤 1건 카나리 → 같은 plan fingerprint 전수 적재 순서로만 진행합니다. 실제 발주·가격·단종·재고는 변경하지 않습니다.
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg text-slate-950">{value}</strong>
    </article>
  );
}
