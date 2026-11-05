export default function PurchaseStrategyLabLoading() {
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
        READ-ONLY SNAPSHOT
      </p>
      <h1 className="mt-2 text-2xl font-black text-slate-950">
        최신 판매·재고·원가를 한 번 읽고 있습니다
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        로드가 끝나면 전략 변경은 외부 재조회 없이 즉시 계산됩니다. 운영 Draft는 수정하지 않습니다.
      </p>
    </section>
  );
}
