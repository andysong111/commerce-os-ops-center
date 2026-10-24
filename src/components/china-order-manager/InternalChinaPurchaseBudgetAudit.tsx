import type { InternalChinaPurchaseBudgetAudit as BudgetAudit } from "@/lib/internalChinaPurchaseBudgetAudit";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function tone(status: BudgetAudit["status"]) {
  if (status === "OVER_BUDGET") {
    return "border-rose-300 bg-rose-50 text-rose-950";
  }
  if (status === "COST_REVIEW") {
    return "border-amber-300 bg-amber-50 text-amber-950";
  }
  return "border-emerald-300 bg-emerald-50 text-emerald-950";
}

function statusLabel(status: BudgetAudit["status"]) {
  if (status === "OVER_BUDGET") return "예산 초과 · 주문 전 조정 필요";
  if (status === "COST_REVIEW") return "위안단가·기준원가 확인 필요";
  return "예산 범위 내";
}

function monthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split("-");
  return `${Number(year)}년 ${Number(monthNumber)}월`;
}

export function InternalChinaPurchaseBudgetAudit({
  audit,
}: {
  audit: BudgetAudit;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 shadow-sm ${tone(audit.status)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em]">
            CARRYOVER PURCHASE BUDGET AUDIT
          </span>
          <h2 className="mt-1 text-xl font-black">
            누적 발주 가능 금액 검증
          </h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 opacity-80">
            매월 완료된 정상매출에서 에이블리 정상 주문당 무료배송 부담 3,000원을 먼저 빼고 그 금액의 50%를 발주 가능 금액으로 적립합니다. 쓰지 않은 금액은
            다음 달로 이월합니다. 한 달에 여러 번 발주할 수 있으며, 실제 주문완료로
            기록한 금액만 잔액에서 차감합니다. 내부 주문 수수료율 {audit.purchaseCostMultiplier.toFixed(2)}를
            역산해 이번 발주차시의 실제 상품대금 한도를 정합니다.
          </p>
        </div>
        <span className="rounded-full border border-current/20 bg-white/70 px-3 py-1.5 text-xs font-black">
          {statusLabel(audit.status)}
        </span>
      </div>

      {audit.sourceWarnings.length ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-white/70 px-4 py-3 text-xs leading-5">
          <strong className="block text-sm">참고자료 일부 지연</strong>
          {audit.sourceWarnings.map((warning) => (
            <p key={warning} className="mt-1 opacity-80">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric
          label={`${monthLabel(audit.budgetMonth)} 정상매출`}
          value={`${money.format(audit.budgetMonthRevenueKrw)}원`}
          note="1일~말일 고정"
        />
        <Metric
          label="현재 누적 사용가능액"
          value={`${money.format(audit.grossCogsBudgetKrw)}원`}
          note={`누적 적립 ${money.format(audit.cumulativeAccruedBudgetKrw)}원 - 주문완료 ${money.format(audit.recordedOrderedSpendKrw)}원`}
        />
        <Metric
          label="상품대금 발주한도"
          value={`${money.format(audit.productOrderBudgetKrw)}원`}
          note={`총예산 ÷ ${audit.purchaseCostMultiplier.toFixed(2)}`}
        />
        <Metric
          label="현재 Draft 상품대금"
          value={`${money.format(audit.selectedDraftEstimatedProductCostKrw)}원`}
          note={`${percent.format(audit.selectedDraftBudgetUtilizationPercent)}% 사용`}
          emphasized
        />
        <Metric
          label="내부기준원가"
          value={`${money.format(audit.selectedDraftEstimatedLandedCostKrw)}원`}
          note={`상품대금 × 내부 주문 수수료율 ${audit.purchaseCostMultiplier.toFixed(2)}`}
        />
        <Metric
          label={
            audit.selectedDraftBudgetOverKrw > 0
              ? "예산 초과"
              : "상품대금 잔여예산"
          }
          value={`${money.format(
            audit.selectedDraftBudgetOverKrw > 0
              ? audit.selectedDraftBudgetOverKrw
              : audit.selectedDraftBudgetRemainingKrw,
          )}원`}
          danger={audit.selectedDraftBudgetOverKrw > 0}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <InfoBox
          title="현재 수량 vs 엔진 참고"
          body={`현재 엔진 참고 예상 상품대금 ${money.format(
            audit.engineExpectedSpendKrw,
          )}원 · 현재 Draft에서 엔진 수량과 달라진 SKU ${audit.quantityChangedFromEngineCount}개 (증가 ${audit.quantityAboveEngineCount} · 감소 ${audit.quantityBelowEngineCount}). 현재 발주차시를 재계산하면 최신 재고와 전략을 다시 반영합니다.`}
        />
        <InfoBox
          title="다른 활성 Draft"
          body={
            audit.otherActiveDraftCount > 0
              ? `선택한 Draft 외 ${audit.otherActiveDraftCount}건 · 미입고 ${money.format(
                  audit.otherActiveDraftQuantity,
                )}개 · 기준원가 추정 ${money.format(
                  audit.otherActiveDraftEstimatedProductCostKrw,
                )}원. 실제 주문하지 않을 과거 Draft는 해제해야 다음 발주차시 계산이 왜곡되지 않습니다.`
              : "선택한 Draft 외 활성 RESERVED Draft가 없습니다."
          }
        />
        <InfoBox
          title="원가 적용 우선순위"
          body={
            audit.missingCostBarcodes.length
              ? `실제 1688 위안단가 ${audit.actualPriceCount} SKU · 기준원가 대체 ${audit.referencePriceCount} SKU · 원가 미확인 ${audit.missingCostBarcodes.length} SKU: ${audit.missingCostBarcodes
                  .slice(0, 6)
                  .join(", ")}${audit.missingCostBarcodes.length > 6 ? " …" : ""}`
              : `실제 1688 위안단가 ${audit.actualPriceCount} SKU를 최우선 적용했고, 나머지 ${audit.referencePriceCount} SKU는 기준원가를 사용했습니다. 모든 SKU의 예산 검증 원가를 확보했습니다.`
          }
        />
      </div>

      <p className="mt-4 rounded-xl border border-current/15 bg-white/60 px-4 py-3 text-xs leading-5 opacity-80">
        기준식 · {audit.basisLabel}. 아래 주문 준비에서 실제 1688 위안단가를
        입력하고 `발주초안 저장`하면 해당 실제 단가가 기준원가보다 우선해 이
        예산 카드에 반영됩니다. 주문 화면에서는 저장 전에도 실시간 예산 사용률을
        별도로 보여줍니다.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  emphasized = false,
  danger = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasized?: boolean;
  danger?: boolean;
}) {
  return (
    <article className="rounded-xl border border-current/10 bg-white/75 p-4">
      <p className="text-xs font-bold opacity-60">{label}</p>
      <strong
        className={`mt-1 block text-lg font-black ${
          danger ? "text-rose-700" : emphasized ? "text-blue-700" : ""
        }`}
      >
        {value}
      </strong>
      {note ? <p className="mt-1 text-[11px] opacity-60">{note}</p> : null}
    </article>
  );
}

function InfoBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-current/10 bg-white/60 p-4 text-xs leading-5">
      <strong className="block text-sm">{title}</strong>
      <p className="mt-1 opacity-75">{body}</p>
    </div>
  );
}
