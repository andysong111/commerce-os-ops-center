import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadStocktakeCanaryPreflight } from "@/lib/stage8StocktakeCanaryPreflight";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function StocktakeCanaryPreflightPage() {
  let report: Awaited<ReturnType<typeof loadStocktakeCanaryPreflight>> | null = null;
  let error: string | null = null;
  try {
    report = await loadStocktakeCanaryPreflight();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "STOCKTAKE canary 사전검증을 읽지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · STOCKTAKE CANARY PREFLIGHT"
        title="선택형 재고보정 1건 사전검증"
        description="발주사이클은 실사 없이 PROVISIONAL 추정재고로 계속 진행합니다. 이 화면은 재고 오류를 교정해야 할 때만 선택적으로 사용할 1건 STOCKTAKE 경로를 확인하며, 어떤 값도 저장하지 않습니다."
        actions={
          <Link
            href="/stage8-stocktake-intervention-plan"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            선택형 보정 후보
          </Link>
        }
      />

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="상태" value={report.state} good={report.state === "READY_FOR_PHYSICAL_COUNT"} />
            <Metric label="Canary B-code" value={report.barcode ?? "-"} />
            <Metric label="PM 재고상태" value={report.inventoryVerification ?? "-"} />
            <Metric label="PM 기준점" value={report.inventoryBaselineKind ?? "-"} />
            <Metric label="PM write gate" value={report.productMasterWriteEnabled ? "ON" : "OFF"} />
            <Metric label="실제 write" value="0 · READ ONLY" />
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="text-lg font-black text-emerald-950">
              {report.state === "READY_FOR_PHYSICAL_COUNT"
                ? "선택형 보정 경로 준비됨 · 발주사이클은 계속 진행 가능"
                : "선택형 보정 경로는 아직 사용할 수 없습니다"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">{report.message}</p>
            {report.state === "READY_FOR_PHYSICAL_COUNT" ? (
              <div className="mt-4 rounded-xl border border-emerald-300 bg-white p-4">
                <div className="text-xs font-black tracking-[0.12em] text-emerald-700">OPTIONAL CORRECTION TARGET</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{report.barcode}</div>
                <div className="mt-1 text-sm font-semibold text-slate-700">{report.name}</div>
                <div className="mt-1 text-xs text-slate-500">{report.modelNo ?? "-"}</div>
                <div className="mt-4 text-sm font-black text-slate-950">오류 교정이 필요하다고 판단한 경우에만 실제 수량을 입력합니다.</div>
                <div className="mt-2 text-xs font-semibold text-slate-600">재고실사 필수 아님 · 실제 품절은 SOLD_OUT_RESET=0 · 이후 중국 확정입고와 판매를 누적</div>
              </div>
            ) : null}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="현재 PM 표시수량" value={report.inventoryQuantity ?? 0} />
            <Metric label="PM Canary eligible" value={String(report.productMasterCanaryEligible)} />
            <Metric label="STOCKTAKE write" value={String(report.stocktakeWritesEnabled)} />
            <Metric label="PURCHASE write" value={String(report.purchaseWritesEnabled)} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">고정된 안전 증거</h2>
            <div className="mt-3 space-y-2 break-all font-mono text-xs text-slate-500">
              <p>Plan fingerprint · {report.planFingerprint}</p>
              <p>Inventory guard · {report.inventoryGuard ?? "-"}</p>
              <p>Product Master skuId · {report.productMasterSkuId ?? "-"}</p>
              <p>Requested field · {report.requestedOperatorInput ?? "NONE"}</p>
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
