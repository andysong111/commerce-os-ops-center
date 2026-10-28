export default function InternalChinaPurchaseDraftLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 py-12" role="status" aria-live="polite">
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-blue-950 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">
          중국 주문초안
        </p>
        <h1 className="mt-2 text-2xl font-black">주문초안을 여는 중입니다</h1>
        <p className="mt-3 text-sm leading-6">
          저장된 초안과 발주 원장을 한 번만 확인하고 있습니다. 이 화면이 보이면 버튼 입력은 정상적으로 처리된 것입니다.
        </p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-blue-100">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-600" />
        </div>
      </section>
    </div>
  );
}
