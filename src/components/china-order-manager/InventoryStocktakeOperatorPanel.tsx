"use client";

import { useMemo, useState } from "react";
import { parseInventoryStocktakeBulkText } from "@/lib/inventoryStockBulkInput";

function randomId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

export function InventoryStocktakeOperatorPanel() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const parsed = useMemo(() => parseInventoryStocktakeBulkText(input), [input]);

  const save = async () => {
    setNotice("");
    if (!parsed.items.length) {
      setNotice("재고를 확정할 B코드와 현재 수량을 1건 이상 입력해 주세요.");
      return;
    }
    if (parsed.errors.length) {
      setNotice(parsed.errors.join(" · "));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control/stocktake/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          batchId: randomId("stocktake-batch"),
          items: parsed.items,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        savedCount?: number;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "재고 수량을 저장하지 못했습니다.");
      }

      setNotice(
        `현재 재고 ${payload.savedCount ?? parsed.items.length}건 확정 완료. Product Master가 모델번호와 상품형태를 자동 판별했습니다.`,
      );
      setInput("");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "재고 확정 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div>
        <span className="text-xs font-black tracking-[0.12em] text-emerald-700">
          재입고·실사 후 현재 수량 확인
        </span>
        <h2 className="mt-1 text-xl font-black text-slate-950">재고 수량 확정</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          한 줄에 B코드와 현재 실물수량만 입력합니다. Product Master가 모델번호와 단품·옵션 여부를 자동 판별하고,
          저장한 수량을 새 기준점으로 삼아 이후 입고와 판매를 자동 반영합니다.
        </p>
      </div>

      <label className="mt-4 block text-sm font-bold text-slate-700">
        B코드 + 현재 수량 · 한 줄에 한 상품
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"예:\nBCB2-1 50\nBBB8-1 10\nBAB3-1 200\n\n쉼표 형식도 가능: BCB2-1,50"}
          rows={6}
          className="mt-1 block w-full resize-y rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-emerald-500"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>인식 {parsed.items.length}건</span>
        <span>·</span>
        <span>최대 50건</span>
        {parsed.errors.length ? (
          <span className="text-rose-700">· 확인 필요 {parsed.errors.length}건</span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading || !parsed.items.length}
        className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:bg-slate-400"
      >
        {loading
          ? "저장 중..."
          : parsed.items.length > 1
            ? `현재 재고 ${parsed.items.length}건 일괄 확정`
            : "현재 재고 확정"}
      </button>

      {notice ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
