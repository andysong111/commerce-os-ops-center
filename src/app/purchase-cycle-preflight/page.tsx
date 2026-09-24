import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadPurchaseCyclePreflight } from "@/lib/purchaseCyclePreflight";
import { validatePurchasePreflightOptions, type PurchaseCyclePreflightReport } from "@/lib/purchaseCyclePreflightCore";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;
const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const statusLabels = { VERIFIED: "근거 확인", PARTIAL: "일부 확인", WAITING: "확인 대기", BLOCKED: "차단", LOCKED: "실행 잠금" };
const reasonLabels: Record<string, string> = {
  INVENTORY_EVIDENCE_STALE_OR_UNPINNED: "재고·원가 원본이 15분 신선도 기준을 넘었거나 원본 지문을 확인하지 못했습니다.",
  CYCLE_SPEND_CHANGED_OR_UNVERIFIED: "이번 달 기존 발주 지출액을 확인하지 못했거나 점검 중 바뀌었습니다.",
  CYCLE_SPEND_READ_FAILED: "기존 발주 지출액 조회 실패",
  CYCLE_SPEND_RECHECK_FAILED: "기존 발주 지출액 재확인 실패",
  GROSS_FUNDING_BASIS_UNVERIFIED: "배송비 여유분을 포함한 월간 지출 한도를 확인하지 못했습니다.",
  SOURCE_CHANGED_OR_MISSING: "조회 중 판매자료가 바뀌었거나 원본을 확인하지 못했습니다.",
  SALES_SOURCE_STALE_OR_FUTURE: "판매자료가 12시간 신선도 기준을 넘었거나 분석시점이 잘못됐습니다.",
  SALES_PROMOTION_NOT_VERIFIED: "공식 판매자료 승인 검증이 끝나지 않았습니다.",
  PRODUCT_MASTER_FULL_READBACK_REQUIRED: "상품마스터 반영 후 동일 원본 재조회 검증이 필요합니다.",
  PURCHASE_SOURCE_CONTEXT_MISMATCH: "발주안·판매·상품정보·공식원장의 원본 지문이 일치하지 않습니다.",
  PURCHASE_SHADOW_NOT_READY: "발주 모의 계산의 준비 상태를 확인하지 못했습니다.",
  TARGET_CYCLE_RECALCULATION_REQUIRED: "발주 예정 월을 기준으로 다시 계산해야 합니다. 다른 달의 추천을 재사용하지 않습니다.",
  BUDGET_MONTH_NOT_CLOSED: "예산 기준 월이 아직 끝나지 않아 그 달의 최종 매출예산을 확정할 수 없습니다.",
  OWNER_CASH_LIMIT_REQUIRED: "이번 소량 검증에 쓸 현금 상한을 입력해야 합니다.",
  MONTHLY_BUDGET_NOT_VERIFIED: "발주안의 월간 예산을 확인하지 못했습니다.",
  SAME_TIME_LEGACY_COMPARISON_REQUIRED: "기존 방식과 동일 분석시점으로 비교한 결과가 필요합니다.",
  OWNER_REVIEW_ON_TARGET_DATE: "예정일에 최신 자료와 금액을 다시 확인하고 최종 승인해야 합니다.",
  TARGET_DATE_RECONFIRM_REQUIRED: "발주 예정일이 지났습니다. 새 일정을 확인해야 합니다.",
  DUPLICATE_BARCODE: "중복 B코드가 있어 품목 식별을 확인해야 합니다.",
  NO_VERIFIED_CANDIDATE_WITHIN_LIMITS: "원가·재고·현금·수량 제한을 모두 충족하는 품목이 없습니다.",
  IDENTITY_REVIEW: "B코드 확인 필요", CONFIRMED_COST_REQUIRED: "검증원가 필요",
  VERIFIED_INVENTORY_REQUIRED: "재고 근거 필요", INVALID_RECOMMENDATION: "추천수량·점수 확인 필요",
  CANARY_QUANTITY_LIMIT: "소량 검증 수량 상한 초과", ROW_EXECUTION_BLOCKED: "품목별 조건 미충족",
  CANARY_SKU_LIMIT: "소량 검증 SKU 수 제한", CASH_BUDGET_LIMIT: "현금 상한 초과",
  CANDIDATE_READ_FAILED: "판매 후보 조회 실패", CANDIDATE_RECHECK_FAILED: "판매 후보 재확인 실패",
  PROMOTION_GATE_READ_FAILED: "판매원장 게이트 조회 실패", MASTER_READBACK_READ_FAILED: "상품마스터 대사 조회 실패",
  INVENTORY_PRIORITY_READ_FAILED: "재고·발주 우선순위 조회 실패",
  "UPSTREAM:claim-auxiliary": "클레임·배송 보조신호 연결이 남아 있어 실제 실행 판단으로 승격하지 않습니다.",
};
const explain = (code: string) => reasonLabels[code] ?? `상위 검증에서 남은 조건: ${code}`;

export default async function PurchaseCyclePreflightPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const single = (key: string, fallback: string) => typeof query[key] === "string" ? query[key] : fallback;
  const targetDate = single("date", "2026-10-01");
  const budget = single("budget", "");
  const skus = single("skus", "1");
  const units = single("units", "10");
  let report: PurchaseCyclePreflightReport | null = null;
  let inputError = "";
  // Opening a card or link never starts the expensive data reads. Only an
  // explicit read-only form submission does. No polling, cron or write action.
  if (query.check === "1") {
    try {
      if (["date", "budget", "skus", "units", "check"].some(key => Array.isArray(query[key]))) throw new Error("DUPLICATE_INPUT");
      if (![skus, units, ...(budget === "" ? [] : [budget])].every(value => /^\d+$/.test(value))) throw new Error("NUMERIC_INPUT_INVALID");
      const options = { targetDate, cashLimitKrw: budget === "" ? null : Number(budget), maxSkus: Number(skus), maxUnitsPerSku: Number(units) };
      validatePurchasePreflightOptions(options);
      report = await loadPurchaseCyclePreflight(options);
    } catch {
      inputError = "점검을 완료하지 못했습니다. 날짜와 정수 금액·수량을 확인하세요. SKU는 1~10개, 품목별 수량 상한은 1~9,999개입니다. 입력이 맞다면 자료를 다시 조회하세요.";
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="COMMERCE OS · PURCHASE PREFLIGHT" title="발주 사전점검 · 소량 검증 준비"
        description="개발된 기능과 실제 운영 검증을 구분합니다. 5~10구간을 미리 점검하되, 이 화면에서는 주문·결제·공식원장 변경·승인을 실행하지 않습니다."
        actions={<Link prefetch={false} href="/fast-purchase-mvp" className="rounded-xl border px-4 py-2 text-sm font-bold">기존 빠른 발주안</Link>} />
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>예정일이 되어도 자동으로 주문하지 않습니다.</strong>
        <p>10월 1일 발주는 9월 최종 매출예산과 당일 최신 판매·재고·미입고 근거로 다시 확인해야 합니다. 최종 승인과 실제 주문은 별도입니다. 미리보기의 통과 표시는 실행 권한이 아닙니다.</p>
      </section>
      <form method="get" action="/purchase-cycle-preflight" className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2 xl:grid-cols-4">
        <input type="hidden" name="check" value="1" />
        <label className="text-sm font-bold">발주 예정일<input className="mt-2 block w-full rounded-lg border p-2" name="date" type="date" defaultValue={targetDate} required /></label>
        <label className="text-sm font-bold">이번 소량 검증 현금 상한 (원)<input className="mt-2 block w-full rounded-lg border p-2" name="budget" type="number" min="1" step="1" defaultValue={budget} placeholder="입력 전에는 후보를 확정하지 않습니다" /></label>
        <label className="text-sm font-bold">최대 SKU 수<input className="mt-2 block w-full rounded-lg border p-2" name="skus" type="number" min="1" max="10" step="1" defaultValue={skus} required /></label>
        <label className="text-sm font-bold">품목별 최대 수량<input className="mt-2 block w-full rounded-lg border p-2" name="units" type="number" min="1" max="9999" step="1" defaultValue={units} required /></label>
        <p className="text-xs leading-5 text-slate-600 sm:col-span-2 xl:col-span-4">현금 상한은 비용 차감 후 이번 검증에 쓸 수 있는 금액입니다. 기존 엔진의 추천수량을 임의로 쪼개지 않으며, 최소주문·박스단위 수량이 상한보다 크면 해당 품목을 제외합니다. 금액은 예상원가이며 실제 견적·최종 지출은 별도 확인합니다.</p>
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">읽기 전용 사전 점검</button>
      </form>
      {inputError ? <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm">{inputError}</p> : null}
      {!report ? <p className="text-sm text-slate-600">점검 버튼을 누르면 운영 자료를 한 번 조회합니다. 자동 재조회·발주 예약은 만들지 않습니다.</p> : <>
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">{report.state === "BLOCKED" ? "발주안 확정 전 확인이 필요합니다" : report.state === "PREVIEW_ONLY" ? "미리보기 생성 · 실행 판단은 대기" : "미리보기 생성 · 별도 최종 검토 필요"}</h2>
          <p className="mt-2 text-sm">조회 시각 {new Date(report.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 판매 분석시점 {report.sourceAnalysisAsOf ?? "미확인"}</p>
          <p className="mt-1 text-sm">목표 발주월 {report.targetCycleMonth} / 예산 기준월 {report.requiredBudgetMonth} · 읽은 자료의 발주월 {report.sourceCycleMonth ?? "미확인"} / 예산월 {report.sourceBudgetMonth ?? "미확인"}</p>
        </section>
        <section className="overflow-x-auto rounded-2xl border bg-white p-5">
          <table className="w-full min-w-[700px] text-left text-sm"><caption className="mb-4 text-left text-lg font-bold">구간별 실제 근거 상태</caption><thead><tr><th className="p-2">구간</th><th className="p-2">상태</th><th className="p-2">확인 내용</th></tr></thead><tbody>
            {report.stages.map(row => <tr key={row.number} className="border-t"><td className="p-2 font-bold"><Link prefetch={false} href={row.href} className="underline">{row.number}. {row.label}</Link></td><td className="whitespace-nowrap p-2">{statusLabels[row.state]}</td><td className="p-2 leading-6">{row.message}</td></tr>)}
          </tbody></table>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">자료·예산 차단 사유</h2>{report.blockers.length ? report.blockers.map(code => <p key={code} className="mt-2 text-sm">{explain(code)}</p>) : <p className="mt-2 text-sm">미리보기 계산 조건을 확인했습니다.</p>}</div>
          <div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">실제 승인 전 남은 조건</h2>{report.reviewBlockers.map(code => <p key={code} className="mt-2 text-sm">{explain(code)}</p>)}<p className="mt-2 text-sm">{report.comparisonMessage}</p><p className="mt-2 text-sm font-bold">최종 승인·실행 시 최신 근거를 다시 확인해야 합니다.</p></div>
        </section>
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">소량 발주 미리보기 · 주문서 아님</h2>
          <p className="mt-2 text-sm">상품대금 상한 {money(report.effectiveBudgetKrw)} · 검증원가 기준 상품대금 {money(report.estimatedSpendKrw)} · 상품대금 잔여한도 {money(report.remainingPreviewBudgetKrw)}</p>
          <p className="mt-2 text-sm">이번 달 기록된 발주 지출 {report.recordedCycleSpendKrw === null ? "미확인" : money(report.recordedCycleSpendKrw)} · 이번 검증 현금 한도 {money(report.effectiveCashKrw)} · 배송비 여유분 포함 예상 지출 {money(report.estimatedAllInSpendKrw)}</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr><th className="p-2">B코드·상품</th><th className="p-2">수량</th><th className="p-2">예상금액</th><th className="p-2">확인재고</th><th className="p-2">미입고</th></tr></thead><tbody>{report.selected.map(row => <tr key={row.barcode} className="border-t"><td className="p-2">{row.barcode} · {row.name}</td><td className="p-2">{row.quantity}</td><td className="p-2">{money(row.estimatedCostKrw)}</td><td className="p-2">{row.inventoryQuantity}</td><td className="p-2">{row.openCommitment}</td></tr>)}</tbody></table></div>
          {!report.selected.length ? <p className="mt-3 text-sm">확정 가능한 미리보기 품목이 없습니다. 차단을 우회하거나 재고를 0으로 가정하지 않습니다.</p> : null}
          <details className="mt-4 text-sm"><summary>제외 품목 {report.excluded.length}개 확인</summary>{report.excluded.slice(0, 100).map(row => <p key={row.barcode} className="mt-2">{row.barcode} · {row.reasons.map(explain).join(" / ")}</p>)}{report.excluded.length > 100 ? <p className="mt-2">앞의 100개를 표시했습니다. 구간별 상세 화면에서 전체 자료를 확인하세요.</p> : null}</details>
        </section>
        <details className="rounded-2xl border p-5 text-xs"><summary className="font-bold">채팅 인계·원본 추적 지문</summary><p className="mt-3 break-all">후보 요청 {report.candidateRequestId ?? "없음"}</p><p className="mt-2 break-all">원본 {report.sourceFingerprint}</p><p className="mt-2 break-all">발주 미리보기 {report.planFingerprint}</p><p className="mt-3">같은 화면·지문이라도 승인 토큰이 아닙니다. 데이터·예산·수량 제한이 바뀌면 다시 점검합니다.</p></details>
      </>}
    </div>
  );
}
