"use client";

import { useMemo, useState } from "react";
import { parseInventoryStockoutBulkText } from "@/lib/inventoryStockBulkInput";

function randomId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

export function InventoryStockoutOperatorPanel() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const parsed = useMemo(() => parseInventoryStockoutBulkText(input), [input]);

  const save = async () => {
    setNotice("");
    if (!parsed.barcodes.length) {
      setNotice("품절로 확정할 B코드를 1개 이상 입력해 주세요.");
      return;
    }
    if (parsed.errors.length) {
      setNotice(parsed.errors.join(" · "));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          batchId: randomId("stockout-batch"),
          barcodes: parsed.barcodes,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        savedCount?: number;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "품절 처리를 저장하지 못했습니다.");
      }

      setNotice(
        `품절 ${payload.savedCount ?? parsed.barcodes.length}건 확정 완료. Product Master가 모델번호와 상품형태를 자동 판별했습니다.`,
      );
      setInput("");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "품절 처리 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
      <div>
        <span className="text-xs font-black tracking-[0.12em] text-rose-700">
          창고에서 수량 0 확인
        </span>
        <h2 className="mt-1 text-xl font-black text-slate-950">품절 처리</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          B코드만 입력합니다. Product Master에서 모델번호와 단품·옵션 여부를 자동 판별하고,
          정확히 식별되지 않는 B코드가 하나라도 있으면 저장 전에 전체 작업을 중단합니다.
        </p>
      </div>

      <label className="mt-4 block text-sm font-bold text-slate-700">
        품절 B코드 · 1개 또는 여러 개
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"예:\nBCB2-1\nBBB8-1\nBAB3-1\n\n줄바꿈·쉼표·공백으로 여러 개 입력 가능"}
          rows={6}
          className="mt-1 block w-full resize-y rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-rose-500"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
        <span>인식 {parsed.barcodes.length}건</span>
        <span>·</span>
        <span>최대 50건</span>
        {parsed.errors.length ? (
          <span className="text-rose-700">· 확인 필요 {parsed.errors.length}건</span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading || !parsed.barcodes.length}
        className="mt-4 rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white hover:bg-rose-800 disabled:bg-slate-400"
      >
        {loading
          ? "처리 중..."
          : parsed.barcodes.length > 1
            ? `품절 ${parsed.barcodes.length}건 일괄 확정`
            : "품절 확정"}
      </button>

      {notice ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
