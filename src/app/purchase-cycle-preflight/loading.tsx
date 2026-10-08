export default function PurchaseCyclePreflightLoading() {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="border-y border-sky-200 bg-sky-50 px-5 py-8"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-1 size-6 shrink-0 animate-spin rounded-full border-4 border-sky-200 border-t-sky-700"
        />
        <div className="min-w-0">
          <p className="text-xs font-black text-sky-700">발주안 계산 중</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            최신 판매·재고와 신규상품 후보를 확인하고 있습니다
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            기존상품 수량을 계산한 뒤 소싱엔진의 검증 후보와 창고 여유를 확인합니다. 자료가 많으면 잠시 걸릴 수 있습니다.
          </p>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-600">
            이 단계에서는 Draft 저장, 1688 주문, 결제를 실행하지 않습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
