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

export function InventoryStockoutOperatorPanel() {
  const [barcode, setBarcode] = useState("");
  const [productKind, setProductKind] = useState<ProductKind>("OPTION");
  const [modelNo, setModelNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async () => {
    setNotice("");
    const code = normalizeBarcode(barcode);
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(code)) {
      setNotice("B코드를 확인해 주세요. 예: BZ7341-1");
      return;
    }
    if (productKind === "SINGLE" && !modelNo.trim()) {
      setNotice("단품은 모델번호도 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/inventory-stock-control", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "RESET_ZERO",
          eventId: randomId("stockout-reset"),
          barcode: code,
          productKind,
          modelNo: modelNo.trim() || null,
          note: "창고 실물 품절 확인",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "품절 처리를 저장하지 못했습니다.");
      }

      setNotice("품절 확정 완료. 이후 판매·입고를 반영해 상태를 자동 계산합니다.");
      setBarcode("");
      setModelNo("");
      window.setTimeout(() => window.location.reload(), 450);
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
          실제로 재고가 0개인 상품만 B코드로 확정합니다. 이후 입고와 판매는 원장에서 자동 반영되고, 필요한 판매중·품절 변경은 자동 처리 대기열에 올라갑니다.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <label className="text-sm font-bold text-slate-700">
          B코드
          <input
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="예: BZ7341-1"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 font-mono text-sm outline-none focus:border-rose-500"
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          상품 형태
          <select
            value={productKind}
            onChange={(event) => setProductKind(event.target.value as ProductKind)}
            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-rose-500"
          >
            <option value="OPTION">옵션이 있는 상품</option>
            <option value="SINGLE">옵션 없는 단품</option>
          </select>
        </label>
      </div>

      {productKind === "SINGLE" ? (
        <label className="mt-3 block max-w-md text-sm font-bold text-slate-700">
          모델번호
          <input
            value={modelNo}
            onChange={(event) => setModelNo(event.target.value)}
            placeholder="예: AAA490"
            className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-rose-500"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={loading}
        className="mt-4 rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white hover:bg-rose-800 disabled:bg-slate-400"
      >
        {loading ? "처리 중..." : "품절 확정"}
      </button>

      {notice ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
