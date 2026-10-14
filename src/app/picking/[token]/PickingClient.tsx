"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  barcode: string;
  quantity: number;
  modelNames: string[];
  modelNumbers: string[];
  productNames: string[];
  optionNames: string[];
  picked: boolean;
};

type Picking = {
  date: string;
  createdAt: string;
  source: string;
  status: string;
  summary: Record<string, number>;
  items: Item[];
  delta: {
    addedQuantity: number;
    changedQuantity: number;
    removedQuantity: number;
    quantityToPick: number;
    addedOrderCount: number;
    changedOrderCount: number;
    removedOrderCount: number;
    toPickItems: Array<{ barcode: string; quantityToPick: number; productNames: string[]; optionNames: string[] }>;
  };
  unresolved: Array<{ reason?: string; productName?: string; optionName?: string; quantity?: number }>;
};

export default function PickingClient({ token }: { token: string }) {
  const [picking, setPicking] = useState<Picking | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"full" | "delta">("full");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/picking/${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error("피킹 목록을 열 수 없습니다.");
        setPicking(body.picking);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "피킹 목록을 열 수 없습니다.");
      });
    return () => controller.abort();
  }, [token]);

  const pickedCount = useMemo(() => picking?.items.filter((item) => item.picked).length || 0, [picking]);

  async function toggle(item: Item, completed: boolean) {
    if (busy) return;
    setBusy(item.barcode);
    try {
      const response = await fetch(`/api/picking/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: item.barcode, completed }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error("완료 상태를 저장하지 못했습니다.");
      setPicking((current) => current ? {
        ...current,
        items: current.items.map((row) => row.barcode === item.barcode ? { ...row, picked: completed } : row),
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "완료 상태를 저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  if (error) return <main className="mx-auto min-h-screen max-w-3xl bg-white p-6 text-slate-900"><h1 className="text-xl font-bold">피킹 목록</h1><p className="mt-5 border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p></main>;
  if (!picking) return <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">피킹 목록을 불러오는 중입니다.</main>;

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-white text-slate-900">
      <header className="border-b-4 border-orange-500 bg-emerald-950 px-5 py-5 text-white">
        <h1 className="text-xl font-black">오늘의 피킹 목록</h1>
        <p className="mt-1 text-xs text-emerald-100">{picking.date} · {picking.source === "SHOPLING_API" ? "샵플링 공식 API" : "B7 엑셀 대체"}</p>
      </header>
      <section className="grid grid-cols-2 border-b sm:grid-cols-4">
        {[
          ["주문 행", picking.summary.filteredOrderRecordCount],
          ["전체 수량", picking.summary.totalQuantity],
          ["피킹 완료", `${pickedCount}/${picking.items.length}`],
          ["확인 필요", picking.summary.unresolvedRecordCount],
        ].map(([label, value]) => <div key={String(label)} className="border-r p-4 last:border-r-0"><div className="text-xs text-slate-500">{label}</div><strong className="mt-1 block text-xl">{value}</strong></div>)}
      </section>
      <div className="flex gap-2 border-b p-3">
        <button type="button" onClick={() => setTab("full")} className={`border px-3 py-2 text-sm font-bold ${tab === "full" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}>전체 목록</button>
        <button type="button" onClick={() => setTab("delta")} className={`border px-3 py-2 text-sm font-bold ${tab === "delta" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}>변경분</button>
      </div>
      {tab === "full" ? (
        <ul className="divide-y">
          {picking.items.map((item) => (
            <li key={item.barcode} className={item.picked ? "bg-slate-50 p-4 text-slate-500" : "p-4"}>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={item.picked} disabled={busy === item.barcode} onChange={(event) => void toggle(item, event.target.checked)} className="mt-1 h-5 w-5 accent-emerald-700" />
                <span className="min-w-0 flex-1"><span className="flex items-baseline justify-between gap-3"><strong className="text-base">{item.barcode}</strong><strong className="text-lg">{item.quantity}개</strong></span><span className="mt-1 block text-sm">{item.productNames.join(", ") || "상품명 미확인"}</span><span className="mt-1 block text-xs text-slate-500">{item.optionNames.join(", ") || "단품"} · {[...item.modelNumbers, ...item.modelNames].join(" · ") || "모델 미확인"}</span></span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <section className="p-4">
          <div className="grid grid-cols-2 gap-px border bg-slate-200 text-sm sm:grid-cols-4">
            {[["신규 주문", picking.delta.addedOrderCount], ["변경 주문", picking.delta.changedOrderCount], ["취소·제외", picking.delta.removedOrderCount], ["이번 피킹", `${picking.delta.quantityToPick}개`]].map(([label, value]) => <div key={String(label)} className="bg-white p-3"><span className="text-xs text-slate-500">{label}</span><strong className="mt-1 block">{value}</strong></div>)}
          </div>
          <ul className="mt-4 divide-y border">
            {picking.delta.toPickItems.length ? picking.delta.toPickItems.map((item) => <li key={item.barcode} className="flex justify-between gap-4 p-3 text-sm"><span><strong>{item.barcode}</strong><span className="mt-1 block text-xs text-slate-500">{item.productNames.join(", ")}</span></span><strong>{item.quantityToPick}개</strong></li>) : <li className="p-6 text-center text-sm text-slate-500">추가 피킹 대상이 없습니다.</li>}
          </ul>
        </section>
      )}
      {picking.unresolved.length > 0 && <section className="border-t bg-amber-50 p-4"><h2 className="font-bold text-amber-900">확인 필요 {picking.unresolved.length}건</h2><ul className="mt-2 space-y-2 text-sm text-amber-900">{picking.unresolved.map((item, index) => <li key={`${item.reason}-${index}`}>{item.reason} · {item.productName || "상품명 미확인"} · {item.quantity || 0}개</li>)}</ul></section>}
    </main>
  );
}
