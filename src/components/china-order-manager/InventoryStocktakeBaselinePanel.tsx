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

export function InventoryStocktakeBaselinePanel() {
  const [barcode, setBarcode] = useState("");
  const [productKind, setProductKind] = useState<ProductKind>("SINGLE");
  const [modelNo, setModelNo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async () => {
    setNotice("");
    const normalizedBarcode = barcode
      .normalize("NFKC")
      .toUpperCase()
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/\s+/g, "");
    const parsedQuantity = Number(quantity);
    if (!/^B[A-Z]{1,2}\d+-\d+$/.test(normalizedBarcode)) {
      setNotice("B코드를 BBB8-1 또는 BZ7341-1 형식으로 입력하세요.");
      return;
    }
    if (
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > 1_000_000
    ) {
      setNotice("실물재고 수량을 1개 이상의 정수로 입력하세요.");
      return;
    }
    if (productKind === "SINGLE" && !modelNo.trim()) {
      setNotice("단품은 모델번호가 필요합니다.");
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
          barcode: normalizedBarcode,
          productKind,
          modelNo: modelNo.trim() || null,
          baselineQuantity: parsedQuantity,
          note: note.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.message || "실사 재고 기준점을 저장하지 못했습니다.",
        );
      }
      setNotice(
        payload.message ||
          `실물재고 ${parsedQuantity}개를 새 기준점으로 저장했습니다.`,
      );
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "실사 재고 기준점 저장에 실패했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-emerald-800">
            STOCKTAKE BASELINE · EXACT INVENTORY
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            실사 재고 기준점 · 재입고
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            창고에서 직접 센 실물수량을 현재 기준재고로 저장합니다. RECEIVED 입고기록을 임의로 만들지 않으며, 이 시점 이후의 확정입고는 더하고 판매는 빼서 정확재고를 이어갑니다. 같은 수량을 다시 실사해도 델타로 더하지 않습니다.
          </p>
        </div>
        <span className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-black text-emerald-800">
          저장만 수행 · Shopling 송신 없음
        </span>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_180px_1fr_180px]">
        <label className="text-sm font-bold text-slate-700">
          B코드
          <input
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="예: BBB8-1"
            className="mt-1 block w-full rounded-xl border border-emerald-200 bg-white px-3 py-3 font-mono text-sm outline-none focus:border-emerald-500"
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          상품형태
          <select
            value={productKind}
            onChange={(event) =>
              setProductKind(event.target.value as ProductKind)
            }
            className="mt-1 block w-full rounded-xl border border-emerald-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500"
          >
            <option value="SINGLE">옵션 없는 단품</option>
            <option value="OPTION">옵션상품</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-700">
          모델번호 {productKind === "SINGLE" ? "· 필수" : "· 자동보완 가능"}
          <input
            value={modelNo}
            onChange={(event) => setModelNo(event.target.value)}
            placeholder="예: AAA339"
            className="mt-1 block w-full rounded-xl border border-emerald-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500"
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          실물재고 수량
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="예: 10"
            className="mt-1 block w-full rounded-xl border border-emerald-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500"
          />
        </label>
      </div>
      <label className="mt-3 block text-sm font-bold text-slate-700">
        메모
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="예: 창고 실사 10개 확인"
          className="mt-1 block w-full rounded-xl border border-emerald-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500"
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={loading}
        className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:bg-slate-400"
      >
        {loading ? "실사 기준점 저장 중..." : "실사 재고 기준점 저장"}
      </button>
      {notice ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold leading-6 text-slate-800">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
