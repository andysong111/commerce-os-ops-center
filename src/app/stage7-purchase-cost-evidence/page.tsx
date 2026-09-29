import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadStage7PurchaseCostEvidenceReadiness } from "@/lib/stage7PurchaseCostEvidenceReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 90;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage7PurchaseCostEvidencePage() {
  let report: Awaited<
    ReturnType<typeof loadStage7PurchaseCostEvidenceReadiness>
  > | null = null;
  let error = "";
  try {
    report = await loadStage7PurchaseCostEvidenceReadiness();
  } catch {
    error =
      "원가 근거를 읽지 못했습니다. Product Master 연동과 최신 발주후보를 다시 확인하세요.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 7 · PURCHASE COST EVIDENCE"
        title="발주 후보 원가 근거"
        description="확정입고원가와 별도 검증된 구매전용 원가근거를 구분해 표시합니다. 수기 입력·캐시·계획 원가는 자동으로 VERIFIED가 되지 않습니다."
        actions={
          <Link
            prefetch={false}
            href="/purchase-cycle-preflight"
            className="rounded-xl border px-4 py-2 text-sm font-bold"
          >
            10월 발주 사전점검
          </Link>
        }
      />
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm">
          {error}
        </p>
      ) : report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="발주후보" value={report.purchaseCandidateCount} />
            <Metric label="검증원가" value={report.verifiedPurchaseCostCount} />
            <Metric label="근거 없음" value={report.missingVerifiedPurchaseCostCount} />
            <Metric label="확정입고" value={report.confirmedReceiptCount} />
            <Metric label="과거 검증근거" value={report.legacyVerifiedCount} />
            <Metric label="발주자료 검증근거" value={report.sourceOrderVerifiedCount} />
          </section>
          <section className="rounded-2xl border bg-white p-5">
            <p className="text-sm leading-6">{report.message}</p>
            <p className="mt-2 text-xs text-slate-500">
              실제 주문·가격·재고·확정입고 쓰기 0 · {report.state}
            </p>
          </section>
          <section className="overflow-x-auto rounded-2xl border bg-white p-5">
            <table className="min-w-[1000px] w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">B코드·상품</th>
                  <th className="p-2">판정</th>
                  <th className="p-2">근거 종류</th>
                  <th className="p-2">검증 단가</th>
                  <th className="p-2">보호 단가</th>
                  <th className="p-2">근거일</th>
                  <th className="p-2">권장수량</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.barcode} className="border-t">
                    <td className="p-2">
                      <strong>{row.barcode}</strong> · {row.name}
                      <div className="text-xs text-slate-500">
                        {row.modelNo ?? "-"}
                      </div>
                    </td>
                    <td className="p-2 font-bold">
                      {row.hasVerifiedPurchaseCost ? "VERIFIED" : "BLOCKED"}
                    </td>
                    <td className="p-2">{row.purchaseCostTrustSource}</td>
                    <td className="p-2">
                      {number.format(row.verifiedPurchaseUnitCostKrw)}원
                    </td>
                    <td className="p-2">
                      {number.format(row.purchaseProtectedCostKrw)}원
                    </td>
                    <td className="p-2">
                      {row.verifiedPurchaseCostAt?.slice(0, 10) ?? "-"}
                    </td>
                    <td className="p-2">{number.format(row.recommendedQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <details className="rounded-2xl border p-5 text-xs">
            <summary className="font-bold">원본 추적 지문</summary>
            <p className="mt-3 break-all">{report.fingerprint}</p>
          </details>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border bg-white p-4">
      <span className="text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl">{number.format(value)}</strong>
    </article>
  );
}
