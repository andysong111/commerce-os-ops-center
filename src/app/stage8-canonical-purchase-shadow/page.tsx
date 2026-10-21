import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8CanonicalPurchaseShadowPage() {
  const result = await loadCanonicalPurchaseShadow();
  const top = (result.snapshot?.products ?? []).slice(0, 40);
  const comparison = result.legacyReference.comparison;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · CANONICAL PURCHASE SHADOW"
        title="Canonical 판매수요 → 발주추천 그림자"
        description="Shopling 주문수량·매출을 다시 계산에 넣지 않고 Product Master persisted canonical 판매원장만 발주 엔진의 주 수요원으로 넣습니다. 같은 분석시점의 클레임률이 있으면 우선순위에 반영하고, 없으면 중립값으로 계산하는 읽기 전용 shadow입니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-postapply-canonical-reconciliation" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Persisted 최종 대사
            </Link>
            <Link href="/stage8-readiness" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Stage 8 준비상태
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Shadow 상태" value={result.state} />
        <Metric label="Canonical active SKU" value={number.format(result.canonicalManagedActiveCount)} />
        <Metric label="Engine 입력 일치" value={`${number.format(result.exactPlanningMatchCount)}/${number.format(result.planningManagedActiveCount)}`} />
        <Metric label="최근30일 Canonical 매출" value={`${number.format(result.recent30Revenue)}원`} />
        <Metric label="중국 미입고 코드" value={number.format(result.commitmentBarcodeCount)} />
        <Metric label="Canonical 경과" value={result.canonicalAgeMinutes === null ? "-" : `${number.format(result.canonicalAgeMinutes)}분`} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${result.shadowReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">주 수요원 전환 Shadow</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{result.shadowReady ? "CANONICAL DEMAND PATH READY" : "STRUCTURAL BLOCK"}</h2>
          </div>
          <strong className={`rounded-full px-4 py-2 text-sm text-white ${result.shadowReady ? "bg-emerald-700" : "bg-amber-700"}`}>
            실제 발주 항상 차단
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{result.message}</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-700 md:grid-cols-2">
          <div className="rounded-xl bg-white/70 p-3"><strong>Demand source</strong><br />{result.demandSource}</div>
          <div className="rounded-xl bg-white/70 p-3"><strong>Claim signal</strong><br />{result.claimSignalMode}</div>
          <div className="rounded-xl bg-white/70 p-3"><strong>analysisAsOf</strong><br />{result.analysisAsOf ?? "-"}</div>
          <div className="rounded-xl bg-white/70 p-3"><strong>Promotion</strong><br />BLOCKED · 읽기 전용 검증 화면에서 실제 발주 금지</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Fail-closed 조건</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">같은 분석시점의 클레임률이 없을 때만 중립 계산 blocker를 표시합니다. 그 외 구조 blocker가 0이면 canonical 수요 경로 자체는 통과합니다.</p>
        <div className="mt-4 space-y-2">
          {result.blockers.map((row) => (
            <article key={row.key} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="font-bold text-slate-950">{row.key}</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{row.message}</p>
            </article>
          ))}
          {!result.blockers.length ? <p className="text-sm text-emerald-700">차단 조건 없음</p> : null}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="발주 예산" value={`${number.format(result.snapshot?.budget ?? 0)}원`} />
        <Metric label="예상 발주금액" value={`${number.format(result.snapshot?.expectedSpend ?? 0)}원`} />
        <Metric label="발주 추천 SKU" value={number.format((result.snapshot?.products ?? []).filter((row) => row.status === "발주 추천").length)} />
        <Metric label="재고 확인 SKU" value={number.format((result.snapshot?.products ?? []).filter((row) => row.inventoryKnown).length)} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">Canonical 발주추천 상위 40개</h2>
            <p className="mt-1 text-xs text-slate-500">클레임률은 수량 감액 없이 우선순위 점수에만 반영하며, 이 shadow 수량은 운영 실행값이 아닙니다.</p>
          </div>
          <span className="text-xs font-bold text-slate-500">총 {number.format(result.snapshot?.products?.length ?? 0)} SKU</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1100px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">바코드</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">추이</th>
                <th className="px-3 py-2">권장수량</th>
                <th className="px-3 py-2">예상원가</th>
                <th className="px-3 py-2">추정재고</th>
                <th className="px-3 py-2">미입고</th>
                <th className="px-3 py-2">점수</th>
              </tr>
            </thead>
            <tbody>
              {top.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 font-bold">{row.status}</td>
                  <td className="px-3 py-2">{row.trend}</td>
                  <td className="px-3 py-2 font-black">{number.format(row.recommendedQty ?? 0)}</td>
                  <td className="px-3 py-2">{number.format(row.expectedCost ?? 0)}원</td>
                  <td className="px-3 py-2">{number.format(row.estimatedStock ?? 0)}</td>
                  <td className="px-3 py-2">{number.format(row.openCommitment ?? 0)}</td>
                  <td className="px-3 py-2">{number.format(Number(row.score?.total ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>Persisted reconciliation</strong> · <span className="break-all text-xs">{result.persistedReconciliationFingerprint ?? "-"}</span><br />
        <strong>Canonical content</strong> · <span className="break-all text-xs">{result.canonicalContentFingerprint ?? "-"}</span><br />
        <strong>Planning content</strong> · <span className="break-all text-xs">{result.planningContentFingerprint ?? "-"}</span><br />
        <strong>Canonical freshness</strong> · {result.canonicalFresh ? "PASS" : "BLOCK"}<br />
        <strong>Planning mismatch</strong> · {result.planningMismatchBarcodes.length ? result.planningMismatchBarcodes.join(", ") : "없음"}<br />
        <strong>Legacy reference</strong> · {result.legacyReference.available ? `있음 · analysisAsOf ${result.legacyReference.analysisAsOf ?? "-"} · 같은 시점 ${result.legacyReference.sameAnalysisAsOf ? "YES" : "NO"}` : "없음"}<br />
        {comparison ? <><strong>Legacy 대비 참고 차이</strong> · 상태변경 {number.format(comparison.statusChangedCount)}개 · 수량변경 {number.format(comparison.quantityChangedCount)}개 · 예상발주금액 차이 {number.format(comparison.expectedSpendDelta)}원<br /></> : null}
        <strong>다음 단계</strong> · 같은 분석시점 클레임률 사용 여부와 완료 12개월 매출·재고·미입고 계약을 함께 확인한 뒤 발주 사전점검에서 재검증합니다.
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
