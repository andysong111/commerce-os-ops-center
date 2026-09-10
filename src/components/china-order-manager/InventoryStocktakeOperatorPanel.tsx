"use client";

import { useState } from "react";

type ProductKind = "OPTION" | "SINGLE";

function randomId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function normalizeBarcode(value: string) {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

export function InventoryStocktakeOperatorPanel() {
  const [barcode, setBarcode] = useState("");
  const [productKind, setProductKind] = useState<ProductKind>("OPTION");
  const [modelNo, setModelNo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async () => {
    setNotice("");
    const code = normalizeBarcode(barcode);
    const parsedQuantity = Number(quantity);
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(code)) {
      setNotice("B코드를 확인해 주세요. 예: BBB8-1");
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 1_000_000) {
      setNotice("창고에서 확인한 현재 수량을 1개 이상의 정수로 입력해 주세요.");
      return;
    }
    if (productKind === "SINGLE" && !modelNo.trim()) {
      setNotice("단품은 모델번호도 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control/stocktake", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          eventId: randomId("stocktake-baseline"),
          barcode: code,
          productKind,
          modelNo: modelNo.trim() || null,
          baselineQuantity: parsedQuantity,
          note: "창고 실물수량 재확인",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "재고 수량을 저장하지 못했습니다.");
      }

      setNotice(`현재 재고 ${parsedQuantity}개로 확정했습니다.`);
      setBarcode("");
      setQuantity("");
      setModelNo("");
      window.setTimeout(() => window.location.reload(), 450);
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
          재입고 직후 또는 실제 수량을 다시 센 경우에만 사용합니다. 저장한 수량을 새 기준으로 삼고 그 이후 입고와 판매를 자동 반영합니다.
        </p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px_220px]">
        <label className="text-sm font-bold text-slate-700">
          B코드
          <input
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="예: BBB8-1"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-emerald-500"
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          상품 형태
          <select
            value={productKind}
            onChange={(event) => setProductKind(event.target.value as ProductKind)}
            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500"
          >
            <option value="OPTION">옵션이 있는 상품</option>
            <option value="SINGLE">옵션 없는 단품</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-700">
          현재 수량
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="예: 10"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-emerald-500"
          />
        </label>
      </div>

      {productKind === "SINGLE" ? (
        <label className="mt-3 block max-w-md text-sm font-bold text-slate-700">
          모델번호
          <input
            value={modelNo}
            onChange={(event) => setModelNo(event.target.value)}
            placeholder="예: AAA339"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-emerald-500"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading}
        className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:bg-slate-400"
      >
        {loading ? "저장 중..." : "현재 재고 확정"}
      </button>

      {notice ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
